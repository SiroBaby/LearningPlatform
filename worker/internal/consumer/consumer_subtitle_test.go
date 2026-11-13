package consumer

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

// failureCapturingStore remembers the failure code handed to Fail.
type failureCapturingStore struct {
	capturingStore
	failureCode processing.FailureCode
}

func (store *failureCapturingStore) Fail(ctx context.Context, job processing.Job, failure processing.Failure) (bool, error) {
	store.failureCode = failure.Code
	return store.capturingStore.storeMock.Fail(ctx, job, failure)
}

// subtitleStore adds the optional SubtitleTranscriptStore capability.
type subtitleStore struct {
	failureCapturingStore
	segments []processing.TranscriptSegment
	err      error
	calls    int
}

func (store *subtitleStore) SubtitleSegments(context.Context, processing.Job) ([]processing.TranscriptSegment, error) {
	store.calls++
	return store.segments, store.err
}

// forbiddenObjects fails the test when a YOUTUBE job reads the raw subtitle object.
type forbiddenObjects struct{ t *testing.T }

func (objects forbiddenObjects) Read(context.Context, string, int64) ([]byte, error) {
	objects.t.Helper()
	objects.t.Error("a YOUTUBE job must read the snapshot, never the subtitle object")
	return nil, nil
}

func subtitleSegments(count int) []processing.TranscriptSegment {
	segments := make([]processing.TranscriptSegment, count)
	for index := range segments {
		// Every cue carries enough text that a handful of cues already fills a chunk.
		segments[index] = processing.TranscriptSegment{
			StartSec: float64(index) * 10,
			EndSec:   float64(index)*10 + 12,
			Text:     "Cau " + strconv.Itoa(index) + " " + strings.Repeat("noi dung bai giang ", 20),
		}
	}
	return segments
}

func youtubeJob(jobType string) *processing.Job {
	return &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1, Type: jobType}
}

func newSubtitleStore(jobType string, segments []processing.TranscriptSegment) *subtitleStore {
	return &subtitleStore{
		failureCapturingStore: failureCapturingStore{capturingStore: capturingStore{storeMock: storeMock{
			job:    youtubeJob(jobType),
			source: processing.Source{StorageRef: "owner/subtitle.vtt", Type: "YOUTUBE", SelectionKind: "PLAN"},
		}}},
		segments: segments,
	}
}

func TestProcessOneYoutubeTextExtractReportsRunesAndChunksWithoutProviderOrObjectRead(t *testing.T) {
	t.Parallel()
	// Arrange
	segments := []processing.TranscriptSegment{
		{StartSec: 0, EndSec: 4, Text: "Xin chào các bạn"},
		{StartSec: 4, EndSec: 8, Text: "hôm nay học ngăn xếp"},
	}
	store := newSubtitleStore(processing.JobTypeTextExtract, segments)
	worker := New(store, forbiddenObjects{t: t}, failingGenerator{t: t})
	wantRunes := len([]rune("Xin chào các bạn hôm nay học ngăn xếp"))
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if store.calls != 1 {
		t.Fatalf("SubtitleSegments calls = %d, want 1", store.calls)
	}
	if store.extractionSummary == nil || store.extractionSummary.Chars != wantRunes || store.extractionSummary.Chunks != 1 {
		t.Fatalf("summary = %#v, want chars=%d chunks=1", store.extractionSummary, wantRunes)
	}
	if store.completed || store.failed || store.retried {
		t.Fatalf("store state = %#v, want only CompleteExtraction", store.storeMock)
	}
}

func TestProcessOneYoutubeFullPipelineCapsQuestionsAndKeepsTimeCitations(t *testing.T) {
	t.Parallel()
	// Arrange
	store := newSubtitleStore(processing.JobTypeFullPipeline, subtitleSegments(600))
	generator := &concurrencyGenerator{}
	worker := NewWithOptions(store, forbiddenObjects{t: t}, generator, Options{MediaGenerationConcurrency: 3})
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.completed || store.failed || store.retried {
		t.Fatalf("store state = %#v, want completed", store.storeMock)
	}
	if len(store.chunks) <= processing.MaxMediaQuestions {
		t.Fatalf("chunks = %d, want more than the %d question cap for this fixture", len(store.chunks), processing.MaxMediaQuestions)
	}
	if len(store.questions) != processing.MaxMediaQuestions || generator.calls.Load() != processing.MaxMediaQuestions {
		t.Fatalf("questions = %d, provider calls = %d, want the cap %d", len(store.questions), generator.calls.Load(), processing.MaxMediaQuestions)
	}
	for position, question := range store.questions {
		chunk := store.chunks[question.ChunkIndex]
		if question.Citation.Locator.Kind != processing.LocatorKindTime || question.Citation.Locator != chunk.Locator {
			t.Fatalf("question %d citation = %#v, want the time locator of chunk %d", position, question.Citation, question.ChunkIndex)
		}
		if question.Citation.Locator.EndSec <= question.Citation.Locator.StartSec {
			t.Fatalf("question %d locator = %#v, want a positive time span", position, question.Citation.Locator)
		}
	}
}

func TestProcessOneYoutubeFailsLikeAMissingSourceWithoutTheSnapshotCapability(t *testing.T) {
	t.Parallel()
	// Arrange: a Store that does not implement SubtitleTranscriptStore.
	store := &failureCapturingStore{capturingStore: capturingStore{storeMock: storeMock{
		job:    youtubeJob(processing.JobTypeTextExtract),
		source: processing.Source{StorageRef: "owner/subtitle.vtt", Type: "YOUTUBE", SelectionKind: "PLAN"},
	}}}
	worker := New(store, forbiddenObjects{t: t}, failingGenerator{t: t})
	// Act
	err := worker.processOne(context.Background())
	// Assert
	if err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.failed || store.failureCode != processing.ObjectNotFound || store.extractionSummary != nil {
		t.Fatalf("failed=%v code=%q summary=%v, want terminal ObjectNotFound", store.failed, store.failureCode, store.extractionSummary)
	}
}

func TestProcessOneYoutubeSnapshotFailuresKeepTheirCodes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		segments []processing.TranscriptSegment
		err      error
		wantCode processing.FailureCode
	}{
		{name: "missing or unconfirmed snapshot", err: processing.Failure{Code: processing.ObjectNotFound}, wantCode: processing.ObjectNotFound},
		{name: "empty snapshot", err: processing.Failure{Code: processing.MediaTranscriptEmpty}, wantCode: processing.MediaTranscriptEmpty},
		{name: "invariant failure", err: processing.Failure{Code: processing.ProcessingFailed}, wantCode: processing.ProcessingFailed},
		{name: "cues that normalise to nothing", segments: []processing.TranscriptSegment{{StartSec: 0, EndSec: 1, Text: "   "}}, wantCode: processing.MediaTranscriptEmpty},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			// Arrange
			store := newSubtitleStore(processing.JobTypeFullPipeline, test.segments)
			store.err = test.err
			worker := New(store, forbiddenObjects{t: t}, failingGenerator{t: t})
			// Act
			err := worker.processOne(context.Background())
			// Assert
			if err != nil {
				t.Fatalf("processOne() error = %v", err)
			}
			if !store.failed || store.failureCode != test.wantCode || store.completed {
				t.Fatalf("failed=%v code=%q completed=%v, want terminal %q", store.failed, store.failureCode, store.completed, test.wantCode)
			}
		})
	}
}
