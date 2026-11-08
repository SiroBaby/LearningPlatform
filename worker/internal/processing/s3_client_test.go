package processing

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// TestS3MediaReaderKeepsConfiguredHostBehindEgressProxy guards the go-worker
// media client, which goes through the same allowlisted proxy as the media
// probe. The fake proxy records the host every request was really sent to and,
// like the Squid allowlist, rejects dualstack hosts.
func TestS3MediaReaderKeepsConfiguredHostBehindEgressProxy(t *testing.T) {
	var mutex sync.Mutex
	var hosts []string
	proxy := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		mutex.Lock()
		hosts = append(hosts, request.Host)
		mutex.Unlock()
		switch {
		case strings.Contains(request.Host, "dualstack"):
			writer.WriteHeader(http.StatusForbidden)
		default:
			writer.Header().Set("ETag", `"etag-1"`)
			writer.Header().Set("Last-Modified", "Sun, 11 Oct 2026 00:00:00 GMT")
			writer.Header().Set("X-Amz-Version-Id", "version-1")
			writer.Header().Set("Content-Length", "4")
			_, _ = io.WriteString(writer, "data")
		}
	}))
	defer proxy.Close()
	reader, err := NewS3ReaderWithMedia("http://s3.ap-southeast-1.amazonaws.com", "access", "secret", "document-bucket", "media-access", "media-secret", "media-bucket", proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	locator := ObjectLocator{Bucket: "media-bucket", Key: "uploads/a.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4}
	data, err := reader.ReadVersion(context.Background(), locator, 16)
	mutex.Lock()
	defer mutex.Unlock()
	if err != nil || string(data) != "data" {
		t.Fatalf("ReadVersion() = %q, %v; requested hosts %v", data, err, hosts)
	}
	if len(hosts) == 0 {
		t.Fatal("no request reached the proxy")
	}
	for _, host := range hosts {
		if host != "media-bucket.s3.ap-southeast-1.amazonaws.com" {
			t.Fatalf("requested hosts = %v, want only media-bucket.s3.ap-southeast-1.amazonaws.com", hosts)
		}
	}
}

func TestNewS3ReaderRejectsAmazonEndpointWithoutRegion(t *testing.T) {
	for _, endpoint := range []string{"https://s3.amazonaws.com", "s3.amazonaws.com"} {
		if _, err := NewS3Reader(endpoint, "access", "secret", "document-bucket"); err == nil {
			t.Fatalf("NewS3Reader(%q) error = nil, want region error", endpoint)
		}
	}
	for _, endpoint := range []string{"https://s3.ap-southeast-1.amazonaws.com", "s3.ap-southeast-1.amazonaws.com:443", "localhost:9000"} {
		if _, err := NewS3Reader(endpoint, "access", "secret", "document-bucket"); err != nil {
			t.Fatalf("NewS3Reader(%q) error = %v", endpoint, err)
		}
	}
}

// TestS3MediaReaderRejectsLocatorMismatch ensures ReadVersion trusts only the
// exact object the probe recorded: a different VersionId, ETag or size is
// refused before any byte is returned.
func TestS3MediaReaderRejectsLocatorMismatch(t *testing.T) {
	tests := []struct {
		name      string
		versionID string
		etag      string
		body      string
	}{
		{name: "version id", versionID: "version-other", etag: `"etag-1"`, body: "dddd"},
		{name: "etag", versionID: "version-1", etag: `"etag-other"`, body: "dddd"},
		{name: "content length", versionID: "version-1", etag: `"etag-1"`, body: "ddddd"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var requests int
			var requestsMutex sync.Mutex
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				requestsMutex.Lock()
				requests++
				requestsMutex.Unlock()
				writer.Header().Set("ETag", test.etag)
				writer.Header().Set("Last-Modified", "Sun, 11 Oct 2026 00:00:00 GMT")
				writer.Header().Set("X-Amz-Version-Id", test.versionID)
				_, _ = io.WriteString(writer, test.body)
			}))
			defer server.Close()
			reader, err := NewS3ReaderWithMedia("http://s3.ap-southeast-1.amazonaws.com", "access", "secret", "document-bucket", "media-access", "media-secret", "media-bucket", server.URL)
			if err != nil {
				t.Fatal(err)
			}
			locator := ObjectLocator{Bucket: "media-bucket", Key: "uploads/a.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4}

			data, err := reader.ReadVersion(context.Background(), locator, 16)

			var failure Failure
			if !errors.As(err, &failure) || failure.Code != ObjectNotFound {
				t.Fatalf("ReadVersion() error = %v, want %s", err, ObjectNotFound)
			}
			if data != nil {
				t.Fatalf("ReadVersion() data = %q, want none", data)
			}
			requestsMutex.Lock()
			defer requestsMutex.Unlock()
			if requests == 0 {
				t.Fatal("ReadVersion() never reached S3; the mismatch was not exercised")
			}
		})
	}
}
