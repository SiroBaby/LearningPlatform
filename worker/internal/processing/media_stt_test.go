package processing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"reflect"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const testSTTIdentity = "fake-identity"

// memorySTTStore is an in-memory MediaSTTStore with scriptable fence behaviour.
type memorySTTStore struct {
	mutex       sync.Mutex
	manifest    AudioManifest
	manifestErr error
	checkpoints map[int][]TranscriptSegment
	saved       []STTOutcome
	// activeChecks counts CheckActive calls; fenceAfter > 0 makes call number fenceAfter and later report a lost fence.
	activeChecks int
	fenceAfter   int
	// saveFenceLost makes SaveSTTOutcome report a lost fence.
	saveFenceLost bool
	// failSaves makes the first failSaves SaveSTTOutcome calls fail with a database-style error.
	failSaves int
	saveCalls int
}

func (store *memorySTTStore) CheckActive(context.Context, Job) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.activeChecks++
	if store.fenceAfter > 0 && store.activeChecks >= store.fenceAfter {
		return ErrJobFenceLost
	}
	return nil
}

func (store *memorySTTStore) AudioManifest(context.Context, Job) (AudioManifest, error) {
	return store.manifest, store.manifestErr
}

func (store *memorySTTStore) STTCheckpoints(context.Context, string, string) (map[int][]TranscriptSegment, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	copied := make(map[int][]TranscriptSegment, len(store.checkpoints))
	for index, segments := range store.checkpoints {
		copied[index] = segments
	}
	return copied, nil
}

func (store *memorySTTStore) SaveSTTOutcome(_ context.Context, _ Job, outcome STTOutcome) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.saveCalls++
	if store.saveFenceLost {
		return ErrJobFenceLost
	}
	if store.failSaves > 0 {
		store.failSaves--
		return NewPersistenceError(FailureOperationChunkReplacement, errors.New("database unavailable"))
	}
	store.saved = append(store.saved, outcome)
	return nil
}

func (store *memorySTTStore) savedOutcomes() []STTOutcome {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	outcomes := append([]STTOutcome(nil), store.saved...)
	sort.Slice(outcomes, func(left, right int) bool { return outcomes[left].ChunkIndex < outcomes[right].ChunkIndex })
	return outcomes
}

type memoryAudioObjects struct{ reads atomic.Int64 }

func (objects *memoryAudioObjects) ReadVersion(_ context.Context, locator ObjectLocator, _ int64) ([]byte, error) {
	objects.reads.Add(1)
	return []byte("audio:" + locator.Key), nil
}

// scriptedTranscriber answers per chunk index and records the calls it received.
type scriptedTranscriber struct {
	mutex    sync.Mutex
	results  map[int][]TranscriptSegment
	errs     map[int]error
	calls    []int
	audio    map[int]string
	language string
	inFlight atomic.Int64
	peak     atomic.Int64
	release  chan struct{}
}

func (transcriber *scriptedTranscriber) Identity() string { return testSTTIdentity }

func (transcriber *scriptedTranscriber) Transcribe(ctx context.Context, request TranscribeRequest) ([]TranscriptSegment, error) {
	current := transcriber.inFlight.Add(1)
	defer transcriber.inFlight.Add(-1)
	for {
		peak := transcriber.peak.Load()
		if current <= peak || transcriber.peak.CompareAndSwap(peak, current) {
			break
		}
	}
	data, _ := io.ReadAll(request.Audio)
	transcriber.mutex.Lock()
	transcriber.calls = append(transcriber.calls, request.ChunkIndex)
	if transcriber.audio == nil {
		transcriber.audio = map[int]string{}
	}
	transcriber.audio[request.ChunkIndex] = string(data)
	transcriber.language = request.Language
	transcriber.mutex.Unlock()
	if transcriber.release != nil {
		select {
		case <-transcriber.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err := transcriber.errs[request.ChunkIndex]; err != nil {
		return nil, err
	}
	return transcriber.results[request.ChunkIndex], nil
}

func (transcriber *scriptedTranscriber) calledChunks() []int {
	transcriber.mutex.Lock()
	defer transcriber.mutex.Unlock()
	calls := append([]int(nil), transcriber.calls...)
	sort.Ints(calls)
	return calls
}

// testManifest describes two 600 s bodies with 5 s overlap over 1200 s of decoded audio.
func testManifest() AudioManifest {
	return manifestWithDigests(testManifestWithoutDigests())
}

func testAudioDigest(key string) string {
	digest := sha256.Sum256([]byte("audio:" + key))
	return hex.EncodeToString(digest[:])
}

// manifestWithDigests fills each chunk's SHA256 with the digest of the bytes memoryAudioObjects serves for its key.
func manifestWithDigests(manifest AudioManifest) AudioManifest {
	for index := range manifest.Chunks {
		manifest.Chunks[index].SHA256 = testAudioDigest(manifest.Chunks[index].Locator.Key)
	}
	return manifest
}

func testManifestWithoutDigests() AudioManifest {
	locator := func(index int) ObjectLocator {
		return ObjectLocator{Bucket: "media", Key: "derived-audio/owner/document/generation/" + string(rune('0'+index)) + ".mp3", VersionID: "version", ETag: "etag", ContentLength: 2_400_000}
	}
	return AudioManifest{
		ProbeResultID:     "probe-result",
		DecodedDurationMs: 1_200_000,
		Chunks: []AudioChunkRef{
			{Index: 0, Locator: locator(0), BodyStartMs: 0, BodyEndMs: 600_000, FileStartMs: 0, FileEndMs: 600_000},
			{Index: 1, Locator: locator(1), BodyStartMs: 600_000, BodyEndMs: 1_200_000, FileStartMs: 595_000, FileEndMs: 1_200_000},
		},
	}
}

func testSegments() map[int][]TranscriptSegment {
	return map[int][]TranscriptSegment{
		0: {{StartSec: 0, EndSec: 30, Text: "Xin chào các bạn."}, {StartSec: 600, EndSec: 604, Text: "lặp ở vùng chồng lấn"}},
		1: {{StartSec: 6, EndSec: 12, Text: "lặp ở vùng chồng lấn"}, {StartSec: 100, EndSec: 140, Text: "Quang hợp là quá trình tạo năng lượng."}},
	}
}

func newMediaTranscription(store *memorySTTStore, transcriber *scriptedTranscriber, concurrency int) (*MediaTranscription, *memoryAudioObjects) {
	objects := &memoryAudioObjects{}
	return &MediaTranscription{Store: store, Objects: objects, Transcriber: transcriber, Language: "vi", Concurrency: concurrency}, objects
}

func testJob() Job {
	return Job{ID: "job", DocumentID: "document", OwnerID: "owner", Attempt: 1, LeaseID: "lease"}
}

func TestMediaTranscriptionBuildsTimeCitedChunksAndCheckpointsEveryChunk(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, objects := newMediaTranscription(store, transcriber, 2)

	chunks, err := pipeline.Chunks(context.Background(), testJob())

	if err != nil {
		t.Fatalf("Chunks() error = %v", err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks = %#v, want one packed transcript chunk", chunks)
	}
	wantText := "Xin chào các bạn. lặp ở vùng chồng lấn Quang hợp là quá trình tạo năng lượng."
	if chunks[0].Text != wantText {
		t.Fatalf("chunk text = %q, want the overlap duplicate dropped: %q", chunks[0].Text, wantText)
	}
	wantLocator := Locator{Kind: LocatorKindTime, StartSec: 0, EndSec: 735}
	if chunks[0].Locator != wantLocator {
		t.Fatalf("chunk locator = %#v, want %#v (chunk 1 starts at file offset 595 s)", chunks[0].Locator, wantLocator)
	}
	if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{0, 1}) {
		t.Fatalf("STT called for chunks %v, want [0 1]", got)
	}
	if transcriber.language != "vi" || transcriber.audio[1] != "audio:derived-audio/owner/document/generation/1.mp3" || objects.reads.Load() != 2 {
		t.Fatalf("language=%q audio=%v reads=%d", transcriber.language, transcriber.audio, objects.reads.Load())
	}
	wantOutcomes := []STTOutcome{
		{ProbeResultID: "probe-result", ChunkIndex: 0, Identity: testSTTIdentity, Segments: testSegments()[0], BilledMs: 600_000},
		{ProbeResultID: "probe-result", ChunkIndex: 1, Identity: testSTTIdentity, Segments: testSegments()[1], BilledMs: 600_000},
	}
	if got := store.savedOutcomes(); !reflect.DeepEqual(got, wantOutcomes) {
		t.Fatalf("checkpoints = %#v, want %#v", got, wantOutcomes)
	}
}

func TestMediaTranscriptionResumesFromCheckpointsWithoutPayingAgain(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), checkpoints: map[int][]TranscriptSegment{0: testSegments()[0]}}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, objects := newMediaTranscription(store, transcriber, 2)

	chunks, err := pipeline.Chunks(context.Background(), testJob())

	if err != nil || len(chunks) == 0 {
		t.Fatalf("Chunks() = (%#v, %v)", chunks, err)
	}
	if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{1}) {
		t.Fatalf("STT called for chunks %v, want only the missing chunk [1]", got)
	}
	if objects.reads.Load() != 1 {
		t.Fatalf("audio reads = %d, want 1: a checkpointed chunk must not be downloaded again", objects.reads.Load())
	}
	if got := store.savedOutcomes(); len(got) != 1 || got[0].ChunkIndex != 1 {
		t.Fatalf("saved outcomes = %#v, want only chunk 1", got)
	}
}

func TestMediaTranscriptionAcceptsASilentCheckpointedChunk(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), checkpoints: map[int][]TranscriptSegment{0: {}}}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	if _, err := pipeline.Chunks(context.Background(), testJob()); err != nil {
		t.Fatalf("Chunks() error = %v", err)
	}
	if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{1}) {
		t.Fatalf("STT called for %v, want [1]: an empty checkpoint still counts as done", got)
	}
}

func TestMediaTranscriptionStopsAtALostFenceBeforeTheNextPaidCall(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), fenceAfter: 2}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	if !errors.Is(err, ErrJobFenceLost) {
		t.Fatalf("Chunks() error = %v, want ErrJobFenceLost", err)
	}
	if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{0}) {
		t.Fatalf("STT called for %v, want only chunk 0: the fence was lost before chunk 1", got)
	}
	if got := store.savedOutcomes(); len(got) != 1 || got[0].ChunkIndex != 0 || got[0].BilledMs != 600_000 {
		t.Fatalf("saved = %#v, want the already paid chunk 0 kept", got)
	}
}

func TestMediaTranscriptionDiscardsAResultWhenTheFenceIsLostOnSave(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), saveFenceLost: true}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	if !errors.Is(err, ErrJobFenceLost) {
		t.Fatalf("Chunks() error = %v, want ErrJobFenceLost", err)
	}
	if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{0}) {
		t.Fatalf("STT called for %v, want no further call after the fenced save", got)
	}
}

func TestMediaTranscriptionRecordsUncertainAndBilledDispatches(t *testing.T) {
	uncertain := TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}
	invalid := TranscribeError{Failure: Failure{Code: TranscriptionOutputInvalid}, Sent: true, Billed: true}
	rejected := TranscribeError{Failure: Failure{Code: ProviderIncompatible}, Sent: true}
	tests := []struct {
		name        string
		err         error
		wantOutcome *STTOutcome
		wantCode    FailureCode
		technical   bool
	}{
		{"timeout is uncertain spend", uncertain, &STTOutcome{ProbeResultID: "probe-result", ChunkIndex: 0, Identity: testSTTIdentity, UncertainMs: 600_000}, ProviderUnavailable, true},
		{"2xx with unusable body is billed", invalid, &STTOutcome{ProbeResultID: "probe-result", ChunkIndex: 0, Identity: testSTTIdentity, BilledMs: 600_000}, TranscriptionOutputInvalid, false},
		{"definite rejection costs nothing", rejected, nil, ProviderIncompatible, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &memorySTTStore{manifest: testManifest()}
			transcriber := &scriptedTranscriber{results: testSegments(), errs: map[int]error{0: test.err}}
			pipeline, _ := newMediaTranscription(store, transcriber, 1)

			_, err := pipeline.Chunks(context.Background(), testJob())

			var failure Failure
			if !errors.As(err, &failure) || failure.Code != test.wantCode || failure.Technical != test.technical {
				t.Fatalf("Chunks() error = %v, want failure %s (technical=%t)", err, test.wantCode, test.technical)
			}
			saved := store.savedOutcomes()
			if test.wantOutcome == nil {
				if len(saved) != 0 {
					t.Fatalf("saved = %#v, want nothing for a definite rejection", saved)
				}
				return
			}
			if len(saved) != 1 || !reflect.DeepEqual(saved[0], *test.wantOutcome) {
				t.Fatalf("saved = %#v, want %#v", saved, *test.wantOutcome)
			}
			if got := transcriber.calledChunks(); !reflect.DeepEqual(got, []int{0}) {
				t.Fatalf("STT called for %v, want no new chunk after the first failure", got)
			}
		})
	}
}

func TestMediaTranscriptionKeepsPaidSiblingsWhenOneChunkFails(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	transcriber := &scriptedTranscriber{results: testSegments(), errs: map[int]error{0: TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}}}
	pipeline, _ := newMediaTranscription(store, transcriber, 2)

	_, err := pipeline.Chunks(context.Background(), testJob())

	var failure Failure
	if !errors.As(err, &failure) || failure.Code != ProviderUnavailable {
		t.Fatalf("Chunks() error = %v, want PROVIDER_UNAVAILABLE", err)
	}
	saved := store.savedOutcomes()
	if len(saved) != 2 || saved[0].UncertainMs != 600_000 || saved[1].ChunkIndex != 1 || saved[1].BilledMs != 600_000 || saved[1].Segments == nil {
		t.Fatalf("saved = %#v, want chunk 0 uncertain and the in-flight chunk 1 checkpointed", saved)
	}
}

func TestMediaTranscriptionBoundsConcurrency(t *testing.T) {
	const chunkCount = 6
	manifest := AudioManifest{ProbeResultID: "probe-result", DecodedDurationMs: chunkCount * 10_000}
	results := map[int][]TranscriptSegment{}
	for index := 0; index < chunkCount; index++ {
		manifest.Chunks = append(manifest.Chunks, AudioChunkRef{
			Index:       index,
			Locator:     ObjectLocator{Bucket: "media", Key: derivedAudioPrefix + "owner/doc/gen/chunk.mp3", VersionID: "v", ETag: "e", ContentLength: 1000},
			BodyStartMs: index * 10_000, BodyEndMs: (index + 1) * 10_000, FileStartMs: index * 10_000, FileEndMs: (index + 1) * 10_000,
		})
		results[index] = []TranscriptSegment{{StartSec: 1, EndSec: 2, Text: "doan van"}}
	}
	store := &memorySTTStore{manifest: manifestWithDigests(manifest)}
	release := make(chan struct{})
	transcriber := &scriptedTranscriber{results: results, release: release}
	pipeline, _ := newMediaTranscription(store, transcriber, 2)
	done := make(chan error, 1)
	go func() {
		_, err := pipeline.Chunks(context.Background(), testJob())
		done <- err
	}()

	for len(transcriber.calledChunks()) < 2 {
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("Chunks() error = %v", err)
	}

	if peak := transcriber.peak.Load(); peak != 2 {
		t.Fatalf("peak concurrent STT calls = %d, want exactly the configured bound 2", peak)
	}
	if got := transcriber.calledChunks(); len(got) != chunkCount {
		t.Fatalf("STT calls = %v, want one per chunk", got)
	}
}

func TestMediaTranscriptionRejectsAnUnusableManifestBeforeAnyPaidCall(t *testing.T) {
	mutate := func(change func(*AudioManifest)) AudioManifest {
		manifest := testManifest()
		change(&manifest)
		return manifest
	}
	tests := map[string]AudioManifest{
		"no chunks":             mutate(func(manifest *AudioManifest) { manifest.Chunks = nil }),
		"no decoded duration":   mutate(func(manifest *AudioManifest) { manifest.DecodedDurationMs = 0 }),
		"index gap":             mutate(func(manifest *AudioManifest) { manifest.Chunks[1].Index = 2 }),
		"outside derived-audio": mutate(func(manifest *AudioManifest) { manifest.Chunks[0].Locator.Key = "media/source.mp4" }),
		"missing version":       mutate(func(manifest *AudioManifest) { manifest.Chunks[0].Locator.VersionID = "" }),
		"oversized chunk":       mutate(func(manifest *AudioManifest) { manifest.Chunks[0].Locator.ContentLength = MaxSTTChunkBytes + 1 }),
		"body not increasing":   mutate(func(manifest *AudioManifest) { manifest.Chunks[0].BodyEndMs = 0 }),
		"missing digest":        mutate(func(manifest *AudioManifest) { manifest.Chunks[0].SHA256 = "" }),
		"malformed digest":      mutate(func(manifest *AudioManifest) { manifest.Chunks[0].SHA256 = "XYZ" }),
		"file inside body":      mutate(func(manifest *AudioManifest) { manifest.Chunks[1].FileStartMs = 600_001 }),
	}
	for name, manifest := range tests {
		t.Run(name, func(t *testing.T) {
			store := &memorySTTStore{manifest: manifest}
			transcriber := &scriptedTranscriber{results: testSegments()}
			pipeline, objects := newMediaTranscription(store, transcriber, 1)

			_, err := pipeline.Chunks(context.Background(), testJob())

			assertFailure(t, err, MediaAudioNotPrepared, false)
			if len(transcriber.calledChunks()) != 0 || objects.reads.Load() != 0 {
				t.Fatal("an unusable manifest must not reach storage or the STT provider")
			}
		})
	}
}

func TestMediaTranscriptionPropagatesAMissingManifestFailure(t *testing.T) {
	store := &memorySTTStore{manifestErr: Failure{Code: MediaAudioNotPrepared}}
	pipeline, _ := newMediaTranscription(store, &scriptedTranscriber{}, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	assertFailure(t, err, MediaAudioNotPrepared, false)
}

func TestMediaTranscriptionEmptyTranscriptIsABusinessFailure(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	transcriber := &scriptedTranscriber{results: map[int][]TranscriptSegment{0: {{StartSec: 1, EndSec: 2, Text: "   "}}, 1: {}}}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	assertFailure(t, err, MediaTranscriptEmpty, false)
	if got := store.savedOutcomes(); len(got) != 2 {
		t.Fatalf("saved = %#v, want both paid chunks checkpointed before the verdict", got)
	}
}

func TestMediaTranscriptionRejectsTimestampsBeyondTheDecodedDuration(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	transcriber := &scriptedTranscriber{results: map[int][]TranscriptSegment{0: {{StartSec: 0, EndSec: 9_000, Text: "qua dai"}}, 1: {}}}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	assertFailure(t, err, TranscriptionOutputInvalid, false)
}

func TestMediaTranscriptionReturnsTheContextErrorWhenCancelled(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := pipeline.Chunks(ctx, testJob())

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Chunks() error = %v, want context.Canceled", err)
	}
	if len(transcriber.calledChunks()) != 0 {
		t.Fatal("a cancelled job must not start a paid call")
	}
}

func TestSelectQuestionChunksSpreadsEvenlyOverTheTimeline(t *testing.T) {
	tests := []struct {
		count, limit int
		want         []int
	}{
		{count: 0, limit: 30, want: []int{}},
		{count: 3, limit: 30, want: []int{0, 1, 2}},
		{count: 30, limit: 30, want: nil},
		{count: 6, limit: 3, want: []int{0, 2, 4}},
		{count: 7, limit: 3, want: []int{0, 2, 4}},
	}
	for _, test := range tests {
		got := SelectQuestionChunks(test.count, test.limit)
		if test.want != nil && !reflect.DeepEqual(got, test.want) {
			t.Fatalf("SelectQuestionChunks(%d, %d) = %v, want %v", test.count, test.limit, got, test.want)
		}
		if len(got) > test.limit || !sort.IntsAreSorted(got) {
			t.Fatalf("SelectQuestionChunks(%d, %d) = %v, want at most %d ascending indexes", test.count, test.limit, got, test.limit)
		}
		seen := map[int]bool{}
		for _, index := range got {
			if index < 0 || index >= test.count || seen[index] {
				t.Fatalf("SelectQuestionChunks(%d, %d) = %v has an invalid or duplicate index", test.count, test.limit, got)
			}
			seen[index] = true
		}
	}
	if got := SelectQuestionChunks(95, MaxMediaQuestions); len(got) != MaxMediaQuestions || got[0] != 0 || got[len(got)-1] < 90 {
		t.Fatalf("SelectQuestionChunks(95, 30) = %v, want 30 indexes spanning the whole transcript", got)
	}
}

func TestFakeTranscriberIsAnIdentifiedTranscriber(t *testing.T) {
	var transcriber IdentifiedTranscriber = FakeTranscriber{Results: testSegments()}
	if len(transcriber.Identity()) != 64 {
		t.Fatalf("identity = %q, want a 64 char hex digest", transcriber.Identity())
	}
}

func TestMediaTranscriptionFailsClosedWhenTheChunkBytesDifferFromTheManifestDigest(t *testing.T) {
	manifest := testManifest()
	manifest.Chunks[0].SHA256 = testAudioDigest("other bytes")
	store := &memorySTTStore{manifest: manifest}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)

	_, err := pipeline.Chunks(context.Background(), testJob())

	assertFailure(t, err, ProcessingFailed, true)
	if got := transcriber.calledChunks(); len(got) != 0 {
		t.Fatalf("STT called for %v, want no paid call for tampered audio", got)
	}
}

func TestMediaTranscriptionRetriesAFailedCheckpointWrite(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), failSaves: 2}
	transcriber := &scriptedTranscriber{results: testSegments()}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)
	pipeline.SaveBackoff = []time.Duration{time.Millisecond, time.Millisecond}
	tracker := NewUsageTracker()

	_, err := pipeline.Chunks(WithUsageTracker(context.Background(), tracker), testJob())

	if err != nil {
		t.Fatalf("Chunks() error = %v", err)
	}
	if got := store.savedOutcomes(); len(got) != 2 || got[0].BilledMs != 600_000 {
		t.Fatalf("saved = %#v, want both chunks written after the retries", got)
	}
	if unsaved := tracker.UnsavedSTT(); len(unsaved) != 0 {
		t.Fatalf("unsaved = %#v, want none once a retry succeeded", unsaved)
	}
}

func TestMediaTranscriptionCarriesSpendInMemoryWhenCheckpointWritesKeepFailing(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), failSaves: 1000}
	transcriber := &scriptedTranscriber{results: testSegments(), errs: map[int]error{1: TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}}}
	pipeline, _ := newMediaTranscription(store, transcriber, 1)
	pipeline.SaveBackoff = []time.Duration{time.Millisecond, time.Millisecond}
	tracker := NewUsageTracker()

	_, err := pipeline.Chunks(WithUsageTracker(context.Background(), tracker), testJob())

	var failure Failure
	if !errors.As(err, &failure) || failure.Code != ProviderUnavailable {
		t.Fatalf("Chunks() error = %v, want the chunk 1 failure", err)
	}
	unsaved := tracker.UnsavedSTT()
	if len(unsaved) != 2 {
		t.Fatalf("unsaved = %#v, want chunk 0 (billed, with segments) and chunk 1 (uncertain)", unsaved)
	}
	sort.Slice(unsaved, func(left, right int) bool { return unsaved[left].ChunkIndex < unsaved[right].ChunkIndex })
	if unsaved[0].BilledMs != 600_000 || unsaved[0].Segments == nil || unsaved[1].UncertainMs != 600_000 || unsaved[1].BilledMs != 0 {
		t.Fatalf("unsaved = %#v", unsaved)
	}
	if store.saveCalls < 2*sttSaveAttempts {
		t.Fatalf("save calls = %d, want %d attempts per outcome", store.saveCalls, sttSaveAttempts)
	}
}

func TestMediaTranscriptionNeverRetriesAFencedSave(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest(), saveFenceLost: true}
	pipeline, _ := newMediaTranscription(store, &scriptedTranscriber{results: testSegments()}, 1)
	pipeline.SaveBackoff = []time.Duration{time.Millisecond}

	_, err := pipeline.Chunks(WithUsageTracker(context.Background(), NewUsageTracker()), testJob())

	if !errors.Is(err, ErrJobFenceLost) || store.saveCalls != 1 {
		t.Fatalf("Chunks() error = %v after %d save calls, want ErrJobFenceLost after exactly one", err, store.saveCalls)
	}
}

func TestMediaTranscriptionBillsTheBodySpanNotTheOverlap(t *testing.T) {
	store := &memorySTTStore{manifest: testManifest()}
	pipeline, _ := newMediaTranscription(store, &scriptedTranscriber{results: testSegments()}, 1)

	if _, err := pipeline.Chunks(context.Background(), testJob()); err != nil {
		t.Fatalf("Chunks() error = %v", err)
	}

	total := 0
	for _, outcome := range store.savedOutcomes() {
		total += outcome.BilledMs
	}
	if total != 1_200_000 {
		t.Fatalf("billed = %d ms, want the decoded duration 1200000 (overlap is platform cost)", total)
	}
}
