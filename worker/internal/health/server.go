package health

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

const shutdownTimeout = 5 * time.Second

type Server struct {
	address string
	server  *http.Server
	started atomic.Bool
	ready   func() bool
}

func NewServer(address string, ready func() bool) *Server {
	server := &Server{address: address, ready: ready}
	server.server = &http.Server{Handler: http.HandlerFunc(server.handle)}
	return server
}

func (server *Server) Start() error {
	listener, err := net.Listen("tcp", server.address)
	if err != nil {
		return fmt.Errorf("listen for worker health server: %w", err)
	}
	server.started.Store(true)

	go func() {
		if err := server.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			server.started.Store(false)
		}
	}()
	return nil
}

func (server *Server) Close(ctx context.Context) error {
	server.started.Store(false)
	shutdownContext, cancel := context.WithTimeout(ctx, shutdownTimeout)
	defer cancel()
	if err := server.server.Shutdown(shutdownContext); err != nil {
		return fmt.Errorf("shutdown worker health server: %w", err)
	}
	return nil
}

func (server *Server) handle(response http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/healthz":
		response.WriteHeader(http.StatusOK)
	case "/readyz":
		if !server.started.Load() || server.ready == nil || !server.ready() {
			http.Error(response, "not ready", http.StatusServiceUnavailable)
			return
		}
		response.WriteHeader(http.StatusOK)
	default:
		http.NotFound(response, request)
	}
}
