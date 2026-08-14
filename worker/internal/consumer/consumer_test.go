package consumer

import (
	"context"
	"errors"
	"testing"
)

func TestBootstrapIsReadyOnlyWhileItsLifecycleIsStarted(t *testing.T) {
	t.Parallel()

	bootstrap := NewBootstrap()
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should not be ready before Start")
	}
	if err := bootstrap.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !bootstrap.Ready() {
		t.Fatal("Bootstrap should be ready after Start")
	}
	bootstrap.Close()
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should not be ready after Close")
	}
}

func TestBootstrapDoesNotStartWithCanceledContext(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	bootstrap := NewBootstrap()
	if err := bootstrap.Start(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Start() error = %v, want context.Canceled", err)
	}
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should remain not ready after failed Start")
	}
}
