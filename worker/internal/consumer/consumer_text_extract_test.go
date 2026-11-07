package consumer

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

// failingGenerator fails the test when a TEXT_EXTRACT job reaches the provider (ADR-0033: no provider call before
// credits are reserved).
type failingGenerator struct{ t *testing.T }

func (generator failingGenerator) Generate(context.Context, string) (processing.Question, error) {
	generator.t.Helper()
	generator.t.Error("a TEXT_EXTRACT job must never call the provider")
	return processing.Question{}, errors.New("provider must not run")
}

func TestProcessOneTextExtractReportsMeasuredSizeWithoutGeneration(t *testing.T) {
	t.Parallel()
	vietnamese := strings.Repeat("Xin chào các bạn ", 20)
	tests := []struct {
		name      string
		inputText string
		wantChars int
	}{
		{name: "ascii text", inputText: "document text", wantChars: len("document text")},
		{name: "multi byte text counts characters not bytes", inputText: vietnamese, wantChars: len([]rune(strings.TrimSpace(vietnamese)))},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			// Arrange
			store := &storeMock{
				job:    &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1, Type: processing.JobTypeTextExtract},
				source: processing.Source{StorageRef: "document.txt", Type: "TEXT", SelectionKind: "PLAN"},
			}
			worker := New(store, objectMock{bytes: []byte(test.inputText)}, failingGenerator{t: t})
			// Act
			err := worker.processOne(context.Background())
			// Assert
			if err != nil {
				t.Fatalf("processOne() error = %v", err)
			}
			if store.extractionSummary == nil {
				t.Fatal("CompleteExtraction was not called")
			}
			if store.extractionSummary.Chars != test.wantChars || store.extractionSummary.Chunks != 1 {
				t.Fatalf("summary = %#v, want chars=%d chunks=1", *store.extractionSummary, test.wantChars)
			}
			if store.completed || store.replaced || store.failed || store.retried {
				t.Fatalf("store state = %#v, want only CompleteExtraction", store)
			}
		})
	}
}

func TestProcessOneTextExtractFailureStaysTerminalWithoutCreditSideEffects(t *testing.T) {
	t.Parallel()
	// Arrange: an unreadable PDF fails the extraction itself.
	store := &storeMock{
		job:    &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1, Type: processing.JobTypeTextExtract},
		source: processing.Source{StorageRef: "document.pdf", Type: "PDF", SelectionKind: "PLAN"},
	}
	worker := New(store, objectMock{bytes: []byte("not a pdf")}, failingGenerator{t: t})
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.failed || store.extractionSummary != nil || store.completed {
		t.Fatalf("store state = %#v, want terminal failure and no extraction result", store)
	}
}

func TestProcessOneTextExtractLostFenceIsNotRetried(t *testing.T) {
	t.Parallel()
	// Arrange
	store := &storeMock{
		job:           &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1, Type: processing.JobTypeTextExtract},
		source:        processing.Source{StorageRef: "document.txt", Type: "TEXT", SelectionKind: "PLAN"},
		extractionErr: processing.ErrJobFenceLost,
	}
	worker := New(store, objectMock{bytes: []byte("document text")}, failingGenerator{t: t})
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if !errors.Is(err, processing.ErrJobFenceLost) {
		t.Fatalf("processOne() error = %v, want ErrJobFenceLost", err)
	}
	if store.retried || store.failed {
		t.Fatalf("store state = %#v, want no retry or failure after a lost fence", store)
	}
}

func TestProcessOneFullPipelineJobStillGeneratesAfterExtraction(t *testing.T) {
	t.Parallel()
	// Arrange: a job claimed without a type (queued before the TEXT_EXTRACT rollout) keeps the old behaviour.
	store := &storeMock{
		job:    &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source: processing.Source{StorageRef: "document.txt", Type: "TEXT", SelectionKind: "PLAN"},
	}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{})
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.completed || store.extractionSummary != nil {
		t.Fatalf("store state = %#v, want PersistAndComplete and no extraction result", store)
	}
}
