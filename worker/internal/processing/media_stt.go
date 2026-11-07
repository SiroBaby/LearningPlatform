package processing

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// MaxMediaQuestions is the question cap for media Documents (D6 of #160). PDF/TEXT keep their existing behaviour.
	MaxMediaQuestions = 30
	// derivedAudioPrefix is the only namespace the worker reads STT input from.
	derivedAudioPrefix = "derived-audio/"
	// sttSaveTimeout bounds the detached write of a paid result, so a cancelled job context never drops it.
	sttSaveTimeout = 15 * time.Second
	// DefaultSTTConcurrency is the number of chunks sent to the provider at once.
	DefaultSTTConcurrency = 3
)

// AudioChunkRef is one manifest row of derived audio written by the media probe.
type AudioChunkRef struct {
	Index       int
	Locator     ObjectLocator
	BodyStartMs int
	BodyEndMs   int
	FileStartMs int
	FileEndMs   int
}

// AudioManifest is the validated derived-audio manifest of a Document's probe result.
type AudioManifest struct {
	ProbeResultID     string
	DecodedDurationMs int
	Chunks            []AudioChunkRef
}

// STTOutcome is what one chunk dispatch cost and returned. Segments is nil when the call produced no usable result
// (invalid 2xx body, uncertain dispatch); an empty non-nil slice is a valid silent chunk. Milliseconds are the audio
// the provider received (file span, overlap included): BilledMs for a 2xx answer, UncertainMs for an unknown outcome.
type STTOutcome struct {
	ProbeResultID string
	ChunkIndex    int
	Identity      string
	Segments      []TranscriptSegment
	BilledMs      int
	UncertainMs   int
}

// MediaSTTStore is the persistence the media transcription needs. Implementations must fence SaveSTTOutcome on the
// claimed attempt (lease, attempt, deletion/cancellation) and treat a missing manifest as Failure{MediaAudioNotPrepared}.
type MediaSTTStore interface {
	CheckActive(context.Context, Job) error
	AudioManifest(context.Context, Job) (AudioManifest, error)
	STTCheckpoints(ctx context.Context, probeResultID, identity string) (map[int][]TranscriptSegment, error)
	SaveSTTOutcome(context.Context, Job, STTOutcome) error
}

// IdentifiedTranscriber is a Transcriber that names its provider configuration for checkpoint reuse.
type IdentifiedTranscriber interface {
	Transcriber
	Identity() string
}

// MediaTranscription turns the derived audio of an AUDIO/VIDEO Document into time-cited chunks. It checkpoints each
// chunk result so a technical retry or lease reclaim only pays for chunks that are still missing (D6).
type MediaTranscription struct {
	Store       MediaSTTStore
	Objects     VersionedObjectReader
	Transcriber IdentifiedTranscriber
	Language    string
	Concurrency int
}

// Chunks reads the manifest, transcribes the missing chunks with bounded concurrency, stitches the transcript and
// packs it into chunks that cite [startSec, endSec]. Failures are stable domain Failures or ErrJobFenceLost.
func (pipeline *MediaTranscription) Chunks(ctx context.Context, job Job) ([]Chunk, error) {
	manifest, err := pipeline.Store.AudioManifest(ctx, job)
	if err != nil {
		return nil, err
	}
	spans, err := manifestSpans(manifest)
	if err != nil {
		return nil, err
	}
	identity := pipeline.Transcriber.Identity()
	checkpoints, err := pipeline.Store.STTCheckpoints(ctx, manifest.ProbeResultID, identity)
	if err != nil {
		return nil, err
	}
	if err := pipeline.transcribeMissing(ctx, job, manifest, identity, checkpoints); err != nil {
		return nil, err
	}
	results := make([]AudioChunkResult, 0, len(spans))
	for _, span := range spans {
		results = append(results, AudioChunkResult{Index: span.Index, Segments: checkpoints[span.Index]})
	}
	stitched, err := StitchTranscript(float64(manifest.DecodedDurationMs)/1000, spans, results)
	if err != nil {
		return nil, Failure{Code: TranscriptionOutputInvalid}
	}
	extracted := TimedSegmentsToExtracted(stitched)
	if len(extracted) == 0 {
		return nil, Failure{Code: MediaTranscriptEmpty}
	}
	return ChunkTranscript(job.DocumentID, job.OwnerID, extracted)
}

// manifestSpans validates the manifest and converts it to stitch spans. Anything unusable is "not prepared": the
// probe contract guarantees a contiguous, bounded manifest, so a violation must not reach the paid provider.
func manifestSpans(manifest AudioManifest) ([]AudioChunkSpan, error) {
	notPrepared := Failure{Code: MediaAudioNotPrepared}
	if manifest.ProbeResultID == "" || manifest.DecodedDurationMs <= 0 || len(manifest.Chunks) == 0 || len(manifest.Chunks) > maxAudioChunks {
		return nil, notPrepared
	}
	spans := make([]AudioChunkSpan, 0, len(manifest.Chunks))
	for position, chunk := range manifest.Chunks {
		locator := chunk.Locator
		if chunk.Index != position || locator.Bucket == "" || !strings.HasPrefix(locator.Key, derivedAudioPrefix) || locator.VersionID == "" || locator.ETag == "" ||
			locator.ContentLength <= 0 || locator.ContentLength > MaxSTTChunkBytes ||
			chunk.BodyEndMs <= chunk.BodyStartMs || chunk.FileStartMs > chunk.BodyStartMs || chunk.FileEndMs < chunk.BodyEndMs || chunk.FileStartMs < 0 {
			return nil, notPrepared
		}
		spans = append(spans, AudioChunkSpan{
			Index:        chunk.Index,
			BodyStartSec: float64(chunk.BodyStartMs) / 1000,
			BodyEndSec:   float64(chunk.BodyEndMs) / 1000,
			FileStartSec: float64(chunk.FileStartMs) / 1000,
			FileEndSec:   float64(chunk.FileEndMs) / 1000,
		})
	}
	return spans, nil
}

// transcribeMissing fills checkpoints in place with the chunks it transcribed, even when another chunk failed. After the first failure no
// new chunk starts, but chunks already in flight finish and are checkpointed because they are paid for.
func (pipeline *MediaTranscription) transcribeMissing(ctx context.Context, job Job, manifest AudioManifest, identity string, checkpoints map[int][]TranscriptSegment) error {
	concurrency := pipeline.Concurrency
	if concurrency <= 0 {
		concurrency = DefaultSTTConcurrency
	}
	var (
		mutex   sync.Mutex
		waiter  sync.WaitGroup
		failure = map[int]error{}
		slots   = make(chan struct{}, concurrency)
	)
	hasFailed := func() bool {
		mutex.Lock()
		defer mutex.Unlock()
		return len(failure) > 0
	}
	pending := make([]AudioChunkRef, 0, len(manifest.Chunks))
	for _, chunk := range manifest.Chunks {
		if _, done := checkpoints[chunk.Index]; !done {
			pending = append(pending, chunk)
		}
	}
	fresh := make(map[int][]TranscriptSegment, len(pending))
	for _, chunk := range pending {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
		}
		if ctx.Err() != nil || hasFailed() {
			break
		}
		waiter.Add(1)
		go func(chunk AudioChunkRef) {
			defer waiter.Done()
			defer func() { <-slots }()
			segments, err := pipeline.transcribeChunk(ctx, job, manifest.ProbeResultID, identity, chunk)
			mutex.Lock()
			defer mutex.Unlock()
			if err != nil {
				failure[chunk.Index] = err
				return
			}
			fresh[chunk.Index] = segments
		}(chunk)
	}
	waiter.Wait()
	for index, segments := range fresh {
		checkpoints[index] = segments
	}
	return firstChunkFailure(ctx, failure)
}

// firstChunkFailure prefers a lost fence, then the lowest failing chunk, then a cancelled context, so the outcome
// does not depend on goroutine scheduling.
func firstChunkFailure(ctx context.Context, failure map[int]error) error {
	indexes := make([]int, 0, len(failure))
	for index, err := range failure {
		if errors.Is(err, ErrJobFenceLost) {
			return ErrJobFenceLost
		}
		indexes = append(indexes, index)
	}
	if len(indexes) > 0 {
		sort.Ints(indexes)
		return failure[indexes[0]]
	}
	return ctx.Err()
}

func (pipeline *MediaTranscription) transcribeChunk(ctx context.Context, job Job, probeResultID, identity string, chunk AudioChunkRef) ([]TranscriptSegment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Only a confirmed fence loss stops a paid call; a transient read error leaves the transactional fence in
	// SaveSTTOutcome and PersistAndComplete as the authority (worker/AGENTS.md).
	if err := pipeline.Store.CheckActive(ctx, job); errors.Is(err, ErrJobFenceLost) {
		return nil, ErrJobFenceLost
	}
	audio, err := pipeline.Objects.ReadVersion(ctx, chunk.Locator, MaxSTTChunkBytes)
	if err != nil {
		return nil, err
	}
	sentMs := chunk.FileEndMs - chunk.FileStartMs
	segments, err := pipeline.Transcriber.Transcribe(ctx, TranscribeRequest{ChunkIndex: chunk.Index, Language: pipeline.Language, Audio: bytes.NewReader(audio)})
	outcome := STTOutcome{ProbeResultID: probeResultID, ChunkIndex: chunk.Index, Identity: identity}
	if err == nil {
		outcome.Segments = segments
		if outcome.Segments == nil {
			outcome.Segments = []TranscriptSegment{}
		}
		outcome.BilledMs = sentMs
		return segments, pipeline.save(ctx, job, outcome)
	}
	var transcribeErr TranscribeError
	if !errors.As(err, &transcribeErr) {
		return nil, err
	}
	if transcribeErr.Billed {
		outcome.BilledMs = sentMs
	}
	if transcribeErr.Uncertain {
		outcome.UncertainMs = sentMs
	}
	if outcome.BilledMs > 0 || outcome.UncertainMs > 0 {
		if saveErr := pipeline.save(ctx, job, outcome); errors.Is(saveErr, ErrJobFenceLost) {
			return nil, saveErr
		}
	}
	return nil, err
}

// save writes a paid or uncertain result on a context detached from cancellation: a deadline or shutdown must not
// drop money already spent. The store still refuses the write when the fence is lost.
func (pipeline *MediaTranscription) save(ctx context.Context, job Job, outcome STTOutcome) error {
	saveContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), sttSaveTimeout)
	defer cancel()
	return pipeline.Store.SaveSTTOutcome(saveContext, job, outcome)
}

// SelectQuestionChunks returns the indexes (ascending) of at most limit chunks, spread evenly over the timeline when
// there are more chunks than the cap; otherwise every chunk.
func SelectQuestionChunks(chunkCount, limit int) []int {
	if limit <= 0 || chunkCount <= limit {
		selected := make([]int, chunkCount)
		for index := range selected {
			selected[index] = index
		}
		return selected
	}
	selected := make([]int, limit)
	for position := range selected {
		selected[position] = position * chunkCount / limit
	}
	return selected
}

// STTProviderIdentity hashes the provider configuration that decides whether a stored transcript is reusable. The
// API key is deliberately not part of it (ADR-0021).
func STTProviderIdentity(providerType, baseURL, model, capabilityVersion string) string {
	canonical := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if parsed, err := url.Parse(canonical); err == nil && parsed.Host != "" {
		parsed.Scheme = strings.ToLower(parsed.Scheme)
		parsed.Host = strings.ToLower(parsed.Host)
		canonical = strings.TrimRight(parsed.String(), "/")
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{providerType, canonical, model, capabilityVersion}, "\n")))
	return hex.EncodeToString(sum[:])
}

// Identity makes FakeTranscriber usable as an IdentifiedTranscriber in offline tests.
func (fake FakeTranscriber) Identity() string {
	return STTProviderIdentity("fake", "fake://transcriber", "fake", STTCapabilityVersion)
}
