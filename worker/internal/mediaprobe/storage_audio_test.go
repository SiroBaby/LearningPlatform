package mediaprobe

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/minio/minio-go/v7"
)

func TestClassifyPutErrorTagsDeniedWritesAndKeepsTemporaryErrorsRetryable(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		code       FailureCode
		technical  bool
		wantReason DerivedAudioReason
	}{
		{name: "access denied", err: minio.ErrorResponse{Code: "AccessDenied", StatusCode: http.StatusForbidden}, code: FailureAudioPrep, wantReason: DerivedAudioReasonAccessDenied},
		{name: "invalid access key", err: minio.ErrorResponse{Code: "InvalidAccessKeyId", StatusCode: http.StatusForbidden}, code: FailureAudioPrep, wantReason: DerivedAudioReasonAccessDenied},
		{name: "missing bucket", err: minio.ErrorResponse{Code: "NoSuchBucket", StatusCode: http.StatusNotFound}, code: FailureAudioPrep, wantReason: DerivedAudioReasonConfiguration},
		{name: "unknown client error", err: minio.ErrorResponse{Code: "InvalidArgument", StatusCode: http.StatusBadRequest}, code: FailureAudioPrep, wantReason: DerivedAudioReasonRejected},
		{name: "slow down", err: minio.ErrorResponse{Code: "SlowDown", StatusCode: http.StatusServiceUnavailable}, code: FailureMediaProbeStorageTemporary, technical: true},
		{name: "server error", err: minio.ErrorResponse{StatusCode: http.StatusBadGateway}, code: FailureMediaProbeStorageTemporary, technical: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual := classifyPutError(test.err)

			var failure Failure
			if !errors.As(actual, &failure) || failure.Code != test.code || failure.Technical != test.technical {
				t.Fatalf("classifyPutError() = %#v, want %s technical=%t", actual, test.code, test.technical)
			}
			var derived DerivedAudioError
			if test.wantReason != "" && (!errors.As(actual, &derived) || derived.Reason != test.wantReason) {
				t.Fatalf("classifyPutError() = %#v, want reason %s", actual, test.wantReason)
			}
			if strings.Contains(actual.Error(), "AccessDenied") {
				t.Fatalf("error text %q leaks the raw storage code", actual.Error())
			}
		})
	}
}

// TestS3StorePutsDerivedAudioToTheConfiguredHostAndReturnsExactVersion pins the
// write path to the same host as reads (no dualstack rewrite) and requires a
// VersionId, because the purge worker and STT address exact versions.
func TestS3StorePutsDerivedAudioToTheConfiguredHostAndReturnsExactVersion(t *testing.T) {
	tests := []struct {
		name        string
		handler     func(http.ResponseWriter, *http.Request)
		wantVersion string
		wantReason  DerivedAudioReason
	}{
		{
			name: "versioned bucket",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("ETag", `"etag-put"`)
				writer.Header().Set("X-Amz-Version-Id", "version-put")
			},
			wantVersion: "version-put",
		},
		{
			name: "unversioned bucket is refused",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("ETag", `"etag-put"`)
			},
			wantReason: DerivedAudioReasonVersionMissing,
		},
		{
			name: "missing PutObject grant",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/xml")
				writer.WriteHeader(http.StatusForbidden)
				_, _ = io.WriteString(writer, `<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>denied</Message></Error>`)
			},
			wantReason: DerivedAudioReasonAccessDenied,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var mutex sync.Mutex
			var hosts, methods []string
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				_, _ = io.Copy(io.Discard, request.Body)
				mutex.Lock()
				hosts = append(hosts, request.Host)
				methods = append(methods, request.Method)
				mutex.Unlock()
				test.handler(writer, request)
			}))
			t.Cleanup(server.Close)
			store, err := NewS3Store("http://s3.ap-southeast-1.amazonaws.com", "access", "secret", server.URL)
			if err != nil {
				t.Fatal(err)
			}
			filePath := filepath.Join(t.TempDir(), "chunk.mp3")
			if err := os.WriteFile(filePath, []byte("audio"), 0o600); err != nil {
				t.Fatal(err)
			}

			result, err := store.PutDerivedObject(context.Background(), PutObjectRequest{
				Bucket: "media-bucket", Key: "derived-audio/o/d/g/0000.mp3", FilePath: filePath, ContentType: "audio/mpeg",
			})

			mutex.Lock()
			defer mutex.Unlock()
			for _, host := range hosts {
				if host != "media-bucket.s3.ap-southeast-1.amazonaws.com" {
					t.Fatalf("requested hosts = %v, want only the configured virtual host", hosts)
				}
			}
			if strings.Join(methods, ",") != "PUT" {
				t.Fatalf("requests = %v, want exactly one PUT (no region discovery)", methods)
			}
			if test.wantReason == "" {
				if err != nil || result.VersionID != test.wantVersion || result.ETag == "" || result.Size != 5 {
					t.Fatalf("PutDerivedObject() = (%#v, %v), want version %s", result, err, test.wantVersion)
				}
				return
			}
			var derived DerivedAudioError
			if !errors.As(err, &derived) || derived.Reason != test.wantReason {
				t.Fatalf("PutDerivedObject() error = %v, want reason %s", err, test.wantReason)
			}
		})
	}
}
