// Package consumer contains the worker-side bootstrap boundary.
package consumer

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

// Bootstrap owns the bounded PostgreSQL consumer lifecycle while processing
// and persistence remain behind the processing package interfaces.
type Bootstrap struct {
	started   atomic.Bool
	store     processing.Store
	objects   processing.ObjectReader
	generator processing.Generator
	logger    *slog.Logger
	options   Options
	cancel    context.CancelFunc
	workers   sync.WaitGroup
	active    atomic.Int64
	slots     chan struct{}
	lifecycle sync.Mutex
	stopping  bool
	done      chan struct{}
}

// Options controls the bounded consumer lifecycle. Zero values use safe defaults.
type Options struct {
	Concurrency     int
	JobTimeout      time.Duration
	PollInterval    time.Duration
	PersistTimeout  time.Duration
	ShutdownTimeout time.Duration
}

const (
	defaultConcurrency     = 2
	maxConcurrency         = 32
	defaultJobTimeout      = 10 * time.Minute
	minJobTimeout          = time.Millisecond
	maxJobTimeout          = 14 * time.Minute
	defaultPollInterval    = time.Second
	minPollInterval        = 100 * time.Millisecond
	maxPollInterval        = time.Minute
	defaultPersistTimeout  = 30 * time.Second
	defaultShutdownTimeout = 30 * time.Second
	minShutdownTimeout     = time.Second
	maxShutdownTimeout     = 2 * time.Minute
)

type processOutcome uint8

const (
	processOutcomeUnknown processOutcome = iota
	processOutcomeCompleted
	processOutcomeRetryScheduled
	processOutcomeFinalized
	processOutcomeFenced
)

var errInvalidRetryResult = errors.New("invalid retry result")

func NewBootstrap() *Bootstrap {
	return &Bootstrap{options: normalizeOptions(Options{})}
}

func New(store processing.Store, objects processing.ObjectReader, generator processing.Generator) *Bootstrap {
	return newWithLogger(store, objects, generator, slog.Default())
}

func newWithLogger(store processing.Store, objects processing.ObjectReader, generator processing.Generator, logger *slog.Logger) *Bootstrap {
	return &Bootstrap{store: store, objects: objects, generator: generator, logger: logger, options: normalizeOptions(Options{})}
}

func NewWithOptions(store processing.Store, objects processing.ObjectReader, generator processing.Generator, options Options) *Bootstrap {
	return &Bootstrap{store: store, objects: objects, generator: generator, logger: slog.Default(), options: normalizeOptions(options)}
}

func (bootstrap *Bootstrap) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	bootstrap.lifecycle.Lock()
	defer bootstrap.lifecycle.Unlock()
	if bootstrap.stopping {
		return errors.New("worker lifecycle is still stopping")
	}
	if !bootstrap.started.CompareAndSwap(false, true) {
		return nil
	}
	bootstrap.done = make(chan struct{})
	if bootstrap.store == nil {
		close(bootstrap.done)
		return nil
	}
	lifecycleCtx, cancel := context.WithCancel(ctx)
	bootstrap.cancel = cancel
	bootstrap.slots = make(chan struct{}, bootstrap.options.Concurrency)
	bootstrap.workers.Add(1)
	go bootstrap.loop(lifecycleCtx)
	done := bootstrap.done
	go func() {
		bootstrap.workers.Wait()
		close(done)
		bootstrap.lifecycle.Lock()
		if bootstrap.done == done {
			bootstrap.stopping = false
		}
		bootstrap.lifecycle.Unlock()
	}()
	return nil
}

func (bootstrap *Bootstrap) Close() {
	bootstrap.lifecycle.Lock()
	if !bootstrap.started.Swap(false) {
		bootstrap.lifecycle.Unlock()
		return
	}
	bootstrap.stopping = true
	cancel := bootstrap.cancel
	done := bootstrap.done
	bootstrap.lifecycle.Unlock()
	if cancel != nil {
		cancel()
	}
	select {
	case <-done:
		bootstrap.lifecycle.Lock()
		if bootstrap.done == done {
			bootstrap.stopping = false
		}
		bootstrap.lifecycle.Unlock()
	case <-time.After(bootstrap.options.ShutdownTimeout):
		if bootstrap.logger != nil {
			bootstrap.logger.Warn("worker.shutdown.timeout", "event", "worker.shutdown.timeout", "runtime", "go-worker")
		}
	}
}

func (bootstrap *Bootstrap) Ready() bool {
	return bootstrap.started.Load()
}

func (bootstrap *Bootstrap) loop(ctx context.Context) {
	defer bootstrap.workers.Done()
	ticker := time.NewTicker(bootstrap.options.PollInterval)
	defer ticker.Stop()
	for {
		worked, err := bootstrap.dispatch(ctx)
		if err != nil && ctx.Err() == nil {
			if !waitFor(ctx, 5*time.Second) {
				return
			}
			continue
		}
		if worked {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (bootstrap *Bootstrap) dispatch(ctx context.Context) (bool, error) {
	select {
	case bootstrap.slots <- struct{}{}:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	job, err := bootstrap.store.Claim(ctx)
	if err != nil || job == nil {
		<-bootstrap.slots
		return false, err
	}
	bootstrap.workers.Add(1)
	go func(job processing.Job) {
		defer bootstrap.workers.Done()
		defer func() { <-bootstrap.slots }()
		jobCtx, cancel := context.WithTimeout(ctx, bootstrap.options.JobTimeout)
		defer cancel()
		active := bootstrap.active.Add(1)
		bootstrap.logLifecycle("worker.processing.started", job, active, 0)
		started := time.Now()
		outcome, err := bootstrap.processClaimed(jobCtx, job)
		active = bootstrap.active.Add(-1)
		if outcome == processOutcomeRetryScheduled || outcome == processOutcomeFinalized {
			return
		}
		if errors.Is(jobCtx.Err(), context.Canceled) || errors.Is(jobCtx.Err(), context.DeadlineExceeded) {
			bootstrap.logLifecycle("worker.processing.cancelled", job, active, time.Since(started))
			return
		}
		if errors.Is(err, processing.ErrJobFenceLost) {
			bootstrap.logLifecycle("worker.processing.fenced", job, active, time.Since(started))
			return
		}
		if err != nil {
			bootstrap.logLifecycle("worker.processing.failed", job, active, time.Since(started))
			return
		}
		if outcome == processOutcomeCompleted {
			bootstrap.logLifecycle("worker.processing.completed", job, active, time.Since(started))
		}
	}(*job)
	return true, nil
}

func (bootstrap *Bootstrap) processOne(ctx context.Context) error {
	job, err := bootstrap.store.Claim(ctx)
	if err != nil || job == nil {
		return err
	}
	_, err = bootstrap.processClaimed(ctx, *job)
	return err
}

func (bootstrap *Bootstrap) processClaimed(ctx context.Context, job processing.Job) (processOutcome, error) {
	source, err := bootstrap.store.Source(ctx, job)
	if err != nil {
		return bootstrap.finish(ctx, job, err)
	}
	bytes, err := bootstrap.objects.Read(ctx, source.StorageRef, 20*1024*1024)
	if err != nil {
		return bootstrap.finish(ctx, job, err)
	}
	segments, err := processing.Extract(source, bytes)
	if err != nil {
		return bootstrap.finish(ctx, job, err)
	}
	chunks, err := processing.ChunkText(job.DocumentID, job.OwnerID, segments)
	if err != nil {
		return bootstrap.finish(ctx, job, err)
	}
	questions := make([]processing.Question, 0, len(chunks))
	for index, chunk := range chunks {
		question, err := bootstrap.generator.Generate(ctx, chunk.Text)
		if err != nil {
			return bootstrap.finish(ctx, job, err)
		}
		question.ChunkID = chunk.ID
		question.ChunkIndex = chunk.Index
		question.Ordinal = index
		question.Citation = processing.Citation{ChunkID: chunk.ID, Locator: chunk.Locator, Snippet: chunk.Text}
		questions = append(questions, question)
	}
	persisted, err := bootstrap.store.PersistAndComplete(ctx, job, chunks, questions)
	if err == nil {
		if !persisted {
			return processOutcomeFenced, processing.ErrJobFenceLost
		}
		return processOutcomeCompleted, nil
	}
	if persisted {
		// A commit error leaves the final state uncertain; retrying could duplicate the result.
		bootstrap.logFailure("worker.processing.persistence_ambiguous", "persist", job, processing.Failure{Code: processing.ProcessingFailed, Technical: true})
		return processOutcomeUnknown, err
	}
	return bootstrap.finish(ctx, job, err)
}

func (bootstrap *Bootstrap) finish(ctx context.Context, job processing.Job, err error) (processOutcome, error) {
	if errors.Is(ctx.Err(), context.Canceled) {
		return processOutcomeUnknown, ctx.Err()
	}
	if errors.Is(err, processing.ErrJobFenceLost) {
		return processOutcomeFenced, processing.ErrJobFenceLost
	}
	persistCtx := ctx
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		var cancel context.CancelFunc
		persistCtx, cancel = context.WithTimeout(context.Background(), bootstrap.options.PersistTimeout)
		defer cancel()
	}
	var failure processing.Failure
	if !errors.As(err, &failure) {
		failure = processing.Failure{Code: processing.ProcessingFailed, Technical: true}
	}
	if failure.Technical {
		result, retryErr := bootstrap.store.Retry(persistCtx, job, failure.Code)
		if retryErr != nil {
			if errors.Is(retryErr, processing.ErrJobFenceLost) {
				return processOutcomeFenced, processing.ErrJobFenceLost
			}
			if result.Scheduled || result.Finalized {
				bootstrap.logFailure("worker.processing.persistence_ambiguous", "retry", job, failure)
				return processOutcomeUnknown, retryErr
			}
			bootstrap.logFailure("worker.processing.retry.persistence_failed", "retry", job, failure)
			return processOutcomeUnknown, retryErr
		}
		switch {
		case result.Scheduled && result.Finalized:
			bootstrap.logFailure("worker.processing.retry.contract_violation", "retry", job, failure)
			return processOutcomeUnknown, errInvalidRetryResult
		case result.Scheduled:
			bootstrap.logFailure("worker.processing.retry.scheduled", "retry", job, failure)
			return processOutcomeRetryScheduled, nil
		case result.Finalized:
			bootstrap.logFailure("worker.processing.failed", "dlq", job, failure)
			return processOutcomeFinalized, nil
		default:
			bootstrap.logFailure("worker.processing.retry.contract_violation", "retry", job, failure)
			return processOutcomeUnknown, errInvalidRetryResult
		}
	}
	finalized, failErr := bootstrap.store.Fail(persistCtx, job, failure)
	if failErr != nil {
		if errors.Is(failErr, processing.ErrJobFenceLost) {
			return processOutcomeFenced, processing.ErrJobFenceLost
		}
		if finalized {
			bootstrap.logFailure("worker.processing.persistence_ambiguous", "finalize", job, failure)
		} else {
			bootstrap.logFailure("worker.processing.failure.persistence_failed", "finalize", job, failure)
		}
	} else if finalized {
		bootstrap.logFailure("worker.processing.failed", "finalize", job, failure)
		return processOutcomeFinalized, nil
	}
	if failErr == nil {
		return processOutcomeFenced, processing.ErrJobFenceLost
	}
	return processOutcomeUnknown, failErr
}

func (bootstrap *Bootstrap) logLifecycle(event string, job processing.Job, active int64, duration time.Duration) {
	if bootstrap.logger == nil {
		return
	}
	attributes := []any{"event", event, "job_id", job.ID, "attempt", job.Attempt, "correlation_id", job.CorrelationID, "active", active, "concurrency", bootstrap.options.Concurrency}
	if !job.CreatedAt.IsZero() {
		queueAge := time.Since(job.CreatedAt)
		if queueAge < 0 {
			queueAge = 0
		}
		attributes = append(attributes, "queue_age_ms", queueAge.Milliseconds())
	}
	if duration > 0 {
		attributes = append(attributes, "duration_ms", duration.Milliseconds())
	}
	bootstrap.logger.Log(context.Background(), slog.LevelInfo, event, attributes...)
}

func waitFor(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func normalizeOptions(options Options) Options {
	if options.Concurrency <= 0 {
		options.Concurrency = defaultConcurrency
	} else if options.Concurrency > maxConcurrency {
		options.Concurrency = maxConcurrency
	}
	if options.JobTimeout <= 0 {
		options.JobTimeout = defaultJobTimeout
	} else if options.JobTimeout < minJobTimeout {
		options.JobTimeout = minJobTimeout
	} else if options.JobTimeout > maxJobTimeout {
		options.JobTimeout = maxJobTimeout
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultPollInterval
	} else if options.PollInterval < minPollInterval {
		options.PollInterval = minPollInterval
	} else if options.PollInterval > maxPollInterval {
		options.PollInterval = maxPollInterval
	}
	if options.PersistTimeout <= 0 {
		options.PersistTimeout = defaultPersistTimeout
	}
	if options.ShutdownTimeout <= 0 {
		options.ShutdownTimeout = defaultShutdownTimeout
	} else if options.ShutdownTimeout < minShutdownTimeout {
		options.ShutdownTimeout = minShutdownTimeout
	} else if options.ShutdownTimeout > maxShutdownTimeout {
		options.ShutdownTimeout = maxShutdownTimeout
	}
	return options
}

func (bootstrap *Bootstrap) logFailure(event, phase string, job processing.Job, failure processing.Failure) {
	if bootstrap.logger == nil {
		return
	}
	attributes := []any{
		"event", event,
		"phase", phase,
		"attempt", job.Attempt,
		"category", string(failure.Code),
	}
	if failure.Code == processing.OutputInvalid && failure.Reason.Valid() {
		attributes = append(attributes, "reason", string(failure.Reason))
	}
	if failure.Code == processing.OutputInvalid && failure.Reason == processing.ChoiceCount {
		attributes = append(attributes, "choice_count", failure.ChoiceCount)
	}
	bootstrap.logger.Log(context.Background(), logLevelFor(event), event, attributes...)
}

func logLevelFor(event string) slog.Level {
	if event == "worker.processing.retry.scheduled" {
		return slog.LevelWarn
	}
	return slog.LevelError
}
