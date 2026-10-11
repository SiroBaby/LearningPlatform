package mediaprobe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/minio/minio-go/v7"
)

func TestClassifyStorageError(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		code      FailureCode
		technical bool
	}{
		{name: "access denied", err: minio.ErrorResponse{Code: "AccessDenied", StatusCode: http.StatusForbidden}, code: FailureMediaProbe},
		{name: "unauthorized", err: minio.ErrorResponse{Code: "InvalidToken", StatusCode: http.StatusUnauthorized}, code: FailureMediaProbe},
		{name: "invalid access key", err: minio.ErrorResponse{Code: "InvalidAccessKeyId", StatusCode: http.StatusForbidden}, code: FailureMediaProbe},
		{name: "missing bucket", err: minio.ErrorResponse{Code: "NoSuchBucket", StatusCode: http.StatusNotFound}, code: FailureMediaProbe},
		{name: "missing object", err: minio.ErrorResponse{Code: "NoSuchKey", StatusCode: http.StatusNotFound}, code: FailureMediaProbe},
		{name: "slow down", err: minio.ErrorResponse{Code: "SlowDown", StatusCode: http.StatusServiceUnavailable}, code: FailureMediaProbeStorageTemporary, technical: true},
		{name: "too many requests", err: minio.ErrorResponse{StatusCode: http.StatusTooManyRequests}, code: FailureMediaProbeStorageTemporary, technical: true},
		{name: "server error", err: minio.ErrorResponse{StatusCode: http.StatusBadGateway}, code: FailureMediaProbeStorageTemporary, technical: true},
		{name: "transport timeout", err: &url.Error{Op: "Get", URL: "https://storage.invalid", Err: timeoutError{}}, code: FailureMediaProbeStorageTemporary, technical: true},
		{name: "deadline", err: fmt.Errorf("request: %w", context.DeadlineExceeded), code: FailureMediaProbeStorageTemporary, technical: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var failure Failure
			if !errors.As(classifyStorageError(tt.err), &failure) {
				t.Fatal("classified error is not a Failure")
			}
			if failure.Code != tt.code || failure.Technical != tt.technical {
				t.Fatalf("failure = %#v, want %s technical=%t", failure, tt.code, tt.technical)
			}
		})
	}
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

var _ interface{ Timeout() bool } = timeoutError{}

// TestS3StoreKeepsConfiguredHostBehindEgressProxy reproduces the dev failure
// where minio-go silently switched to s3.dualstack.* and Squid answered 403.
// The fake proxy records the host every request was really sent to and, like
// the Squid allowlist, rejects dualstack hosts. Plain HTTP keeps the proxy
// readable without TLS; minio-go picks the host the same way for HTTPS.
func TestS3StoreKeepsConfiguredHostBehindEgressProxy(t *testing.T) {
	proxy := newRecordingS3Proxy(t)
	store, err := NewS3Store("http://s3.ap-southeast-1.amazonaws.com", "access", "secret", proxy.server.URL)
	if err != nil {
		t.Fatal(err)
	}
	locator, err := store.Head(context.Background(), "media-bucket", "uploads/a.mp4")
	if err != nil {
		t.Fatalf("Head() error = %v, requested hosts %v", err, proxy.hosts())
	}
	object, err := store.OpenVersion(context.Background(), locator)
	if err != nil {
		t.Fatalf("OpenVersion() error = %v, requested hosts %v", err, proxy.hosts())
	}
	object.Close()
	const expectedHost = "media-bucket.s3.ap-southeast-1.amazonaws.com"
	hosts := proxy.hosts()
	if len(hosts) == 0 {
		t.Fatal("no request reached the proxy")
	}
	for _, host := range hosts {
		if host != expectedHost {
			t.Fatalf("requested hosts = %v, want only %s", hosts, expectedHost)
		}
	}
}

type recordingS3Proxy struct {
	server    *httptest.Server
	mutex     sync.Mutex
	requested []string
}

func newRecordingS3Proxy(t *testing.T) *recordingS3Proxy {
	t.Helper()
	proxy := &recordingS3Proxy{}
	proxy.server = httptest.NewServer(http.HandlerFunc(proxy.serve))
	t.Cleanup(proxy.server.Close)
	return proxy
}

func (proxy *recordingS3Proxy) serve(writer http.ResponseWriter, request *http.Request) {
	proxy.mutex.Lock()
	proxy.requested = append(proxy.requested, request.Host)
	proxy.mutex.Unlock()
	switch {
	case strings.Contains(request.Host, "dualstack"):
		writer.WriteHeader(http.StatusForbidden)
	default:
		writer.Header().Set("ETag", `"etag-1"`)
		writer.Header().Set("Last-Modified", "Sun, 11 Oct 2026 00:00:00 GMT")
		writer.Header().Set("X-Amz-Version-Id", "version-1")
		writer.Header().Set("Content-Length", "4")
		if request.Method == http.MethodGet {
			_, _ = io.WriteString(writer, "data")
		}
	}
}

func (proxy *recordingS3Proxy) hosts() []string {
	proxy.mutex.Lock()
	defer proxy.mutex.Unlock()
	return append([]string(nil), proxy.requested...)
}
