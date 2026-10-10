package mediaprobe

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const validFFProbeJSON = `{"format":{"format_name":"mp4","duration":"12.4","tags":{"encoder":"fixture"}},"streams":[{"codec_type":"video","codec_name":"h264","profile":"Main","pix_fmt":"yuv420p","coded_width":1280,"coded_height":720,"avg_frame_rate":"30000/1001","disposition":{"default":1},"unexpected":"ignored"},{"codec_type":"audio","codec_name":"aac","profile":"LC","channels":2,"disposition":{"default":1}}]}`

func TestFFProbeRunnerDecodesMetadataAndChecksPinnedVersion(t *testing.T) {
	binary := writeExecutable(t, `#!/bin/sh
if [ "$1" = "-version" ]; then
  printf '%s\n' 'ffprobe version fixture'
  exit 0
fi
printf '%s' '`+validFFProbeJSON+`'
`)
	runner := FFProbeRunner{BinaryPath: binary, ExpectedVersion: "fixture", OutputMaxBytes: 4096}
	if err := runner.CheckVersion(context.Background()); err != nil {
		t.Fatalf("CheckVersion() error = %v", err)
	}
	metadata, err := runner.Run(context.Background(), filepath.Join(t.TempDir(), "input.mp4"))
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if metadata.Format.Name != "mp4" || metadata.Format.Duration != "12.4" || len(metadata.Streams) != 2 {
		t.Fatalf("metadata = %#v", metadata)
	}
	if !metadata.Streams[0].IsDefault || metadata.Streams[0].CodedWidth != 1280 || metadata.Streams[1].Profile != "LC" {
		t.Fatalf("streams = %#v", metadata.Streams)
	}
}

func TestFFProbeRunnerRequiresExactNormalizedArtifactVersion(t *testing.T) {
	tests := []struct {
		name     string
		observed string
		wantErr  bool
	}{
		{name: "exact pinned version", observed: "n8.1.3-16-ge0a878dd70-20261009"},
		{name: "short release version", observed: "8.1", wantErr: true},
		{name: "release prefix", observed: "8.1.3-16-ge0a878dd70", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binary := writeExecutable(t, `#!/bin/sh
printf '%s\\n' 'ffprobe version `+test.observed+` Copyright (c) 2007-2026 the FFmpeg developers'
`)
			err := (FFProbeRunner{BinaryPath: binary, ExpectedVersion: "8.1.3-16-ge0a878dd70-20261009", OutputMaxBytes: 4096}).CheckVersion(context.Background())
			if (err != nil) != test.wantErr {
				t.Fatalf("CheckVersion() error = %v, wantErr %t", err, test.wantErr)
			}
		})
	}
}

func TestFFProbeRunnerClassifiesTimeoutAndOutputCap(t *testing.T) {
	tests := []struct {
		name     string
		script   string
		runner   FFProbeRunner
		wantCode FailureCode
	}{
		{
			name:     "timeout",
			script:   "#!/bin/sh\nsleep 1\n",
			runner:   FFProbeRunner{BinaryPath: "", OutputMaxBytes: 4096},
			wantCode: FailureMediaProbeTimeout,
		},
		{
			name:     "output cap",
			script:   "#!/bin/sh\nwhile :; do printf '%01024d' 0; done\n",
			runner:   FFProbeRunner{BinaryPath: "", OutputMaxBytes: 1024},
			wantCode: FailureMediaProbeOutputCapExceeded,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			test.runner.BinaryPath = writeExecutable(t, test.script)
			ctx := context.Background()
			var cancel context.CancelFunc
			if test.name == "timeout" {
				ctx, cancel = context.WithTimeout(ctx, 10*time.Millisecond)
				defer cancel()
			} else {
				ctx, cancel = context.WithTimeout(ctx, time.Second)
				defer cancel()
			}
			_, err := test.runner.Run(ctx, filepath.Join(t.TempDir(), "input"))
			var failure Failure
			if !errors.As(err, &failure) || failure.Code != test.wantCode {
				t.Fatalf("Run() error = %v, want %s", err, test.wantCode)
			}
			if test.name == "timeout" && !failure.Technical {
				t.Fatalf("Run() timeout failure is non-technical, want retryable")
			}
			if test.name == "output cap" && failure.Technical {
				t.Fatalf("Run() output cap failure is technical, want non-retryable")
			}
		})
	}
}

func TestFFProbeRunnerRejectsNonAbsoluteBinaryPath(t *testing.T) {
	_, err := (FFProbeRunner{BinaryPath: "ffprobe", OutputMaxBytes: 4096}).Run(context.Background(), "/tmp/input")
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != FailureMediaProbe {
		t.Fatalf("Run() error = %v, want media probe failure", err)
	}
}

func writeExecutable(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ffprobe-fixture")
	if err := os.WriteFile(path, []byte(strings.TrimSpace(content)+"\n"), 0o700); err != nil {
		t.Fatalf("write executable: %v", err)
	}
	return path
}
