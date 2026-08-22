package consumer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
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

func TestProcessOnePersistsChunksGeneratesAndCompletes(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}, source: processing.Source{StorageRef: "document.txt", Type: "TEXT"}}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{})
	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.replaced || !store.completed {
		t.Fatalf("store state = %#v", store)
	}
}

func TestProcessOneRequeuesTechnicalFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}, source: processing.Source{StorageRef: "document.txt", Type: "TEXT"}}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}})
	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.retried || store.completed {
		t.Fatalf("store state = %#v", store)
	}
}

func TestProcessOneHandlesPersistenceFailureWithSafeRetryLog(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		persistErr:  errors.New("raw provider/database failure"),
		retryResult: processing.RetryResult{Scheduled: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.retried || store.completed {
		t.Fatalf("store state = %#v", store)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "WARN" || entry["event"] != "worker.processing.retry.scheduled" || entry["phase"] != "retry" || entry["attempt"] != float64(2) || entry["category"] != string(processing.ProcessingFailed) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "raw provider/database failure") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneDoesNotRetryAmbiguousPersistenceFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:        &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 3},
		source:     processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		persisted:  true,
		persistErr: errors.New("commit outcome unavailable"),
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err == nil {
		t.Fatal("processOne() error = nil, want persistence error")
	}
	if store.retried {
		t.Fatal("ambiguous persistence failure must not be retried")
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.persistence_ambiguous" || entry["phase"] != "persist" || entry["attempt"] != float64(3) || entry["category"] != string(processing.ProcessingFailed) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "commit outcome unavailable") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneLogsSafeProviderRetry(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Scheduled: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Reason: processing.EmptyStem, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "WARN" || entry["event"] != "worker.processing.retry.scheduled" || entry["phase"] != "retry" || entry["attempt"] != float64(2) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	if _, present := entry["reason"]; present {
		t.Fatalf("log entry has misleading parser reason: %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func TestProcessOneLogsSafeParserReason(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:    &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source: processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid, Reason: processing.EmptyStem}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.failed" || entry["phase"] != "finalize" || entry["attempt"] != float64(2) || entry["category"] != string(processing.OutputInvalid) || entry["reason"] != string(processing.EmptyStem) {
		t.Fatalf("log entry = %#v", entry)
	}
	if _, present := entry["choice_count"]; present {
		t.Fatalf("log entry has irrelevant choice count: %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func TestProcessOneLogsChoiceCountOnlyForChoiceCountFailures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		choiceCount int
	}{
		{name: "zero choices", choiceCount: 0},
		{name: "multiple choices", choiceCount: 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &storeMock{
				job:    &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
				source: processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
			}
			var output bytes.Buffer
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid, Reason: processing.ChoiceCount, ChoiceCount: test.choiceCount}}, slog.New(slog.NewJSONHandler(&output, nil)))

			if err := worker.processOne(context.Background()); err != nil {
				t.Fatalf("processOne() error = %v", err)
			}

			entry := decodeLogEntry(t, output.String())
			if entry["reason"] != string(processing.ChoiceCount) || entry["choice_count"] != float64(test.choiceCount) {
				t.Fatalf("log entry = %#v", entry)
			}
			assertLogDoesNotExposeJobData(t, output.String())
		})
	}
}

func TestProcessOneLogsSafeDLQFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 4},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Finalized: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.failed" || entry["phase"] != "dlq" || entry["attempt"] != float64(4) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func decodeLogEntry(t *testing.T, output string) map[string]any {
	t.Helper()
	var entry map[string]any
	if err := json.Unmarshal([]byte(output), &entry); err != nil {
		t.Fatalf("decode structured log %q: %v", output, err)
	}
	return entry
}

func assertLogDoesNotExposeJobData(t *testing.T, output string) {
	t.Helper()
	for _, forbidden := range []string{"job-secret", "document-secret", "owner-secret", "lease-secret", "owners/secret-document.txt", "document text"} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("log leaked %q: %s", forbidden, output)
		}
	}
}

type storeMock struct {
	job                          *processing.Job
	source                       processing.Source
	retryResult                  processing.RetryResult
	persistErr                   error
	persisted                    bool
	replaced, completed, retried bool
}

func (store *storeMock) Claim(context.Context) (*processing.Job, error) { return store.job, nil }
func (store *storeMock) Source(context.Context, processing.Job) (processing.Source, error) {
	return store.source, nil
}
func (store *storeMock) PersistAndComplete(_ context.Context, _ processing.Job, chunks []processing.Chunk, _ []processing.Question) (bool, error) {
	store.replaced = len(chunks) > 0
	store.completed = store.persistErr == nil
	if store.persisted || store.persistErr == nil {
		return true, store.persistErr
	}
	return false, store.persistErr
}
func (store *storeMock) Fail(context.Context, processing.Job, processing.Failure) (bool, error) {
	return true, nil
}
func (store *storeMock) Retry(context.Context, processing.Job, processing.FailureCode) (processing.RetryResult, error) {
	store.retried = true
	return store.retryResult, nil
}

type objectMock struct{ bytes []byte }

func (object objectMock) Read(context.Context, string, int64) ([]byte, error) {
	return object.bytes, nil
}

type generatorMock struct{ err error }

func (generator generatorMock) Generate(context.Context, string) (processing.Question, error) {
	return processing.Question{}, generator.err
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
