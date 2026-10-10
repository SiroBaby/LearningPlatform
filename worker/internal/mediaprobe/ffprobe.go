package mediaprobe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type FFProbeRunner struct {
	BinaryPath      string
	ExpectedVersion string
	OutputMaxBytes  int64
}

func (runner FFProbeRunner) CheckVersion(ctx context.Context) error {
	if err := validateBinaryPath(runner.BinaryPath); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, runner.BinaryPath, "-version")
	command.Env = minimalEnvironment()
	command.Stdin = strings.NewReader("")
	output, err := readCommandOutput(command, runner.OutputMaxBytes)
	if err != nil {
		return fmt.Errorf("check ffprobe version: %w", err)
	}
	if runner.ExpectedVersion != "" && !ffprobeVersionMatches(output, runner.ExpectedVersion) {
		return fmt.Errorf("ffprobe version does not match expected artifact")
	}
	return nil
}

// ffprobeVersionMatches requires the exact normalized artifact version.
func ffprobeVersionMatches(output []byte, expected string) bool {
	fields := strings.Fields(string(output))
	if len(fields) < 3 || fields[0] != "ffprobe" || fields[1] != "version" {
		return false
	}
	observed := strings.TrimPrefix(fields[2], "n")
	expected = strings.TrimPrefix(strings.TrimSpace(expected), "n")
	if observed == "" || expected == "" {
		return false
	}
	return observed == expected
}

func (runner FFProbeRunner) Run(ctx context.Context, filePath string) (Metadata, error) {
	if err := validateBinaryPath(runner.BinaryPath); err != nil {
		return Metadata{}, Failure{Code: FailureMediaProbe}
	}
	if !filepath.IsAbs(filePath) {
		return Metadata{}, Failure{Code: FailureMediaProbe}
	}
	command := exec.CommandContext(
		ctx,
		runner.BinaryPath,
		"-v", "error",
		"-protocol_whitelist", "file",
		"-show_entries", "stream=codec_type,codec_name,profile,pix_fmt,coded_width,coded_height,avg_frame_rate,channels,disposition:stream_tags:format=format_name,duration:format_tags",
		"-print_format", "json",
		"-show_streams",
		"-show_format",
		filePath,
	)
	command.Env = minimalEnvironment()
	// ffprobe has no standalone -nostdin option; closing stdin prevents input
	// while keeping the command compatible with the pinned ffprobe artifact.
	command.Stdin = strings.NewReader("")
	output, err := readCommandOutput(command, runner.OutputMaxBytes)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Metadata{}, Failure{Code: FailureMediaProbeTimeout, Technical: true}
		}
		if errors.Is(err, errOutputLimitExceeded) {
			// More retries cannot reduce a deterministic oversized ffprobe response.
			return Metadata{}, Failure{Code: FailureMediaProbeOutputCapExceeded}
		}
		return Metadata{}, Failure{Code: FailureMediaProbe}
	}
	metadata, err := decodeMetadata(output)
	if err != nil {
		return Metadata{}, Failure{Code: FailureMediaProbe}
	}
	return metadata, nil
}

type outputBudget struct {
	mu         sync.Mutex
	used       int64
	limit      int64
	exceeded   bool
	onExceeded func()
}

var errOutputLimitExceeded = errors.New("ffprobe output limit exceeded")

type commandOutput struct {
	buffer bytes.Buffer
	budget *outputBudget
}

func (output *commandOutput) Write(input []byte) (int, error) {
	output.budget.mu.Lock()
	if output.budget.used+int64(len(input)) > output.budget.limit {
		output.budget.exceeded = true
		onExceeded := output.budget.onExceeded
		output.budget.mu.Unlock()
		if onExceeded != nil {
			onExceeded()
		}
		return 0, errOutputLimitExceeded
	}
	output.budget.used += int64(len(input))
	output.budget.mu.Unlock()
	return output.buffer.Write(input)
}

func (output *commandOutput) Bytes() []byte {
	return output.buffer.Bytes()
}

func readCommandOutput(command *exec.Cmd, limit int64) ([]byte, error) {
	if limit <= 0 {
		return nil, errOutputLimitExceeded
	}
	budget := &outputBudget{limit: limit}
	budget.onExceeded = func() {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
	}
	var stdout, stderr commandOutput
	stdout.budget = budget
	stderr.budget = budget
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	budget.mu.Lock()
	exceeded := budget.exceeded || budget.used >= budget.limit
	budget.mu.Unlock()
	if exceeded {
		return nil, errOutputLimitExceeded
	}
	if err != nil {
		return nil, err
	}
	return stdout.Bytes(), nil
}

func decodeMetadata(raw []byte) (Metadata, error) {
	var response struct {
		Streams []struct {
			CodecType   string            `json:"codec_type"`
			CodecName   string            `json:"codec_name"`
			Profile     string            `json:"profile"`
			PixelFormat string            `json:"pix_fmt"`
			CodedWidth  int               `json:"coded_width"`
			CodedHeight int               `json:"coded_height"`
			AverageRate string            `json:"avg_frame_rate"`
			Channels    int               `json:"channels"`
			Disposition map[string]int    `json:"disposition"`
			Tags        map[string]string `json:"tags"`
		} `json:"streams"`
		Format struct {
			Name     string            `json:"format_name"`
			Duration string            `json:"duration"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&response); err != nil {
		return Metadata{}, err
	}
	if response.Format.Name == "" || response.Format.Duration == "" {
		return Metadata{}, errors.New("ffprobe metadata is incomplete")
	}
	metadata := Metadata{
		Format:  FormatMetadata{Name: response.Format.Name, Duration: response.Format.Duration, Tags: response.Format.Tags},
		Streams: make([]StreamMetadata, 0, len(response.Streams)),
	}
	for _, stream := range response.Streams {
		metadata.Streams = append(metadata.Streams, StreamMetadata{
			CodecType:   stream.CodecType,
			CodecName:   stream.CodecName,
			Profile:     stream.Profile,
			PixelFormat: stream.PixelFormat,
			CodedWidth:  stream.CodedWidth,
			CodedHeight: stream.CodedHeight,
			AverageRate: stream.AverageRate,
			Channels:    stream.Channels,
			IsDefault:   stream.Disposition["default"] == 1,
			Tags:        stream.Tags,
			Disposition: stream.Disposition,
		})
	}
	return metadata, nil
}

func validateBinaryPath(path string) error {
	if path == "" || !filepath.IsAbs(path) {
		return errors.New("ffprobe path must be absolute")
	}
	return nil
}

func minimalEnvironment() []string {
	return []string{"PATH=/usr/bin:/bin", "HOME=/tmp", "LC_ALL=C"}
}

var _ Runner = FFProbeRunner{}

var _ io.Writer = (*commandOutput)(nil)
