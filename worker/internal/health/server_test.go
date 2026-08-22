package health

import (
	"context"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
)

func TestServerReportsLivenessAndReadinessOnlyAfterStart(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release address: %v", err)
	}

	var ready atomic.Bool
	server := NewServer(address, ready.Load)
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })

	for _, path := range []string{"/healthz", "/readyz"} {
		response, err := http.Get("http://" + address + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		wantStatus := http.StatusOK
		if path == "/readyz" {
			wantStatus = http.StatusServiceUnavailable
		}
		if response.StatusCode != wantStatus {
			t.Fatalf("GET %s status = %d, want %d", path, response.StatusCode, wantStatus)
		}
		_ = response.Body.Close()
	}
	ready.Store(true)
	response, err := http.Get("http://" + address + "/readyz")
	if err != nil {
		t.Fatalf("GET /readyz: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /readyz status = %d, want %d", response.StatusCode, http.StatusOK)
	}
}

func TestServerFailsFastWhenHealthAddressCannotBeBound(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	defer func() { _ = listener.Close() }()

	if err := NewServer(listener.Addr().String(), func() bool { return true }).Start(); err == nil {
		t.Fatal("Start() error = nil")
	}
}
