package mediaprobe

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestFFmpegRunnerChecksPinnedVersionOfFFmpegItself(t *testing.T) {
	tests := []struct {
		name    string
		banner  string
		wantErr bool
	}{
		{name: "exact pinned version", banner: "ffmpeg version n8.1.3-27-g8dca1586f4-20261031 Copyright"},
		{name: "ffprobe banner is not ffmpeg", banner: "ffprobe version n8.1.3-27-g8dca1586f4-20261031 Copyright", wantErr: true},
		{name: "other build", banner: "ffmpeg version n8.1.1 Copyright", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binary := writeExecutable(t, "#!/bin/sh\nprintf '%s\\n' '"+test.banner+"'\n")
			err := (FFmpegRunner{BinaryPath: binary, ExpectedVersion: "8.1.3-27-g8dca1586f4-20261031"}).CheckVersion(context.Background())
			if (err != nil) != test.wantErr {
				t.Fatalf("CheckVersion() error = %v, wantErr %t", err, test.wantErr)
			}
		})
	}
}

func TestFFmpegRunnerExtractChunkUsesSandboxedArguments(t *testing.T) {
	argumentsFile := filepath.Join(t.TempDir(), "arguments")
	binary := writeExecutable(t, `#!/bin/sh
printf '%s\n' "$@" > '`+argumentsFile+`'
for last; do :; done
printf 'audio' > "$last"
`)
	destination := filepath.Join(t.TempDir(), "chunk.mp3")
	runner := FFmpegRunner{BinaryPath: binary}

	err := runner.ExtractChunk(context.Background(), ExtractRequest{
		SourcePath: "/tmp/source.mp4", DestPath: destination, StartSec: 595, DurationSec: 610, MaxBytes: 1024,
	})
	if err != nil {
		t.Fatalf("ExtractChunk() error = %v", err)
	}

	raw, err := os.ReadFile(argumentsFile)
	if err != nil {
		t.Fatal(err)
	}
	actual := strings.Split(strings.TrimSpace(string(raw)), "\n")
	expected := []string{
		"-nostdin", "-hide_banner", "-v", "error",
		"-protocol_whitelist", "file", "-format_whitelist", allowedFFProbeDemuxers,
		"-ss", "595.000", "-t", "610.000", "-i", "/tmp/source.mp4",
		"-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
		"-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k",
		"-threads", "1", "-fs", "1024", "-f", "mp3", "-y", destination,
	}
	if strings.Join(actual, "\x00") != strings.Join(expected, "\x00") {
		t.Fatalf("ffmpeg arguments = %v\nwant %v", actual, expected)
	}
}

func TestFFmpegRunnerExtractChunkRejectsUnsafeInput(t *testing.T) {
	binary := writeExecutable(t, "#!/bin/sh\nfor last; do :; done\nprintf 'audio' > \"$last\"\n")
	destination := filepath.Join(t.TempDir(), "chunk.mp3")
	tests := []struct {
		name    string
		runner  FFmpegRunner
		request ExtractRequest
	}{
		{name: "relative binary", runner: FFmpegRunner{BinaryPath: "ffmpeg"}, request: ExtractRequest{SourcePath: "/a", DestPath: destination, DurationSec: 1, MaxBytes: 1}},
		{name: "relative source", runner: FFmpegRunner{BinaryPath: binary}, request: ExtractRequest{SourcePath: "a.mp4", DestPath: destination, DurationSec: 1, MaxBytes: 1}},
		{name: "relative destination", runner: FFmpegRunner{BinaryPath: binary}, request: ExtractRequest{SourcePath: "/a", DestPath: "chunk.mp3", DurationSec: 1, MaxBytes: 1}},
		{name: "empty span", runner: FFmpegRunner{BinaryPath: binary}, request: ExtractRequest{SourcePath: "/a", DestPath: destination, MaxBytes: 1}},
		{name: "no size cap", runner: FFmpegRunner{BinaryPath: binary}, request: ExtractRequest{SourcePath: "/a", DestPath: destination, DurationSec: 1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var failure Failure
			if err := test.runner.ExtractChunk(context.Background(), test.request); !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
				t.Fatalf("ExtractChunk() error = %v, want MEDIA_AUDIO_PREP_FAILED", err)
			}
		})
	}
}

func TestFFmpegRunnerExtractChunkEnforcesOutputCap(t *testing.T) {
	// The fake writes more than the cap, as ffmpeg would stop exactly at -fs.
	binary := writeExecutable(t, "#!/bin/sh\nfor last; do :; done\nprintf '0123456789' > \"$last\"\n")
	destination := filepath.Join(t.TempDir(), "chunk.mp3")

	err := (FFmpegRunner{BinaryPath: binary}).ExtractChunk(context.Background(), ExtractRequest{
		SourcePath: "/a", DestPath: destination, DurationSec: 1, MaxBytes: 10,
	})

	var failure Failure
	if !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
		t.Fatalf("ExtractChunk() error = %v, want MEDIA_AUDIO_PREP_FAILED at the cap", err)
	}
}

func TestFFmpegRunnerMeasuresDecodedDurationFromPCMBytes(t *testing.T) {
	// 3.5 s of mono 16 kHz s16le is 112000 bytes.
	binary := writeExecutable(t, "#!/bin/sh\nhead -c 112000 /dev/zero\n")

	actual, err := (FFmpegRunner{BinaryPath: binary}).MeasureDecodedDuration(context.Background(), "/tmp/source.mp3")

	if err != nil || actual != 3500 {
		t.Fatalf("MeasureDecodedDuration() = (%d, %v), want 3500 ms", actual, err)
	}
}

func TestFFmpegRunnerClassifiesFailures(t *testing.T) {
	t.Run("decoder error", func(t *testing.T) {
		binary := writeExecutable(t, "#!/bin/sh\nexit 1\n")
		_, err := (FFmpegRunner{BinaryPath: binary}).MeasureDecodedDuration(context.Background(), "/a")
		var failure Failure
		if !errors.As(err, &failure) || failure.Code != FailureAudioPrep || failure.Technical {
			t.Fatalf("error = %v, want permanent MEDIA_AUDIO_PREP_FAILED", err)
		}
	})
	t.Run("no audio decoded", func(t *testing.T) {
		binary := writeExecutable(t, "#!/bin/sh\nexit 0\n")
		_, err := (FFmpegRunner{BinaryPath: binary}).MeasureDecodedDuration(context.Background(), "/a")
		var failure Failure
		if !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
			t.Fatalf("error = %v, want MEDIA_AUDIO_PREP_FAILED", err)
		}
	})
	t.Run("own timeout is permanent", func(t *testing.T) {
		binary := writeExecutable(t, "#!/bin/sh\nexec sleep 5\n")
		_, err := (FFmpegRunner{BinaryPath: binary, Timeout: 50 * time.Millisecond}).MeasureDecodedDuration(context.Background(), "/a")
		var failure Failure
		if !errors.As(err, &failure) || failure.Code != FailureMediaProbeTimeout || failure.Technical {
			t.Fatalf("error = %v, want permanent MEDIA_PROBE_TIMEOUT", err)
		}
	})
	t.Run("job deadline stays retryable", func(t *testing.T) {
		binary := writeExecutable(t, "#!/bin/sh\nexec sleep 5\n")
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		_, err := (FFmpegRunner{BinaryPath: binary, Timeout: time.Minute}).MeasureDecodedDuration(ctx, "/a")
		var failure Failure
		if !errors.As(err, &failure) || failure.Code != FailureMediaProbeTimeout || !failure.Technical {
			t.Fatalf("error = %v, want retryable MEDIA_PROBE_TIMEOUT", err)
		}
	})
	t.Run("cancellation is a fence loss signal", func(t *testing.T) {
		binary := writeExecutable(t, "#!/bin/sh\nexec sleep 5\n")
		ctx, cancel := context.WithCancel(context.Background())
		time.AfterFunc(50*time.Millisecond, cancel)
		_, err := (FFmpegRunner{BinaryPath: binary}).MeasureDecodedDuration(ctx, "/a")
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", err)
		}
	})
}

func TestPCMCounterStopsDecoderPastTheLimit(t *testing.T) {
	stopped := false
	counter := &pcmCounter{limit: 100, stop: func() { stopped = true }}

	if written, err := counter.Write(make([]byte, 100)); err != nil || written != 100 || stopped {
		t.Fatalf("Write(100) = (%d, %v), stopped=%v, want accepted at the limit", written, err, stopped)
	}
	if _, err := counter.Write(make([]byte, 1)); err == nil || !stopped || !counter.exceeded.Load() {
		t.Fatalf("Write(1) error = %v, stopped=%v, want decoder stopped past the limit", err, stopped)
	}
}

// requireMediaTools returns real pinned-or-local ffmpeg/ffprobe, skipping only
// outside CI: CI installs the pinned artifact through install-media-tools.sh.
func requireMediaTools(t *testing.T) (ffmpeg, ffprobe string) {
	t.Helper()
	ffmpeg, ffmpegErr := exec.LookPath("ffmpeg")
	ffprobe, ffprobeErr := exec.LookPath("ffprobe")
	if ffmpegErr != nil || ffprobeErr != nil {
		if os.Getenv("CI") != "" {
			t.Fatal("ffmpeg and ffprobe must be installed in CI by worker/scripts/install-media-tools.sh")
		}
		t.Skip("ffmpeg and ffprobe are not installed")
	}
	return ffmpeg, ffprobe
}

func generateTone(t *testing.T, ffmpeg, name string, seconds int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	arguments := []string{
		"-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=" + strconv.Itoa(seconds),
		"-ac", "2",
	}
	if strings.HasSuffix(name, ".mp4") {
		arguments = append(arguments, "-c:a", "aac", "-b:a", "64k")
	} else {
		arguments = append(arguments, "-c:a", "libmp3lame", "-b:a", "64k")
	}
	arguments = append(arguments, "-y", path)
	if output, err := exec.Command(ffmpeg, arguments...).CombinedOutput(); err != nil {
		t.Fatalf("generate %s: %v: %s", name, err, output)
	}
	return path
}

func probeDurationSeconds(t *testing.T, ffprobe, path string) float64 {
	t.Helper()
	output, err := exec.Command(ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path).Output()
	if err != nil {
		t.Fatalf("ffprobe %s: %v", path, err)
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil {
		t.Fatalf("parse ffprobe duration %q: %v", output, err)
	}
	return seconds
}

func TestFFmpegRunnerWithRealBinary(t *testing.T) {
	ffmpeg, ffprobe := requireMediaTools(t)
	runner := FFmpegRunner{BinaryPath: ffmpeg, Timeout: time.Minute}
	for _, name := range []string{"tone.mp3", "tone.mp4"} {
		t.Run(name, func(t *testing.T) {
			source := generateTone(t, ffmpeg, name, 14)

			decodedMs, err := runner.MeasureDecodedDuration(context.Background(), source)
			if err != nil || math.Abs(float64(decodedMs)-14000) > 150 {
				t.Fatalf("MeasureDecodedDuration() = (%d, %v), want about 14000 ms", decodedMs, err)
			}
			destination := filepath.Join(t.TempDir(), "chunk.mp3")
			if err := runner.ExtractChunk(context.Background(), ExtractRequest{SourcePath: source, DestPath: destination, StartSec: 2, DurationSec: 6, MaxBytes: 1 << 20}); err != nil {
				t.Fatalf("ExtractChunk() error = %v", err)
			}
			if actual := probeDurationSeconds(t, ffprobe, destination); math.Abs(actual-6) > 0.2 {
				t.Fatalf("chunk duration = %.3f s, want about 6 s", actual)
			}
			info, err := os.Stat(destination)
			if err != nil || info.Size() > 6*4000+4096 {
				t.Fatalf("chunk size = %v (%v), want 32 kbps mono (about 24 kB for 6 s)", info, err)
			}
			cap := ExtractRequest{SourcePath: source, DestPath: filepath.Join(t.TempDir(), "capped.mp3"), DurationSec: 14, MaxBytes: 2048}
			var failure Failure
			if err := runner.ExtractChunk(context.Background(), cap); !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
				t.Fatalf("ExtractChunk() with a tiny cap error = %v, want MEDIA_AUDIO_PREP_FAILED", err)
			}
		})
	}
}

func TestFFmpegRunnerRejectsFileWithoutAudio(t *testing.T) {
	ffmpeg, _ := requireMediaTools(t)
	notMedia := filepath.Join(t.TempDir(), "not-media.mp3")
	if err := os.WriteFile(notMedia, bytes.Repeat([]byte("x"), 4096), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := (FFmpegRunner{BinaryPath: ffmpeg, Timeout: time.Minute}).MeasureDecodedDuration(context.Background(), notMedia)

	var failure Failure
	if !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
		t.Fatalf("MeasureDecodedDuration() error = %v, want MEDIA_AUDIO_PREP_FAILED", err)
	}
}

// TestWorkerPreparesRealAudioIntoSpeechSizedChunks runs the whole step with the
// real ffprobe and ffmpeg on a 1300 s tone: three chunks, each far below the
// 25 MiB STT limit, each about the planned length.
func TestWorkerPreparesRealAudioIntoSpeechSizedChunks(t *testing.T) {
	ffmpeg, ffprobe := requireMediaTools(t)
	source := generateTone(t, ffmpeg, "long.mp3", 1300)
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	job := Job{
		ID: "job", DocumentID: "document", OwnerID: "owner", ProbeGeneration: "generation",
		SourceBucket: "media", SourceKey: "media/owner/long.mp3", Attempt: 1, LeaseID: "lease",
		Locator: &Locator{Bucket: "media", Key: "media/owner/long.mp3", VersionID: "v", ETag: "e", ContentLength: int64(len(data))},
	}
	store := &audioPrepStore{probeStore: &probeStore{job: job}}
	derived := &fakeDerivedStore{}
	chunks := &fakeChunkStore{}
	store.chunks = chunks
	capture := &durationCapturingStore{fakeDerivedStore: derived, ffprobe: ffprobe, t: t}
	worker := NewWorker(store, &probeObjectStore{data: data}, FFProbeRunner{BinaryPath: ffprobe, OutputMaxBytes: 1 << 20, Timeout: time.Minute}, nil, Options{
		TempDir: t.TempDir(), MaxDownloadSize: int64(len(data)) + 1, MediaBucket: "media",
		AudioPrep: &AudioPrep{Encoder: FFmpegRunner{BinaryPath: ffmpeg, Timeout: time.Minute}, Objects: capture, Chunks: chunks},
	})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v (failed code %q)", err, store.failedCode)
	}

	if !store.completed || store.result.AudioChunkCount != 3 || math.Abs(float64(store.result.DecodedDurationMs)-1300000) > 500 {
		t.Fatalf("result = %#v, failed=%q, want 3 chunks and about 1300 s decoded", store.result, store.failedCode)
	}
	wantSeconds := []float64{605, 610, 105}
	for index, want := range wantSeconds {
		saved := chunks.saved[index]
		if saved.SizeBytes <= 0 || saved.SizeBytes > 25*1024*1024 || saved.SizeBytes > 4000*(int64(want)+10) {
			t.Fatalf("chunk %d size = %d bytes, want a 32 kbps file far below 25 MiB", index, saved.SizeBytes)
		}
		if math.Abs(capture.durations[index]-want) > 1 {
			t.Fatalf("chunk %d duration = %.2f s, want about %.0f s", index, capture.durations[index], want)
		}
	}
}

// durationCapturingStore records the real duration of each file at upload time.
type durationCapturingStore struct {
	*fakeDerivedStore
	ffprobe   string
	t         *testing.T
	durations []float64
}

func (store *durationCapturingStore) PutDerivedObject(ctx context.Context, request PutObjectRequest) (PutObjectResult, error) {
	store.durations = append(store.durations, probeDurationSeconds(store.t, store.ffprobe, request.FilePath))
	return store.fakeDerivedStore.PutDerivedObject(ctx, request)
}
