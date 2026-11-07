package consumer

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

type mediaMock struct {
	chunks []processing.Chunk
	err    error
	calls  atomic.Int64
}

func (media *mediaMock) Chunks(context.Context, processing.Job) ([]processing.Chunk, error) {
	media.calls.Add(1)
	return media.chunks, media.err
}

func timeChunks(count int) []processing.Chunk {
	chunks := make([]processing.Chunk, count)
	for index := range chunks {
		chunks[index] = processing.Chunk{
			ID:      "chunk-" + strconv.Itoa(index),
			Index:   index,
			Text:    "doan van " + strconv.Itoa(index),
			Locator: processing.Locator{Kind: processing.LocatorKindTime, StartSec: float64(index) * 60, EndSec: float64(index)*60 + 59.5},
		}
	}
	return chunks
}

// capturingStore records the chunks and questions handed to PersistAndComplete.
type capturingStore struct {
	storeMock
	mutex     sync.Mutex
	chunks    []processing.Chunk
	questions []processing.Question
}

func (store *capturingStore) PersistAndComplete(ctx context.Context, job processing.Job, chunks []processing.Chunk, questions []processing.Question) (bool, error) {
	store.mutex.Lock()
	store.chunks, store.questions = chunks, questions
	store.mutex.Unlock()
	return store.storeMock.PersistAndComplete(ctx, job, chunks, questions)
}

// concurrencyGenerator tracks how many Generate calls run at once and echoes the chunk text as the stem.
type concurrencyGenerator struct {
	inFlight, peak, calls atomic.Int64
	release               chan struct{}
	err                   error
}

func (generator *concurrencyGenerator) Generate(ctx context.Context, source string) (processing.Question, error) {
	generator.calls.Add(1)
	current := generator.inFlight.Add(1)
	defer generator.inFlight.Add(-1)
	for {
		peak := generator.peak.Load()
		if current <= peak || generator.peak.CompareAndSwap(peak, current) {
			break
		}
	}
	if generator.release != nil {
		select {
		case <-generator.release:
		case <-ctx.Done():
			return processing.Question{}, ctx.Err()
		}
	}
	if generator.err != nil {
		return processing.Question{}, generator.err
	}
	return processing.Question{Stem: source}, nil
}

func mediaJob() *processing.Job {
	return &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}
}

func TestProcessOneUsesMediaTranscriptionAndCapsQuestionsAtThirty(t *testing.T) {
	t.Parallel()
	for _, mediaType := range []string{"AUDIO", "VIDEO"} {
		t.Run(mediaType, func(t *testing.T) {
			t.Parallel()
			store := &capturingStore{storeMock: storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: mediaType, SelectionKind: "PLAN"}}}
			media := &mediaMock{chunks: timeChunks(95)}
			generator := &concurrencyGenerator{}
			worker := NewWithOptions(store, objectMock{bytes: []byte("the source object must not be read")}, generator, Options{Media: media, MediaGenerationConcurrency: 3})

			if err := worker.processOne(context.Background()); err != nil {
				t.Fatalf("processOne() error = %v", err)
			}

			if !store.completed || store.failed || store.retried {
				t.Fatalf("store state = %#v, want completed", store.storeMock)
			}
			if len(store.chunks) != 95 {
				t.Fatalf("persisted chunks = %d, want every transcript chunk kept", len(store.chunks))
			}
			if len(store.questions) != processing.MaxMediaQuestions || generator.calls.Load() != processing.MaxMediaQuestions {
				t.Fatalf("questions = %d, provider calls = %d, want the cap %d", len(store.questions), generator.calls.Load(), processing.MaxMediaQuestions)
			}
			previousChunk := -1
			for position, question := range store.questions {
				chunk := store.chunks[question.ChunkIndex]
				if question.Ordinal != position || question.ChunkIndex <= previousChunk || question.Stem != chunk.Text || question.ChunkID != chunk.ID {
					t.Fatalf("question %d = %#v: ordinal, order or chunk binding is wrong", position, question)
				}
				if question.Citation.Locator.Kind != processing.LocatorKindTime || question.Citation.Locator != chunk.Locator || question.Citation.Snippet != chunk.Text {
					t.Fatalf("question %d citation = %#v, want the time locator of its chunk", position, question.Citation)
				}
				previousChunk = question.ChunkIndex
			}
			if last := store.questions[len(store.questions)-1].ChunkIndex; last < 90 {
				t.Fatalf("last cited chunk = %d, want questions spread over the whole media", last)
			}
			if peak := generator.peak.Load(); peak > 3 {
				t.Fatalf("peak generation concurrency = %d, want at most 3", peak)
			}
		})
	}
}

func TestProcessOneGeneratesMediaQuestionsConcurrentlyButBounded(t *testing.T) {
	t.Parallel()
	store := &capturingStore{storeMock: storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: "AUDIO", SelectionKind: "PLAN"}}}
	release := make(chan struct{})
	generator := &concurrencyGenerator{release: release}
	worker := NewWithOptions(store, objectMock{}, generator, Options{Media: &mediaMock{chunks: timeChunks(10)}, MediaGenerationConcurrency: 4})
	done := make(chan error, 1)
	go func() { done <- worker.processOne(context.Background()) }()

	for generator.inFlight.Load() < 4 {
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	if peak := generator.peak.Load(); peak != 4 {
		t.Fatalf("peak generation concurrency = %d, want exactly the configured 4", peak)
	}
	if len(store.questions) != 10 {
		t.Fatalf("questions = %d, want 10", len(store.questions))
	}
}

func TestProcessOneStopsMediaGenerationAfterTheFirstProviderFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: "AUDIO", SelectionKind: "PLAN"}, retryResult: processing.RetryResult{Scheduled: true}}
	generator := &concurrencyGenerator{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}
	worker := NewWithOptions(store, objectMock{}, generator, Options{Media: &mediaMock{chunks: timeChunks(30)}, MediaGenerationConcurrency: 2})

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	if !store.retried || store.completed {
		t.Fatalf("store state = %#v, want a technical retry", store)
	}
	if calls := generator.calls.Load(); calls >= 30 {
		t.Fatalf("provider calls = %d, want generation to stop after the first failure", calls)
	}
}

func TestProcessOneClassifiesMediaTranscriptionFailures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		err       error
		wantRetry bool
		wantFail  bool
	}{
		{name: "empty transcript is final", err: processing.Failure{Code: processing.MediaTranscriptEmpty}, wantFail: true},
		{name: "audio not prepared is final", err: processing.Failure{Code: processing.MediaAudioNotPrepared}, wantFail: true},
		{name: "provider rejection is final", err: processing.TranscribeError{Failure: processing.Failure{Code: processing.ProviderIncompatible}, Sent: true}, wantFail: true},
		{name: "invalid output is final", err: processing.TranscribeError{Failure: processing.Failure{Code: processing.TranscriptionOutputInvalid}, Sent: true, Billed: true}, wantFail: true},
		{name: "uncertain dispatch is retried", err: processing.TranscribeError{Failure: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}, wantRetry: true},
		{name: "unknown error is retried", err: errors.New("raw storage error"), wantRetry: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			store := &storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: "VIDEO", SelectionKind: "PLAN"}, retryResult: processing.RetryResult{Scheduled: true}}
			generator := &concurrencyGenerator{}
			worker := NewWithOptions(store, objectMock{}, generator, Options{Media: &mediaMock{err: test.err}})

			if err := worker.processOne(context.Background()); err != nil {
				t.Fatalf("processOne() error = %v", err)
			}

			if store.retried != test.wantRetry || store.failed != test.wantFail || store.completed {
				t.Fatalf("store state = %#v, want retry=%t fail=%t", store, test.wantRetry, test.wantFail)
			}
			if generator.calls.Load() != 0 {
				t.Fatal("a failed transcription must not reach question generation")
			}
		})
	}
}

func TestProcessOneEndsAsFencedWhenMediaTranscriptionLosesTheFence(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: "AUDIO", SelectionKind: "PLAN"}, retryResult: processing.RetryResult{Scheduled: true}}
	worker := NewWithOptions(store, objectMock{}, &concurrencyGenerator{}, Options{Media: &mediaMock{err: processing.ErrJobFenceLost}})

	if err := worker.processOne(context.Background()); !errors.Is(err, processing.ErrJobFenceLost) {
		t.Fatalf("processOne() error = %v, want ErrJobFenceLost", err)
	}
	if store.retried || store.failed || store.completed {
		t.Fatalf("store state = %#v, want no retry, failure or completion after a lost fence", store)
	}
}

func TestProcessOneKeepsTheExistingMediaPathWhenMediaTranscriptionIsOff(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: mediaJob(), source: processing.Source{StorageRef: "media/lecture", Type: "AUDIO", SelectionKind: "PLAN"}}
	worker := New(store, objectMock{bytes: []byte("object bytes")}, generatorMock{})

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	if !store.failed || store.completed || store.retried {
		t.Fatalf("store state = %#v, want the pre-existing terminal failure for media without STT", store)
	}
}

func TestMediaFailureCodesMapToStableComponents(t *testing.T) {
	t.Parallel()
	tests := map[processing.FailureCode]failureComponent{
		processing.MediaAudioNotPrepared:      failureComponentExtraction,
		processing.MediaTranscriptEmpty:       failureComponentExtraction,
		processing.TranscriptionOutputInvalid: failureComponentProvider,
		processing.ProviderIncompatible:       failureComponentProvider,
	}
	for code, want := range tests {
		if got := failureComponentFor(failureComponentUnknown, code); got != want {
			t.Fatalf("failureComponentFor(%s) = %s, want %s", code, got, want)
		}
	}
}

func TestNewWithOptionsBoundsMediaGenerationConcurrency(t *testing.T) {
	t.Parallel()
	if got := NewWithOptions(nil, nil, nil, Options{}).options.MediaGenerationConcurrency; got != defaultMediaGenerationConcurrency {
		t.Fatalf("default media generation concurrency = %d, want %d", got, defaultMediaGenerationConcurrency)
	}
	if got := NewWithOptions(nil, nil, nil, Options{MediaGenerationConcurrency: 100}).options.MediaGenerationConcurrency; got != maxMediaGenerationConcurrency {
		t.Fatalf("clamped media generation concurrency = %d, want %d", got, maxMediaGenerationConcurrency)
	}
}
