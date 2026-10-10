package mediaprobe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type Worker struct {
	store   Store
	objects ObjectStore
	runner  Runner
	logger  *slog.Logger
	options Options

	started atomic.Bool
	cancel  context.CancelFunc
	workers sync.WaitGroup
	slots   chan struct{}
	done    chan struct{}
	mu      sync.Mutex
}

type Options struct {
	Concurrency        int
	PollInterval       time.Duration
	JobTimeout         time.Duration
	ShutdownTimeout    time.Duration
	FenceCheckInterval time.Duration
	TempDir            string
	MaxDownloadSize    int64
}

const (
	defaultConcurrency        = 1
	defaultPollInterval       = time.Second
	defaultJobTimeout         = 10 * time.Minute
	defaultShutdownTimeout    = 30 * time.Second
	defaultFenceCheckInterval = 5 * time.Second
	defaultMaxDownloadSize    = 500 * 1024 * 1024
	failurePersistenceTimeout = 5 * time.Second
)

func NewWorker(store Store, objects ObjectStore, runner Runner, logger *slog.Logger, options Options) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	if options.Concurrency <= 0 {
		options.Concurrency = defaultConcurrency
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultPollInterval
	}
	if options.JobTimeout <= 0 {
		options.JobTimeout = defaultJobTimeout
	}
	if options.ShutdownTimeout <= 0 {
		options.ShutdownTimeout = defaultShutdownTimeout
	}
	if options.FenceCheckInterval <= 0 {
		options.FenceCheckInterval = defaultFenceCheckInterval
	}
	if options.TempDir == "" {
		options.TempDir = os.TempDir()
	}
	if options.MaxDownloadSize <= 0 {
		options.MaxDownloadSize = defaultMaxDownloadSize
	}
	return &Worker{store: store, objects: objects, runner: runner, logger: logger, options: options}
}

func (worker *Worker) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if worker.store == nil || worker.objects == nil || worker.runner == nil {
		return errors.New("media probe worker dependencies are required")
	}
	if !worker.started.CompareAndSwap(false, true) {
		return nil
	}
	lifecycleCtx, cancel := context.WithCancel(ctx)
	worker.cancel = cancel
	worker.slots = make(chan struct{}, worker.options.Concurrency)
	worker.done = make(chan struct{})
	worker.workers.Add(1)
	go worker.loop(lifecycleCtx)
	go func(done chan struct{}) {
		worker.workers.Wait()
		close(done)
	}(worker.done)
	return nil
}

func (worker *Worker) Close() {
	if !worker.started.Swap(false) {
		return
	}
	if worker.cancel != nil {
		worker.cancel()
	}
	done := worker.done
	if done == nil {
		return
	}
	timer := time.NewTimer(worker.options.ShutdownTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		worker.logger.Warn("media_probe_worker.shutdown.timeout", "event", "media_probe_worker.shutdown.timeout")
	}
}

func (worker *Worker) Ready() bool { return worker.started.Load() }

func (worker *Worker) loop(ctx context.Context) {
	defer worker.workers.Done()
	ticker := time.NewTicker(worker.options.PollInterval)
	defer ticker.Stop()
	for {
		worked, err := worker.dispatch(ctx)
		if err != nil && ctx.Err() == nil {
			if !waitFor(ctx, worker.options.PollInterval) {
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

func (worker *Worker) dispatch(ctx context.Context) (bool, error) {
	select {
	case worker.slots <- struct{}{}:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	job, err := worker.store.Claim(ctx)
	if err != nil || job == nil {
		<-worker.slots
		return false, err
	}
	worker.workers.Add(1)
	go func() {
		defer worker.workers.Done()
		defer func() { <-worker.slots }()
		jobCtx, cancel := context.WithTimeout(ctx, worker.options.JobTimeout)
		defer cancel()
		if err := worker.processClaimed(jobCtx, *job); err != nil && !errors.Is(err, ErrJobFenceLost) && ctx.Err() == nil {
			worker.logger.Error("media_probe_worker.job.failed", "event", "media_probe_worker.job.failed", "job_id", job.ID, "attempt", job.Attempt)
		}
	}()
	return true, nil
}

// ProcessClaimed is intentionally exported for the command and focused tests;
// all durable mutations still pass through the Store fence checks.
func (worker *Worker) ProcessClaimed(ctx context.Context, job Job) error {
	return worker.processClaimed(ctx, job)
}

func (worker *Worker) processClaimed(ctx context.Context, job Job) error {
	if err := ctx.Err(); err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	locator := job.Locator
	if locator == nil {
		observed, err := worker.objects.Head(ctx, job.SourceBucket, job.SourceKey)
		if err != nil {
			return worker.finishFailure(ctx, job, err)
		}
		persisted, err := worker.store.PersistLocator(ctx, job, observed)
		if err != nil {
			return worker.finishFailure(ctx, job, err)
		}
		if !persisted {
			return ErrJobFenceLost
		}
		locator = &observed
		job.Locator = locator
	}
	if err := ctx.Err(); err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	if locator.ContentLength < 0 || locator.ContentLength > worker.options.MaxDownloadSize {
		return worker.finishFailure(ctx, job, Failure{Code: FailureObjectTooLarge})
	}
	if err := validateLocator(*locator, job); err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	var metadata Metadata
	err := worker.withActiveFence(ctx, job, func(operationCtx context.Context) error {
		filePath, err := worker.downloadToTemp(operationCtx, job, *locator)
		if err != nil {
			return err
		}
		defer os.Remove(filePath)
		metadata, err = worker.runner.Run(operationCtx, filePath)
		return err
	})
	if err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	if err := ctx.Err(); err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	result, err := ValidateMetadata(metadata, locator.ContentLength)
	if err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	result.Locator = *locator
	if err := ctx.Err(); err != nil {
		return worker.finishFailure(ctx, job, err)
	}
	completed, err := worker.store.Complete(ctx, job, result)
	if err != nil {
		if completed {
			return fmt.Errorf("media probe completion outcome is ambiguous: %w", err)
		}
		return err
	}
	if !completed {
		return ErrJobFenceLost
	}
	return nil
}

func (worker *Worker) finishFailure(ctx context.Context, job Job, err error) error {
	if errors.Is(err, ErrJobFenceLost) || errors.Is(ctx.Err(), context.Canceled) {
		return ErrJobFenceLost
	}
	persistenceCtx, cancel := persistenceContext(ctx)
	defer cancel()
	var failure Failure
	if !errors.As(err, &failure) {
		failure = Failure{Code: FailureMediaProbe, Technical: true}
	}
	if failure.Technical {
		retry, retryErr := worker.store.Retry(persistenceCtx, job, failure.Code)
		if retryErr != nil {
			return retryErr
		}
		if retry.Scheduled || retry.Finalized {
			return nil
		}
		return ErrJobFenceLost
	}
	finalized, finalizeErr := worker.store.Fail(persistenceCtx, job, failure)
	if finalizeErr != nil {
		return finalizeErr
	}
	if !finalized {
		return ErrJobFenceLost
	}
	return nil
}

func persistenceContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ctx, func() {}
	}
	return context.WithTimeout(context.Background(), failurePersistenceTimeout)
}

func (worker *Worker) downloadToTemp(ctx context.Context, job Job, locator Locator) (string, error) {
	if err := os.MkdirAll(worker.options.TempDir, 0o700); err != nil {
		return "", Failure{Code: FailureMediaProbe, Technical: true}
	}
	file, err := os.CreateTemp(worker.options.TempDir, "media-probe-*")
	if err != nil {
		return "", Failure{Code: FailureMediaProbe, Technical: true}
	}
	path := filepath.Clean(file.Name())
	keepFile := false
	defer func() {
		_ = file.Close()
		if !keepFile {
			_ = os.Remove(path)
		}
	}()
	if err := ctx.Err(); err != nil {
		return "", ErrJobFenceLost
	}
	active, err := worker.store.CheckActive(ctx, job)
	if err != nil {
		return "", err
	}
	if !active {
		return "", ErrJobFenceLost
	}
	reader, err := worker.objects.OpenVersion(ctx, locator)
	if err != nil {
		return "", err
	}
	defer func() { _ = reader.Close() }()
	written, err := io.Copy(file, io.LimitReader(reader, worker.options.MaxDownloadSize+1))
	if err != nil {
		return "", Failure{Code: FailureMediaProbeStorageTemporary, Technical: true}
	}
	if written != locator.ContentLength || written > worker.options.MaxDownloadSize {
		return "", Failure{Code: FailureMediaProbe}
	}
	if err := file.Close(); err != nil {
		return "", Failure{Code: FailureMediaProbe, Technical: true}
	}
	keepFile = true
	return path, nil
}

// withActiveFence cancels storage reads and ffprobe work when a deletion or
// lease fence is committed while either operation is still running.
func (worker *Worker) withActiveFence(ctx context.Context, job Job, operation func(context.Context) error) error {
	operationCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := make(chan struct{})
	monitorDone := make(chan struct{})
	monitorErr := make(chan error, 1)
	go func() {
		defer close(monitorDone)
		ticker := time.NewTicker(worker.options.FenceCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-operationCtx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				active, err := worker.store.CheckActive(operationCtx, job)
				if operationCtx.Err() != nil {
					return
				}
				if err == nil && active {
					continue
				}
				if err == nil {
					err = ErrJobFenceLost
				}
				select {
				case monitorErr <- err:
				default:
				}
				cancel()
				return
			}
		}
	}()

	err := operation(operationCtx)
	cancel()
	close(stop)
	<-monitorDone
	select {
	case fenceErr := <-monitorErr:
		return fenceErr
	default:
		return err
	}
}

func validateLocator(locator Locator, job Job) error {
	if locator.Bucket != job.SourceBucket || locator.Key != job.SourceKey || locator.VersionID == "" || locator.ETag == "" || locator.ContentLength < 0 {
		return Failure{Code: FailureMediaProbe}
	}
	return nil
}

func waitFor(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
