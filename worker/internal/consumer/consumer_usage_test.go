package consumer

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

// usageStore records the usage the attempt tracked at the moment the store would write the return payload.
type usageStore struct {
	*storeMock
	persistedUsage *processing.Usage
	failedUsage    *processing.Usage
}

func (store *usageStore) PersistAndComplete(ctx context.Context, job processing.Job, chunks []processing.Chunk, questions []processing.Question) (bool, error) {
	usage := processing.UsageTrackerFrom(ctx).Snapshot()
	store.persistedUsage = &usage
	return store.storeMock.PersistAndComplete(ctx, job, chunks, questions)
}

func (store *usageStore) Fail(ctx context.Context, job processing.Job, failure processing.Failure) (bool, error) {
	usage := processing.UsageTrackerFrom(ctx).Snapshot()
	store.failedUsage = &usage
	return store.storeMock.Fail(ctx, job, failure)
}

// reportingGenerator behaves like a provider adapter: it reports usage through the tracker in its context.
type reportingGenerator struct {
	err error
}

func (generator reportingGenerator) Generate(ctx context.Context, _ string) (processing.Question, error) {
	tracker := processing.UsageTrackerFrom(ctx)
	tracker.Dispatched()
	tracker.Reported("model-a", 40, 10)
	return processing.Question{}, generator.err
}

func newUsageStore(source processing.Source) *usageStore {
	return &usageStore{storeMock: &storeMock{
		job:    &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source: source,
	}}
}

func TestProcessOneGivesTheStoreTheUsageOfASuccessfulAttempt(t *testing.T) {
	t.Parallel()
	store := newUsageStore(processing.Source{StorageRef: "document.txt", Type: "TEXT"})
	worker := New(store, objectMock{bytes: []byte("document text")}, reportingGenerator{})

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	expected := &processing.Usage{LLM: []processing.ModelUsage{{Model: "model-a", InputTokens: 40, OutputTokens: 10}}}
	if !reflect.DeepEqual(store.persistedUsage, expected) {
		t.Fatalf("persisted usage = %#v, want %#v", store.persistedUsage, expected)
	}
}

func TestProcessOneGivesTheStoreTheUsageSpentBeforeATerminalFailure(t *testing.T) {
	t.Parallel()
	store := newUsageStore(processing.Source{StorageRef: "document.txt", Type: "TEXT"})
	worker := New(store, objectMock{bytes: []byte("document text")}, reportingGenerator{err: processing.Failure{Code: processing.OutputInvalid}})

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	expected := &processing.Usage{LLM: []processing.ModelUsage{{Model: "model-a", InputTokens: 40, OutputTokens: 10}}}
	if !store.failed || !reflect.DeepEqual(store.failedUsage, expected) {
		t.Fatalf("failed = %t, usage = %#v, want terminal failure carrying %#v", store.failed, store.failedUsage, expected)
	}
}

func TestProcessOneReportsNoSpendWhenFailingBeforeAnyProviderCall(t *testing.T) {
	t.Parallel()
	store := newUsageStore(processing.Source{StorageRef: "media/lecture", Type: "VIDEO", SelectionKind: "CUSTOM"})
	worker := New(store, objectMock{bytes: []byte("never read")}, reportingGenerator{err: errors.New("generator must not run")})

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	expected := &processing.Usage{LLM: []processing.ModelUsage{}}
	if !store.failed || !reflect.DeepEqual(store.failedUsage, expected) {
		t.Fatalf("failed = %t, usage = %#v, want terminal failure with empty usage", store.failed, store.failedUsage)
	}
}
