package consumer

import (
	"context"
	"errors"
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

type storeMock struct {
	job                          *processing.Job
	source                       processing.Source
	replaced, completed, retried bool
}

func (store *storeMock) Claim(context.Context) (*processing.Job, error) { return store.job, nil }
func (store *storeMock) Source(context.Context, processing.Job) (processing.Source, error) {
	return store.source, nil
}
func (store *storeMock) PersistAndComplete(_ context.Context, _ processing.Job, chunks []processing.Chunk, _ []processing.Question) (bool, error) {
	store.replaced = len(chunks) > 0
	store.completed = true
	return true, nil
}
func (store *storeMock) Fail(context.Context, processing.Job, processing.Failure) (bool, error) {
	return true, nil
}
func (store *storeMock) Retry(context.Context, processing.Job, processing.FailureCode) (bool, error) {
	store.retried = true
	return true, nil
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
