package mediaprobe

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
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
