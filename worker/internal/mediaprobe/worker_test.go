package mediaprobe

import (
	"bytes"
	"context"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkerFirstClaimPersistsLocatorAndUsesExactVersion(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4", Attempt: 1, LeaseID: "lease"}
	observed := Locator{Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4}
	store := &probeStore{job: job}
	objects := &probeObjectStore{observed: observed, data: []byte("data")}
	runner := probeRunner{metadata: validProbeMetadata()}
	worker := NewWorker(store, objects, runner, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}
	if store.persisted != observed || store.persistCalls != 1 {
		t.Fatalf("persisted locator = %#v, calls = %d", store.persisted, store.persistCalls)
	}
	if objects.opened != observed {
		t.Fatalf("opened locator = %#v, want exact observed version", objects.opened)
	}
	if !store.completed {
		t.Fatal("probe completion was not persisted")
	}
}

func TestWorkerRetryUsesPersistedLocatorWithoutReadingLatest(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4", Attempt: 2, LeaseID: "lease", Locator: &Locator{Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4}}
	store := &probeStore{job: job}
	objects := &probeObjectStore{data: []byte("data")}
	worker := NewWorker(store, objects, probeRunner{metadata: validProbeMetadata()}, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}
	if objects.headCalls != 0 {
		t.Fatalf("retry called Head() %d times, want 0", objects.headCalls)
	}
	if objects.opened.VersionID != "version-1" {
		t.Fatalf("retry opened version = %q, want version-1", objects.opened.VersionID)
	}
	if store.persistCalls != 0 {
		t.Fatalf("retry persisted locator %d times, want 0", store.persistCalls)
	}
}

func TestWorkerCancellationCannotCompleteProbe(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4", Attempt: 1, LeaseID: "lease"}
	store := &probeStore{job: job}
	objects := &probeObjectStore{observed: Locator{Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4}, data: []byte("data")}
	runner := probeRunner{metadata: validProbeMetadata(), beforeReturn: cancel}
	worker := NewWorker(store, objects, runner, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(ctx, job); err != ErrJobFenceLost {
		t.Fatalf("ProcessClaimed() error = %v, want ErrJobFenceLost", err)
	}
	if store.completed {
		t.Fatal("cancelled probe must not complete")
	}
}

func TestWorkerCancelsOpenStreamWhenFenceIsLost(t *testing.T) {
	job := Job{
		ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4",
		Attempt: 1, LeaseID: "lease", Locator: &Locator{
			Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4,
		},
	}
	store := &activeFenceProbeStore{probeStore: &probeStore{job: job}}
	objects := &blockingProbeObjectStore{started: make(chan struct{})}
	runner := &countingProbeRunner{}
	tempDir := t.TempDir()
	worker := NewWorker(store, objects, runner, nil, Options{
		TempDir: tempDir, MaxDownloadSize: 10, FenceCheckInterval: 5 * time.Millisecond,
	})

	result := make(chan error, 1)
	go func() { result <- worker.ProcessClaimed(context.Background(), job) }()
	select {
	case <-objects.started:
	case <-time.After(time.Second):
		t.Fatal("object stream did not start")
	}
	store.fenced.Store(true)
	select {
	case err := <-result:
		if err != ErrJobFenceLost {
			t.Fatalf("ProcessClaimed() error = %v, want ErrJobFenceLost", err)
		}
	case <-time.After(time.Second):
		t.Fatal("open object stream was not cancelled after fence loss")
	}
	if runner.calls.Load() != 0 {
		t.Fatalf("ffprobe runner calls = %d, want 0 after stream cancellation", runner.calls.Load())
	}
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		t.Fatalf("ReadDir(tempDir): %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary files remain after cancellation: %v", entries)
	}
}

func TestWorkerDoesNotReadObjectAfterCancellationFence(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4", Attempt: 1, LeaseID: "lease"}
	store := &probeStore{job: job, fenceOnPersist: true}
	objects := &probeObjectStore{
		observed: Locator{Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4},
		data:     []byte("data"),
	}
	worker := NewWorker(store, objects, probeRunner{metadata: validProbeMetadata()}, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != ErrJobFenceLost {
		t.Fatalf("ProcessClaimed() error = %v, want ErrJobFenceLost", err)
	}
	if objects.openCalls != 0 {
		t.Fatalf("OpenVersion() called %d times after cancellation fence, want 0", objects.openCalls)
	}
	if store.completed || store.failCalls != 0 || store.retryCalls != 0 {
		t.Fatalf("cancelled job changed durable outcome: completed=%v failed=%d retried=%d", store.completed, store.failCalls, store.retryCalls)
	}
}

func TestWorkerDoesNotRetryOutputCapFailure(t *testing.T) {
	job := Job{
		ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4",
		Attempt: 1, LeaseID: "lease", Locator: &Locator{
			Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4,
		},
	}
	store := &probeStore{job: job}
	objects := &probeObjectStore{data: []byte("data")}
	runner := probeRunner{err: Failure{Code: FailureMediaProbeOutputCapExceeded}}
	worker := NewWorker(store, objects, runner, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}
	if store.retryCalls != 0 {
		t.Fatalf("output cap failure was retried %d times, want 0", store.retryCalls)
	}
	if store.failCalls != 1 || store.failedCode != FailureMediaProbeOutputCapExceeded {
		t.Fatalf("output cap failure = calls %d, code %q, want one final failure", store.failCalls, store.failedCode)
	}
}

func TestWorkerFailsMalformedMediaBeforeProbeCompletion(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4", Attempt: 1, LeaseID: "lease"}
	store := &probeStore{job: job}
	objects := &probeObjectStore{
		observed: Locator{Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4},
		data:     []byte("data"),
	}
	runner := probeRunner{metadata: Metadata{Format: FormatMetadata{Name: "mp4", Duration: "1"}}}
	worker := NewWorker(store, objects, runner, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}
	if store.completed {
		t.Fatal("malformed media must not complete the probe or emit its completion outbox")
	}
	if store.failCalls != 1 || store.failedCode != FailureAudioTrackRequired {
		t.Fatalf("failure = calls %d, code %q, want one MEDIA_AUDIO_TRACK_REQUIRED", store.failCalls, store.failedCode)
	}
}

func TestWorkerFailsPersistedLocatorMismatchBeforeProbeCompletion(t *testing.T) {
	job := Job{
		ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "owners/video.mp4",
		Attempt: 1, LeaseID: "lease", Locator: &Locator{
			Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4,
		},
	}
	store := &probeStore{job: job}
	objects := &probeObjectStore{data: []byte("data"), openErr: Failure{Code: FailureMediaProbe}}
	worker := NewWorker(store, objects, probeRunner{metadata: validProbeMetadata()}, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}
	if objects.opened.VersionID != "version-1" {
		t.Fatalf("opened version = %q, want exact persisted version", objects.opened.VersionID)
	}
	if store.completed {
		t.Fatal("a storage version or fingerprint mismatch must not complete the probe or emit its completion outbox")
	}
	if store.failCalls != 1 || store.failedCode != FailureMediaProbe {
		t.Fatalf("failure = calls %d, code %q, want one MEDIA_PROBE_FAILED", store.failCalls, store.failedCode)
	}
}

func TestWorkerPersistsRetryAfterJobTimeout(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", Attempt: 1, LeaseID: "lease"}
	store := &probeStore{job: job}
	worker := NewWorker(store, &probeObjectStore{}, probeRunner{}, nil, Options{})
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()

	if err := worker.finishFailure(ctx, job, Failure{Code: FailureMediaProbeTimeout, Technical: true}); err != nil {
		t.Fatalf("finishFailure() error = %v", err)
	}
	if store.retryCalls != 1 {
		t.Fatalf("retry calls = %d, want 1", store.retryCalls)
	}
	if store.retryContextErr != nil {
		t.Fatalf("retry used an expired context: %v", store.retryContextErr)
	}
}

func validProbeMetadata() Metadata {
	return Metadata{
		Format: FormatMetadata{Name: "mp4", Duration: "1"},
		Streams: []StreamMetadata{
			{CodecType: "video", CodecName: "h264", Profile: "Main", PixelFormat: "yuv420p", CodedWidth: 1280, CodedHeight: 720, AverageRate: "30/1"},
			{CodecType: "audio", CodecName: "aac", Profile: "LC", Channels: 2, IsDefault: true},
		},
	}
}

type probeStore struct {
	job             Job
	observed        Locator
	completed       bool
	persisted       Locator
	persistCalls    int
	retryCalls      int
	retryContextErr error
	failCalls       int
	failedCode      FailureCode
	fenced          bool
	fenceOnPersist  bool
}

func (store *probeStore) Claim(context.Context) (*Job, error) { return &store.job, nil }
func (store *probeStore) CheckActive(context.Context, Job) (bool, error) {
	if store.fenced {
		return false, ErrJobFenceLost
	}
	return true, nil
}
func (store *probeStore) PersistLocator(_ context.Context, _ Job, locator Locator) (bool, error) {
	store.persisted = locator
	store.persistCalls++
	if store.fenceOnPersist {
		store.fenced = true
	}
	return true, nil
}
func (store *probeStore) Complete(_ context.Context, _ Job, result ProbeResult) (bool, error) {
	store.completed = result.DurationSec > 0
	return true, nil
}
func (store *probeStore) Fail(_ context.Context, _ Job, failure Failure) (bool, error) {
	store.failCalls++
	store.failedCode = failure.Code
	return true, nil
}
func (store *probeStore) Retry(ctx context.Context, _ Job, _ FailureCode) (RetryResult, error) {
	store.retryCalls++
	store.retryContextErr = ctx.Err()
	if store.retryContextErr != nil {
		return RetryResult{}, store.retryContextErr
	}
	return RetryResult{Scheduled: true}, nil
}

type probeObjectStore struct {
	observed  Locator
	data      []byte
	opened    Locator
	headCalls int
	openErr   error
	openCalls int
}

func (store *probeObjectStore) Head(context.Context, string, string) (Locator, error) {
	store.headCalls++
	return store.observed, nil
}
func (store *probeObjectStore) OpenVersion(_ context.Context, locator Locator) (io.ReadCloser, error) {
	store.openCalls++
	store.opened = locator
	if store.openErr != nil {
		return nil, store.openErr
	}
	return io.NopCloser(bytes.NewReader(store.data)), nil
}

type probeRunner struct {
	metadata     Metadata
	beforeReturn func()
	err          error
}

type activeFenceProbeStore struct {
	*probeStore
	fenced atomic.Bool
}

func (store *activeFenceProbeStore) CheckActive(context.Context, Job) (bool, error) {
	if store.fenced.Load() {
		return false, ErrJobFenceLost
	}
	return true, nil
}

type blockingProbeObjectStore struct {
	started chan struct{}
}

func (store *blockingProbeObjectStore) Head(context.Context, string, string) (Locator, error) {
	return Locator{}, nil
}

func (store *blockingProbeObjectStore) OpenVersion(ctx context.Context, _ Locator) (io.ReadCloser, error) {
	return &blockingProbeReader{ctx: ctx, started: store.started}, nil
}

type blockingProbeReader struct {
	ctx     context.Context
	started chan struct{}
	once    sync.Once
}

func (reader *blockingProbeReader) Read([]byte) (int, error) {
	reader.once.Do(func() { close(reader.started) })
	<-reader.ctx.Done()
	return 0, reader.ctx.Err()
}

func (*blockingProbeReader) Close() error { return nil }

type countingProbeRunner struct{ calls atomic.Int32 }

func (runner *countingProbeRunner) Run(context.Context, string) (Metadata, error) {
	runner.calls.Add(1)
	return validProbeMetadata(), nil
}

func (runner probeRunner) Run(context.Context, string) (Metadata, error) {
	if runner.beforeReturn != nil {
		runner.beforeReturn()
	}
	if runner.err != nil {
		return Metadata{}, runner.err
	}
	return runner.metadata, nil
}

var _ Store = (*probeStore)(nil)
var _ ObjectStore = (*probeObjectStore)(nil)
var _ Runner = probeRunner{}

func TestDownloadToTempCleansFileOnFailure(t *testing.T) {
	store := &probeObjectStore{data: []byte("data")}
	worker := NewWorker(&probeStore{}, store, probeRunner{}, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 2})
	_, err := worker.downloadToTemp(context.Background(), Job{}, Locator{Bucket: "", Key: "", VersionID: "", ContentLength: 4})
	if err == nil {
		t.Fatal("downloadToTemp() unexpectedly succeeded")
	}
	entries, readErr := os.ReadDir(worker.options.TempDir)
	if readErr != nil {
		t.Fatalf("ReadDir() error = %v", readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary files remain after failure: %v", entries)
	}
}
