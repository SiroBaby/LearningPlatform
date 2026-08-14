package health

import (
	"context"
	"net"
	"net/http"
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

	server := NewServer(address)
	if server.ready.Load() {
		t.Fatal("server should not be ready before Start")
	}
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })

	for _, path := range []string{"/healthz", "/readyz"} {
		response, err := http.Get("http://" + address + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status = %d", path, response.StatusCode)
		}
		_ = response.Body.Close()
	}
}

func TestServerFailsFastWhenHealthAddressCannotBeBound(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	defer func() { _ = listener.Close() }()

	if err := NewServer(listener.Addr().String()).Start(); err == nil {
		t.Fatal("Start() error = nil")
	}
}
