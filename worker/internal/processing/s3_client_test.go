package processing

import (
	"context"
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
	for _, host := range hosts {
		if host != "media-bucket.s3.ap-southeast-1.amazonaws.com" {
			t.Fatalf("requested hosts = %v, want only media-bucket.s3.ap-southeast-1.amazonaws.com", hosts)
		}
	}
}
