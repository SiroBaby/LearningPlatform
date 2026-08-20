package main

import (
	"context"
	"net"
	"net/http"
	"testing"
)

func TestStartUnreadyHealthServerKeepsLivenessAvailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release address: %v", err)
	}

	server, _, err := startUnreadyHealthServer(address)
	if err != nil {
		t.Fatalf("startUnreadyHealthServer() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })

	for path, wantStatus := range map[string]int{"/healthz": http.StatusOK, "/readyz": http.StatusServiceUnavailable} {
		response, err := http.Get("http://" + address + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if response.StatusCode != wantStatus {
			t.Fatalf("GET %s status = %d, want %d", path, response.StatusCode, wantStatus)
		}
		_ = response.Body.Close()
	}

}
