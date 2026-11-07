package mediaprobe

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	// audioSampleRate and audioBytesPerSecond describe the mono 16-bit PCM used
	// to measure the decoded duration and the 16 kHz mono speech chunks.
	audioSampleRate      = 16000
	audioBytesPerSecond  = audioSampleRate * 2
	chunkAudioBitrate    = "32k"
	maxDecodedDurationMs = maxMediaDurationSec * 1000
	// decodedDurationSlackMs lets the decoder run slightly past the policy
	// maximum so the over-limit check is decided by the measured duration and
	// not by the kill threshold.
	decodedDurationSlackMs = 1000
	versionOutputMaxBytes  = 64 * 1024
)

// AudioEncoder decodes and re-encodes untrusted media bytes. Production code
// uses FFmpegRunner; tests substitute a fake.
type AudioEncoder interface {
	// MeasureDecodedDuration decodes the first audio stream and returns the
	// duration of the audio that was really decoded, in milliseconds.
	MeasureDecodedDuration(ctx context.Context, sourcePath string) (int64, error)
	// ExtractChunk writes [StartSec, StartSec+DurationSec) of the first audio
	// stream as mono low-bitrate audio to DestPath.
	ExtractChunk(ctx context.Context, request ExtractRequest) error
}

// ExtractRequest describes one chunk extraction.
type ExtractRequest struct {
	SourcePath  string
	DestPath    string
	StartSec    float64
	DurationSec float64
	// MaxBytes caps the output file; reaching it fails the extraction.
	MaxBytes int64
}

// FFmpegRunner runs the pinned ffmpeg binary with the same sandbox contract as
// FFProbeRunner: absolute path, no shell, closed stdin, minimal environment,
// local-file protocol only and the probe demuxer allowlist.
type FFmpegRunner struct {
	BinaryPath      string
	ExpectedVersion string
	// Timeout bounds one ffmpeg execution; zero leaves only the caller deadline.
	Timeout time.Duration
}

// CheckVersion confirms the binary reports the pinned artifact version.
func (runner FFmpegRunner) CheckVersion(ctx context.Context) error {
	if err := validateBinaryPath(runner.BinaryPath); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, runner.BinaryPath, "-version")
	command.Env = minimalEnvironment()
	command.Stdin = strings.NewReader("")
	output, err := readCommandOutput(command, versionOutputMaxBytes)
	if err != nil {
		return fmt.Errorf("check ffmpeg version: %w", err)
	}
	if runner.ExpectedVersion != "" && !toolVersionMatches(output, "ffmpeg", runner.ExpectedVersion) {
		return errors.New("ffmpeg version does not match expected artifact")
	}
	return nil
}

func (runner FFmpegRunner) baseArguments() []string {
	return []string{
		"-nostdin", "-hide_banner", "-v", "error",
		"-protocol_whitelist", "file",
		"-format_whitelist", allowedFFProbeDemuxers,
	}
}

// MeasureDecodedDuration decodes to raw PCM on stdout and counts the bytes, so
// nothing is written to disk and the measurement is exact to one sample.
func (runner FFmpegRunner) MeasureDecodedDuration(ctx context.Context, sourcePath string) (int64, error) {
	if err := runner.validatePaths(sourcePath); err != nil {
		return 0, err
	}
	runCtx, cancel := runner.runContext(ctx)
	defer cancel()
	arguments := append(runner.baseArguments(),
		"-i", sourcePath,
		"-map", "0:a:0", "-vn", "-sn", "-dn",
		"-ac", "1", "-ar", strconv.Itoa(audioSampleRate),
		"-f", "s16le", "-",
	)
	command := exec.CommandContext(runCtx, runner.BinaryPath, arguments...)
	command.Env = minimalEnvironment()
	command.Stdin = strings.NewReader("")
	counter := &pcmCounter{limit: (maxDecodedDurationMs + decodedDurationSlackMs) * audioBytesPerSecond / 1000, stop: cancel}
	command.Stdout = counter
	err := command.Run()
	if counter.exceeded.Load() {
		return 0, Failure{Code: FailureDurationExceeded}
	}
	if err != nil {
		return 0, runner.classifyRunError(ctx, runCtx)
	}
	decodedBytes := counter.bytes.Load()
	if decodedBytes <= 0 {
		return 0, Failure{Code: FailureAudioPrep}
	}
	return decodedBytes * 1000 / audioBytesPerSecond, nil
}

// ExtractChunk re-encodes one span as mono 16 kHz MP3 and enforces the size cap.
func (runner FFmpegRunner) ExtractChunk(ctx context.Context, request ExtractRequest) error {
	if err := runner.validatePaths(request.SourcePath, request.DestPath); err != nil {
		return err
	}
	if request.StartSec < 0 || request.DurationSec <= 0 || request.MaxBytes <= 0 {
		return Failure{Code: FailureAudioPrep}
	}
	runCtx, cancel := runner.runContext(ctx)
	defer cancel()
	arguments := append(runner.baseArguments(),
		"-ss", formatSeconds(request.StartSec),
		"-t", formatSeconds(request.DurationSec),
		"-i", request.SourcePath,
		"-map", "0:a:0", "-vn", "-sn", "-dn",
		"-map_metadata", "-1",
		"-ac", "1", "-ar", strconv.Itoa(audioSampleRate),
		"-c:a", "libmp3lame", "-b:a", chunkAudioBitrate,
		"-threads", "1",
		"-fs", strconv.FormatInt(request.MaxBytes, 10),
		"-f", "mp3", "-y", request.DestPath,
	)
	command := exec.CommandContext(runCtx, runner.BinaryPath, arguments...)
	command.Env = minimalEnvironment()
	command.Stdin = strings.NewReader("")
	if err := command.Run(); err != nil {
		return runner.classifyRunError(ctx, runCtx)
	}
	info, err := os.Stat(request.DestPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() >= request.MaxBytes {
		return Failure{Code: FailureAudioPrep}
	}
	return nil
}

func (runner FFmpegRunner) validatePaths(paths ...string) error {
	if err := validateBinaryPath(runner.BinaryPath); err != nil {
		return Failure{Code: FailureAudioPrep}
	}
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			return Failure{Code: FailureAudioPrep}
		}
	}
	return nil
}

func (runner FFmpegRunner) runContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if runner.Timeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, runner.Timeout)
}

// classifyRunError mirrors FFProbeRunner: the job deadline stays retryable, an
// ffmpeg-only timeout is deterministic, and caller cancellation is a fence loss.
func (runner FFmpegRunner) classifyRunError(parent, run context.Context) error {
	switch {
	case errors.Is(parent.Err(), context.DeadlineExceeded):
		return Failure{Code: FailureMediaProbeTimeout, Technical: true}
	case parent.Err() != nil:
		return parent.Err()
	case errors.Is(run.Err(), context.DeadlineExceeded):
		return Failure{Code: FailureMediaProbeTimeout}
	default:
		return Failure{Code: FailureAudioPrep}
	}
}

func formatSeconds(seconds float64) string {
	return strconv.FormatFloat(seconds, 'f', 3, 64)
}

// pcmCounter counts decoded PCM bytes and stops ffmpeg once the policy maximum
// plus slack is exceeded, so a hostile file cannot decode forever.
type pcmCounter struct {
	limit    int64
	stop     context.CancelFunc
	bytes    atomic.Int64
	exceeded atomic.Bool
}

func (counter *pcmCounter) Write(input []byte) (int, error) {
	if counter.bytes.Add(int64(len(input))) > counter.limit {
		counter.exceeded.Store(true)
		counter.stop()
		return 0, errOutputLimitExceeded
	}
	return len(input), nil
}

var _ AudioEncoder = FFmpegRunner{}
