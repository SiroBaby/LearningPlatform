package mediaprobe

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestValidateDecodedDurationAppliesMaxOfFiveSecondsAndTwoPercent(t *testing.T) {
	tests := []struct {
		name        string
		metadataSec float64
		decodedMs   int64
		wantCode    FailureCode
	}{
		{name: "exact match", metadataSec: 100, decodedMs: 100000},
		{name: "five second floor accepts +5.0 on a short file", metadataSec: 100, decodedMs: 105000},
		{name: "five second floor rejects +5.1 on a short file", metadataSec: 100, decodedMs: 105100, wantCode: FailureDurationMismatch},
		{name: "five second floor accepts -5.0", metadataSec: 100, decodedMs: 95000},
		{name: "five second floor rejects -5.1", metadataSec: 100, decodedMs: 94900, wantCode: FailureDurationMismatch},
		{name: "two percent accepts +20 s on 1000 s", metadataSec: 1000, decodedMs: 1020000},
		{name: "two percent rejects +20.1 s on 1000 s", metadataSec: 1000, decodedMs: 1020100, wantCode: FailureDurationMismatch},
		{name: "two percent rejects metadata that overstates the audio", metadataSec: 3600, decodedMs: 3500000, wantCode: FailureDurationMismatch},
		{name: "decoded at the policy maximum is accepted", metadataSec: 7200, decodedMs: 7200000},
		{name: "decoded beyond the policy maximum is a distinct error", metadataSec: 7200, decodedMs: 7200001, wantCode: FailureDurationExceeded},
		{name: "exceeded wins over mismatch", metadataSec: 60, decodedMs: 9000000, wantCode: FailureDurationExceeded},
		{name: "nothing decoded", metadataSec: 60, decodedMs: 0, wantCode: FailureAudioPrep},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateDecodedDuration(test.metadataSec, test.decodedMs)
			if test.wantCode == "" {
				if err != nil {
					t.Fatalf("ValidateDecodedDuration() error = %v, want nil", err)
				}
				return
			}
			var failure Failure
			if !errors.As(err, &failure) || failure.Code != test.wantCode || failure.Technical {
				t.Fatalf("ValidateDecodedDuration() error = %v, want permanent %s", err, test.wantCode)
			}
		})
	}
}

func TestPlanAudioChunksBuildsDeterministicManifest(t *testing.T) {
	job := Job{OwnerID: "owner", DocumentID: "document", ProbeGeneration: "generation"}
	tests := []struct {
		name      string
		decodedMs int64
		want      []AudioChunk
	}{
		{
			name: "short media is a single chunk", decodedMs: 30000,
			want: []AudioChunk{{Index: 0, BodyStartMs: 0, BodyEndMs: 30000, FileStartMs: 0, FileEndMs: 30000}},
		},
		{
			name: "three chunks with overlap and exact end", decodedMs: 1300500,
			want: []AudioChunk{
				{Index: 0, BodyStartMs: 0, BodyEndMs: 600000, FileStartMs: 0, FileEndMs: 605000},
				{Index: 1, BodyStartMs: 600000, BodyEndMs: 1200000, FileStartMs: 595000, FileEndMs: 1205000},
				{Index: 2, BodyStartMs: 1200000, BodyEndMs: 1300500, FileStartMs: 1195000, FileEndMs: 1300500},
			},
		},
		{
			name: "a tail shorter than twice the overlap merges into the previous chunk", decodedMs: 605000,
			want: []AudioChunk{{Index: 0, BodyStartMs: 0, BodyEndMs: 605000, FileStartMs: 0, FileEndMs: 605000}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := planAudioChunks(job, "media", test.decodedMs)
			if err != nil {
				t.Fatalf("planAudioChunks() error = %v", err)
			}
			if len(actual) != len(test.want) {
				t.Fatalf("planAudioChunks() returned %d chunks, want %d: %#v", len(actual), len(test.want), actual)
			}
			for index, want := range test.want {
				got := actual[index]
				wantKey := fmt.Sprintf("derived-audio/owner/document/generation/%04d.mp3", index)
				if got.Index != want.Index || got.Key != wantKey || got.Bucket != "media" ||
					got.BodyStartMs != want.BodyStartMs || got.BodyEndMs != want.BodyEndMs ||
					got.FileStartMs != want.FileStartMs || got.FileEndMs != want.FileEndMs {
					t.Fatalf("chunk %d = %#v, want %#v with key %s", index, got, want, wantKey)
				}
			}
		})
	}
}

func TestPlanAudioChunksRejectsDurationBeyondPolicy(t *testing.T) {
	if _, err := planAudioChunks(Job{}, "media", 7200001); err == nil {
		t.Fatal("planAudioChunks() accepted a duration beyond the policy maximum")
	}
}

func TestDerivedAudioKeyStaysInsidePrefix(t *testing.T) {
	key := DerivedAudioKey(Job{OwnerID: "o", DocumentID: "d", ProbeGeneration: "g"}, 7)
	if !strings.HasPrefix(key, DerivedAudioPrefix) || key != "derived-audio/o/d/g/0007.mp3" {
		t.Fatalf("DerivedAudioKey() = %q", key)
	}
}

type audioPrepFixture struct {
	job     Job
	store   *audioPrepStore
	objects *probeObjectStore
	encoder *fakeEncoder
	derived *fakeDerivedStore
	chunks  *fakeChunkStore
	logs    *bytes.Buffer
	tempDir string
	worker  *Worker
}

func newAudioPrepFixture(t *testing.T, decodedMs int64, metadataDuration string) *audioPrepFixture {
	t.Helper()
	job := Job{
		ID: "job", DocumentID: "document", OwnerID: "owner", ProbeGeneration: "generation",
		SourceBucket: "media", SourceKey: "media/owner/video.mp4", Attempt: 1, LeaseID: "lease",
		Locator: &Locator{Bucket: "media", Key: "media/owner/video.mp4", VersionID: "version-1", ETag: "etag-1", ContentLength: 4},
	}
	metadata := validProbeMetadata()
	metadata.Format.Duration = metadataDuration
	fixture := &audioPrepFixture{
		job:     job,
		store:   &audioPrepStore{probeStore: &probeStore{job: job}},
		objects: &probeObjectStore{data: []byte("data")},
		encoder: &fakeEncoder{decodedMs: decodedMs},
		derived: &fakeDerivedStore{},
		chunks:  &fakeChunkStore{},
		logs:    &bytes.Buffer{},
		tempDir: t.TempDir(),
	}
	fixture.worker = NewWorker(fixture.store, fixture.objects, probeRunner{metadata: metadata}, slog.New(slog.NewJSONHandler(fixture.logs, nil)), Options{
		TempDir: fixture.tempDir, MaxDownloadSize: 10, MediaBucket: "media", FenceCheckInterval: 5 * time.Millisecond,
		AudioPrep: &AudioPrep{Encoder: fixture.encoder, Objects: fixture.derived, Chunks: fixture.chunks},
	})
	fixture.store.chunks = fixture.chunks
	return fixture
}

func (fixture *audioPrepFixture) assertTempDirEmpty(t *testing.T) {
	t.Helper()
	entries, err := os.ReadDir(fixture.tempDir)
	if err != nil {
		t.Fatalf("ReadDir(tempDir): %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary files remain: %v", entries)
	}
}

func TestWorkerPreparesAudioChunksBeforeCompleting(t *testing.T) {
	fixture := newAudioPrepFixture(t, 1300500, "1300.2")

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if len(fixture.derived.puts) != 3 || len(fixture.chunks.saved) != 3 {
		t.Fatalf("uploaded %d chunks, saved %d rows, want 3 each", len(fixture.derived.puts), len(fixture.chunks.saved))
	}
	for index, put := range fixture.derived.puts {
		wantKey := fmt.Sprintf("derived-audio/owner/document/generation/%04d.mp3", index)
		if put.Bucket != "media" || put.Key != wantKey || put.ContentType != "audio/mpeg" {
			t.Fatalf("put %d = %#v, want key %s in media bucket", index, put, wantKey)
		}
		saved := fixture.chunks.saved[index]
		if saved.VersionID != fmt.Sprintf("v-%d", index) || saved.SizeBytes != int64(len(fakeAudioBytes(index))) || len(saved.SHA256) != 64 {
			t.Fatalf("saved chunk %d = %#v, want exact VersionId, size, and sha256", index, saved)
		}
	}
	if fixture.store.result.DecodedDurationMs != 1300500 || fixture.store.result.AudioChunkCount != 3 || fixture.store.result.DurationSec != 1301 {
		t.Fatalf("completed result = %#v, want decoded 1300500 ms, 3 chunks, metadata ceil 1301 s", fixture.store.result)
	}
	if fixture.store.chunksAtComplete != 3 {
		t.Fatalf("chunks recorded when Complete ran = %d, want 3 (manifest before completion)", fixture.store.chunksAtComplete)
	}
	for _, request := range fixture.encoder.extracted {
		if request.MaxBytes != 25*1024*1024 || request.SourcePath == "" || request.DestPath == "" {
			t.Fatalf("extract request = %#v, want 25 MiB cap and absolute paths", request)
		}
	}
	fixture.assertTempDirEmpty(t)
}

func TestWorkerReusesCheckpointedChunksOnReplay(t *testing.T) {
	fixture := newAudioPrepFixture(t, 1300500, "1300.2")
	planned, err := planAudioChunks(fixture.job, "media", 1300500)
	if err != nil {
		t.Fatalf("planAudioChunks() error = %v", err)
	}
	for _, chunk := range planned[:2] {
		chunk.VersionID, chunk.ETag, chunk.SHA256, chunk.SizeBytes = "old-version", "etag", strings.Repeat("a", 64), 10
		fixture.chunks.saved = append(fixture.chunks.saved, chunk)
	}

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if len(fixture.derived.puts) != 1 || fixture.derived.puts[0].Key != planned[2].Key {
		t.Fatalf("puts = %#v, want only the missing chunk %s", fixture.derived.puts, planned[2].Key)
	}
	if fixture.store.result.AudioChunkCount != 3 || fixture.chunks.saved[0].VersionID != "old-version" {
		t.Fatalf("replay result = %#v, rows = %#v, want reused rows kept", fixture.store.result, fixture.chunks.saved)
	}
}

func TestWorkerRejectsStoredChunkThatDoesNotMatchPlan(t *testing.T) {
	fixture := newAudioPrepFixture(t, 1300500, "1300.2")
	fixture.chunks.saved = []AudioChunk{{
		Index: 0, Bucket: "media", Key: DerivedAudioKey(fixture.job, 0), VersionID: "old",
		BodyStartMs: 0, BodyEndMs: 500000, FileStartMs: 0, FileEndMs: 505000,
	}}

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if fixture.store.failedCode != FailureAudioPrep || len(fixture.derived.puts) != 0 || fixture.store.completed {
		t.Fatalf("failed=%s puts=%d completed=%v, want MEDIA_AUDIO_PREP_FAILED without upload", fixture.store.failedCode, len(fixture.derived.puts), fixture.store.completed)
	}
	if !strings.Contains(fixture.logs.String(), `"reason":"plan_mismatch"`) {
		t.Fatalf("log = %s, want plan_mismatch reason", fixture.logs.String())
	}
}

func TestWorkerRejectsDecodedDurationThatDeviatesFromMetadata(t *testing.T) {
	tests := []struct {
		name      string
		decodedMs int64
		metadata  string
		wantCode  FailureCode
	}{
		{name: "metadata overstates", decodedMs: 60000, metadata: "120", wantCode: FailureDurationMismatch},
		{name: "metadata understates", decodedMs: 3600000, metadata: "600", wantCode: FailureDurationMismatch},
		{name: "decoded beyond maximum", decodedMs: 7300000, metadata: "7200", wantCode: FailureDurationExceeded},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newAudioPrepFixture(t, test.decodedMs, test.metadata)

			if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
				t.Fatalf("ProcessClaimed() error = %v", err)
			}

			if fixture.store.failedCode != test.wantCode || fixture.store.failCalls != 1 || fixture.store.retryCalls != 0 {
				t.Fatalf("failed=%s fail=%d retry=%d, want one permanent %s", fixture.store.failedCode, fixture.store.failCalls, fixture.store.retryCalls, test.wantCode)
			}
			if len(fixture.derived.puts) != 0 || fixture.store.completed {
				t.Fatalf("puts=%d completed=%v, want no upload and no completion", len(fixture.derived.puts), fixture.store.completed)
			}
			fixture.assertTempDirEmpty(t)
		})
	}
}

func TestWorkerFailsClosedWhenPutObjectIsDenied(t *testing.T) {
	fixture := newAudioPrepFixture(t, 30000, "30")
	fixture.derived.err = DerivedAudioError{Reason: DerivedAudioReasonAccessDenied, Failure: Failure{Code: FailureAudioPrep}}

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if fixture.store.failedCode != FailureAudioPrep || fixture.store.retryCalls != 0 || fixture.store.completed || len(fixture.chunks.saved) != 0 {
		t.Fatalf("failed=%s retry=%d completed=%v rows=%d, want final MEDIA_AUDIO_PREP_FAILED and no manifest",
			fixture.store.failedCode, fixture.store.retryCalls, fixture.store.completed, len(fixture.chunks.saved))
	}
	logged := fixture.logs.String()
	if !strings.Contains(logged, `"event":"media_probe_worker.audio_prep.failed"`) || !strings.Contains(logged, `"reason":"access_denied"`) {
		t.Fatalf("log = %s, want audio_prep.failed with access_denied reason", logged)
	}
	for _, forbidden := range []string{"derived-audio", "owner", "document", "AccessDenied"} {
		if strings.Contains(logged, forbidden) {
			t.Fatalf("log leaks %q: %s", forbidden, logged)
		}
	}
	fixture.assertTempDirEmpty(t)
}

func TestWorkerRetriesTemporaryUploadFailure(t *testing.T) {
	fixture := newAudioPrepFixture(t, 30000, "30")
	fixture.derived.err = Failure{Code: FailureMediaProbeStorageTemporary, Technical: true}

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if fixture.store.retryCalls != 1 || fixture.store.failCalls != 0 || fixture.store.completed {
		t.Fatalf("retry=%d fail=%d completed=%v, want one scheduled retry", fixture.store.retryCalls, fixture.store.failCalls, fixture.store.completed)
	}
}

func TestWorkerDoesNotUploadAfterFenceIsLost(t *testing.T) {
	fixture := newAudioPrepFixture(t, 30000, "30")
	fixture.encoder.onExtract = func(ExtractRequest) { fixture.store.probeStore.fenced = true }

	err := fixture.worker.ProcessClaimed(context.Background(), fixture.job)

	if !errors.Is(err, ErrJobFenceLost) {
		t.Fatalf("ProcessClaimed() error = %v, want ErrJobFenceLost", err)
	}
	if len(fixture.derived.puts) != 0 || fixture.store.completed || fixture.store.failCalls != 0 || fixture.store.retryCalls != 0 {
		t.Fatalf("puts=%d completed=%v fail=%d retry=%d, want no mutation after fence loss",
			len(fixture.derived.puts), fixture.store.completed, fixture.store.failCalls, fixture.store.retryCalls)
	}
	fixture.assertTempDirEmpty(t)
}

func TestWorkerStopsFfmpegAndCleansTempFilesWhenFenceIsLostDuringDecode(t *testing.T) {
	fixture := newAudioPrepFixture(t, 30000, "30")
	started := make(chan struct{})
	fixture.encoder.block = started
	fenceStore := &activeFenceProbeStore{probeStore: fixture.store.probeStore}
	fixture.store.activeOverride = fenceStore

	result := make(chan error, 1)
	go func() { result <- fixture.worker.ProcessClaimed(context.Background(), fixture.job) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("audio decode did not start")
	}
	fenceStore.fenced.Store(true)
	select {
	case err := <-result:
		if !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("ProcessClaimed() error = %v, want ErrJobFenceLost", err)
		}
	case <-time.After(time.Second):
		t.Fatal("running ffmpeg was not cancelled after fence loss")
	}
	if fixture.store.completed || len(fixture.derived.puts) != 0 {
		t.Fatalf("completed=%v puts=%d, want neither after fence loss", fixture.store.completed, len(fixture.derived.puts))
	}
	fixture.assertTempDirEmpty(t)
}

func TestWorkerSkipsAudioPreparationWhenDisabled(t *testing.T) {
	job := Job{ID: "job", DocumentID: "document", SourceBucket: "media", SourceKey: "k", Attempt: 1, LeaseID: "lease",
		Locator: &Locator{Bucket: "media", Key: "k", VersionID: "v", ETag: "e", ContentLength: 4}}
	store := &audioPrepStore{probeStore: &probeStore{job: job}}
	worker := NewWorker(store, &probeObjectStore{data: []byte("data")}, probeRunner{metadata: validProbeMetadata()}, nil, Options{TempDir: t.TempDir(), MaxDownloadSize: 10})

	if err := worker.ProcessClaimed(context.Background(), job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if !store.completed || store.result.DecodedDurationMs != 0 || store.result.AudioChunkCount != 0 {
		t.Fatalf("result = %#v, want probe-only completion without decoded duration", store.result)
	}
}

func TestWorkerRefusesAudioPreparationForForeignBucket(t *testing.T) {
	fixture := newAudioPrepFixture(t, 30000, "30")
	fixture.worker.options.MediaBucket = "other-bucket"

	if err := fixture.worker.ProcessClaimed(context.Background(), fixture.job); err != nil {
		t.Fatalf("ProcessClaimed() error = %v", err)
	}

	if fixture.store.failedCode != FailureAudioPrep || len(fixture.derived.puts) != 0 {
		t.Fatalf("failed=%s puts=%d, want closed failure without upload", fixture.store.failedCode, len(fixture.derived.puts))
	}
}

func fakeAudioBytes(index int) []byte { return []byte(fmt.Sprintf("audio-chunk-%d", index)) }

// audioPrepStore records the completion result and how many chunk rows existed
// when Complete ran.
type audioPrepStore struct {
	*probeStore
	result           ProbeResult
	chunksAtComplete int
	activeOverride   Store
	chunks           *fakeChunkStore
}

func (store *audioPrepStore) CheckActive(ctx context.Context, job Job) (bool, error) {
	if store.activeOverride != nil {
		return store.activeOverride.CheckActive(ctx, job)
	}
	return store.probeStore.CheckActive(ctx, job)
}

func (store *audioPrepStore) Complete(ctx context.Context, job Job, result ProbeResult) (bool, error) {
	store.result = result
	if store.chunks != nil {
		store.chunksAtComplete = len(store.chunks.saved)
	}
	return store.probeStore.Complete(ctx, job, result)
}

type fakeEncoder struct {
	mu         sync.Mutex
	decodedMs  int64
	measureErr error
	extractErr error
	extracted  []ExtractRequest
	onExtract  func(ExtractRequest)
	block      chan struct{}
}

func (encoder *fakeEncoder) MeasureDecodedDuration(ctx context.Context, _ string) (int64, error) {
	if encoder.block != nil {
		close(encoder.block)
		<-ctx.Done()
		return 0, ctx.Err()
	}
	return encoder.decodedMs, encoder.measureErr
}

func (encoder *fakeEncoder) ExtractChunk(_ context.Context, request ExtractRequest) error {
	encoder.mu.Lock()
	index := len(encoder.extracted)
	encoder.extracted = append(encoder.extracted, request)
	encoder.mu.Unlock()
	if encoder.onExtract != nil {
		encoder.onExtract(request)
	}
	if encoder.extractErr != nil {
		return encoder.extractErr
	}
	return os.WriteFile(request.DestPath, fakeAudioBytes(index), 0o600)
}

type fakeDerivedStore struct {
	puts []PutObjectRequest
	err  error
}

func (store *fakeDerivedStore) PutDerivedObject(_ context.Context, request PutObjectRequest) (PutObjectResult, error) {
	if store.err != nil {
		return PutObjectResult{}, store.err
	}
	content, err := os.ReadFile(request.FilePath)
	if err != nil {
		return PutObjectResult{}, err
	}
	index := len(store.puts)
	store.puts = append(store.puts, request)
	return PutObjectResult{VersionID: fmt.Sprintf("v-%d", index), ETag: fmt.Sprintf("etag-%d", index), Size: int64(len(content))}, nil
}

type fakeChunkStore struct {
	saved   []AudioChunk
	loadErr error
}

func (store *fakeChunkStore) LoadAudioChunks(context.Context, Job) ([]AudioChunk, error) {
	return append([]AudioChunk(nil), store.saved...), store.loadErr
}

func (store *fakeChunkStore) SaveAudioChunk(_ context.Context, _ Job, chunk AudioChunk) (AudioChunk, error) {
	for _, existing := range store.saved {
		if existing.Index == chunk.Index {
			return existing, nil
		}
	}
	store.saved = append(store.saved, chunk)
	return chunk, nil
}

var _ AudioEncoder = (*fakeEncoder)(nil)
var _ DerivedObjectStore = (*fakeDerivedStore)(nil)
var _ AudioChunkStore = (*fakeChunkStore)(nil)
