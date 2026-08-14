package consumer

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/contract"
)

func TestConsumerAcceptsOneDeliveryAndIgnoresDuplicateAndStaleDeliveries(t *testing.T) {
	t.Parallel()

	called := 0
	consumer := New(func(_ context.Context, input contract.ProcessingInput) error {
		called++
		if input.OwnerID != "33333333-3333-4333-8333-333333333333" {
			t.Fatalf("handler owner ID = %q", input.OwnerID)
		}
		return nil
	}, slog.New(slog.NewJSONHandler(io.Discard, nil)))

	if disposition, err := consumer.Consume(context.Background(), readFixture(t, "document.processing.requested.v1.valid.json")); err != nil || disposition != Accepted {
		t.Fatalf("first Consume() = %q, %v", disposition, err)
	}
	if disposition, err := consumer.Consume(context.Background(), readFixture(t, "document.processing.requested.v1.duplicate.json")); err != nil || disposition != IgnoredDuplicate {
		t.Fatalf("duplicate Consume() = %q, %v", disposition, err)
	}
	if disposition, err := consumer.Consume(context.Background(), readFixture(t, "document.processing.requested.v1.stale.json")); err != nil || disposition != IgnoredStale {
		t.Fatalf("stale Consume() = %q, %v", disposition, err)
	}
	if called != 1 {
		t.Fatalf("handler calls = %d, want 1", called)
	}
}

func TestConsumerLeavesFailedDeliveryAvailableForReplay(t *testing.T) {
	t.Parallel()

	calls := 0
	consumer := New(func(_ context.Context, _ contract.ProcessingInput) error {
		calls++
		if calls == 1 {
			return errors.New("transient handler failure")
		}
		return nil
	}, nil)

	fixture := readFixture(t, "document.processing.requested.v1.valid.json")
	if _, err := consumer.Consume(context.Background(), fixture); err == nil {
		t.Fatal("first Consume() error = nil")
	}
	if disposition, err := consumer.Consume(context.Background(), fixture); err != nil || disposition != Accepted {
		t.Fatalf("replay Consume() = %q, %v", disposition, err)
	}
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "contracts", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return raw
}
