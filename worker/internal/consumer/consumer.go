package consumer

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/SiroBaby/LearningPlatform/worker/internal/contract"
)

type Disposition string

const (
	Accepted         Disposition = "accepted"
	IgnoredDuplicate Disposition = "ignored_duplicate"
	IgnoredStale     Disposition = "ignored_stale"
)

type Handler func(context.Context, contract.ProcessingInput) error

type Consumer struct {
	handler Handler
	logger  *slog.Logger

	mu       sync.Mutex
	accepted map[string]contract.JobFence
}

func New(handler Handler, logger *slog.Logger) *Consumer {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &Consumer{handler: handler, logger: logger, accepted: make(map[string]contract.JobFence)}
}

func (consumer *Consumer) Consume(ctx context.Context, raw []byte) (Disposition, error) {
	input, err := contract.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse processing delivery: %w", err)
	}

	disposition := consumer.claim(input)
	if disposition != Accepted {
		consumer.logger.Info("worker.delivery.ignored", "event", "worker.delivery.ignored", "correlationId", input.CorrelationID, "jobId", input.Job.JobID, "status", disposition)
		return disposition, nil
	}
	if err := consumer.handler(ctx, input); err != nil {
		consumer.release(input.Job)
		return "", fmt.Errorf("handle processing delivery: %w", err)
	}

	consumer.logger.Info("worker.delivery.accepted", "event", "worker.delivery.accepted", "correlationId", input.CorrelationID, "jobId", input.Job.JobID, "status", Accepted)
	return Accepted, nil
}

func (consumer *Consumer) claim(input contract.ProcessingInput) Disposition {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()

	previous, exists := consumer.accepted[input.Job.JobID]
	if exists {
		if previous.Attempt > input.Job.Attempt || previous.Attempt == input.Job.Attempt && previous.LeaseID != input.Job.LeaseID {
			return IgnoredStale
		}
		if previous.Attempt == input.Job.Attempt && previous.LeaseID == input.Job.LeaseID {
			return IgnoredDuplicate
		}
	}
	consumer.accepted[input.Job.JobID] = input.Job
	return Accepted
}

func (consumer *Consumer) release(fence contract.JobFence) {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()

	if accepted, exists := consumer.accepted[fence.JobID]; exists && accepted.Attempt == fence.Attempt && accepted.LeaseID == fence.LeaseID {
		delete(consumer.accepted, fence.JobID)
	}
}
