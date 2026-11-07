package processing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

const sttTestIdentity = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type seededMedia struct {
	documentID, ownerID, probeResultID, pipelineID string
}

// seedMedia creates a PROCESSING video Document with a completed probe, a three-chunk derived-audio manifest and a
// FULL_PIPELINE job bound to that probe result, the same shape the probe hands to the full-pipeline worker.
func (database *postgresIntegration) seedMedia(t *testing.T, ctx context.Context, decodedDurationMs any) seededMedia {
	t.Helper()
	var media seededMedia
	var probeJobID, generation string
	if err := database.admin.QueryRow(ctx, `SELECT gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text`).
		Scan(&media.documentID, &media.ownerID, &media.pipelineID, &probeJobID, &generation, &media.probeResultID); err != nil {
		t.Fatalf("create IDs: %v", err)
	}
	storageRef := "media/" + media.ownerID + "/" + media.documentID + ".mp4"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.admin.Exec(ctx, query, args...); err != nil {
			t.Fatalf("seed media: %v\n%s", err, query)
		}
	}
	exec(`INSERT INTO course.documents(id, owner_id, type, original_name, storage_ref, size_bytes, status) VALUES($1, $2, 'VIDEO', 'lecture.mp4', $3, 1024, 'PROCESSING')`, media.documentID, media.ownerID, storageRef)
	exec(`INSERT INTO ai.media_probe_jobs (id, document_id, owner_id, correlation_id, probe_generation, policy_version, deletion_fence, full_pipeline_job_id, source_bucket, source_key, status, idempotency_key)
	      VALUES ($1, $2, $3, gen_random_uuid(), $4, 'policy-v1', 0, $5, 'media', $6, 'COMPLETED', gen_random_uuid()::text)`, probeJobID, media.documentID, media.ownerID, generation, media.pipelineID, storageRef)
	exec(`INSERT INTO ai.media_probe_results (id, media_probe_job_id, document_id, owner_id, probe_generation, policy_version, deletion_fence, duration_sec, bucket, object_key, version_id, etag, content_length, full_pipeline_job_id, decoded_duration_ms)
	      VALUES ($1, $2, $3, $4, $5, 'policy-v1', 0, 1500, 'media', $6, 'source-version', 'source-etag', 1024, $7, $8)`, media.probeResultID, probeJobID, media.documentID, media.ownerID, generation, storageRef, media.pipelineID, decodedDurationMs)
	exec(`INSERT INTO ai.processing_jobs(id, document_id, owner_id, job_type, idempotency_key, correlation_id, probe_generation, policy_version, deletion_fence, probe_result_id)
	      VALUES ($1, $2, $3, 'FULL_PIPELINE', $4, gen_random_uuid(), $5, 'policy-v1', 0, $6)`, media.pipelineID, media.documentID, media.ownerID, "key-"+media.pipelineID, generation, media.probeResultID)
	// Three chunks of 600 s body with 5 s overlap, cut by the probe; the middle one is out of insert order on purpose.
	for _, index := range []int{1, 0, 2} {
		bodyStart, bodyEnd := index*600_000, (index+1)*600_000
		fileStart, fileEnd := max(0, bodyStart-5_000), min(1_500_000, bodyEnd+5_000)
		if index == 2 {
			bodyEnd, fileEnd = 1_500_000, 1_500_000
		}
		exec(`INSERT INTO ai.media_audio_chunks (media_probe_job_id, document_id, owner_id, probe_generation, deletion_fence, chunk_index, bucket, object_key, version_id, etag, sha256, content_length, body_start_ms, body_end_ms, file_start_ms, file_end_ms)
		      VALUES ($1, $2, $3, $4, 0, $5, 'media', $6, $7, $8, repeat('a', 64), 2400000, $9, $10, $11, $12)`,
			probeJobID, media.documentID, media.ownerID, generation, index,
			"derived-audio/"+media.ownerID+"/"+media.documentID+"/"+generation+"/"+string(rune('0'+index))+".mp3", "chunk-version-"+string(rune('0'+index)), "chunk-etag-"+string(rune('0'+index)),
			bodyStart, bodyEnd, fileStart, fileEnd)
	}
	return media
}

func TestPostgresStoreMediaSTT(t *testing.T) {
	ctx := context.Background()
	database := startPostgresIntegration(t, ctx)
	t.Cleanup(func() {
		database.store.Close()
		database.admin.Close()
		if err := database.container.Terminate(ctx); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})
	claimMedia := func(t *testing.T, decodedDurationMs any) (seededMedia, Job) {
		t.Helper()
		media := database.seedMedia(t, ctx, decodedDurationMs)
		job := database.claim(t, ctx)
		if job.ID != media.pipelineID {
			t.Fatalf("claimed job %s, want the seeded media job %s", job.ID, media.pipelineID)
		}
		return media, *job
	}
	readUsage := func(t *testing.T, job Job) map[string]any {
		t.Helper()
		var encoded []byte
		if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProcessingResult' ORDER BY id DESC LIMIT 1`, job.ID).Scan(&encoded); err != nil {
			t.Fatalf("read result payload: %v", err)
		}
		var payload struct {
			Usage map[string]any `json:"usage"`
		}
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatalf("decode result payload: %v", err)
		}
		return payload.Usage
	}
	segments := []TranscriptSegment{{StartSec: 0, EndSec: 12.02, Text: "Xin chào các bạn"}}

	t.Run("reads the ordered derived-audio manifest bound to the job's probe result", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)

		manifest, err := database.store.AudioManifest(ctx, job)

		if err != nil {
			t.Fatalf("AudioManifest() error = %v", err)
		}
		if manifest.ProbeResultID != media.probeResultID || manifest.DecodedDurationMs != 1_500_000 || len(manifest.Chunks) != 3 {
			t.Fatalf("manifest = %#v", manifest)
		}
		for position, chunk := range manifest.Chunks {
			if chunk.Index != position || chunk.Locator.Bucket != "media" || chunk.Locator.ContentLength != 2_400_000 || chunk.Locator.VersionID != "chunk-version-"+string(rune('0'+position)) || chunk.Locator.ETag != "chunk-etag-"+string(rune('0'+position)) {
				t.Fatalf("chunk %d = %#v", position, chunk)
			}
		}
		if manifest.Chunks[1].FileStartMs != 595_000 || manifest.Chunks[1].FileEndMs != 1_205_000 || manifest.Chunks[2].BodyEndMs != 1_500_000 {
			t.Fatalf("spans = %#v", manifest.Chunks)
		}
		if _, err := manifestSpans(manifest); err != nil {
			t.Fatalf("manifestSpans() error = %v, want the stored manifest accepted", err)
		}
		if manifest.Chunks[0].SHA256 != strings.Repeat("a", 64) {
			t.Fatalf("sha256 = %q, want the recorded digest read back without padding", manifest.Chunks[0].SHA256)
		}
	})

	t.Run("treats a probe without audio preparation as not prepared", func(t *testing.T) {
		_, job := claimMedia(t, nil)

		manifest, err := database.store.AudioManifest(ctx, job)

		// The chunk rows exist but decoded_duration_ms is NULL: the validation rejects it before any paid call.
		if err != nil {
			assertFailure(t, err, MediaAudioNotPrepared, false)
			return
		}
		if _, spanErr := manifestSpans(manifest); spanErr == nil {
			t.Fatalf("manifest %#v with no decoded duration must not be usable", manifest)
		}
	})

	t.Run("a job without a manifest is not prepared", func(t *testing.T) {
		database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)

		_, err := database.store.AudioManifest(ctx, *job)

		assertFailure(t, err, MediaAudioNotPrepared, false)
	})

	t.Run("checkpoints survive a retry, accumulate spend, and ignore other provider identities", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		save := func(outcome STTOutcome) {
			t.Helper()
			outcome.ProbeResultID = media.probeResultID
			if outcome.Identity == "" {
				outcome.Identity = sttTestIdentity
			}
			if err := database.store.SaveSTTOutcome(ctx, job, outcome); err != nil {
				t.Fatalf("SaveSTTOutcome() error = %v", err)
			}
		}
		save(STTOutcome{ChunkIndex: 0, Segments: segments, BilledMs: 605_000})
		save(STTOutcome{ChunkIndex: 1, UncertainMs: 610_000})
		save(STTOutcome{ChunkIndex: 2, Segments: []TranscriptSegment{}, BilledMs: 305_000})
		save(STTOutcome{ChunkIndex: 1, Segments: segments, BilledMs: 610_000})
		save(STTOutcome{ChunkIndex: 0, Identity: "f" + sttTestIdentity[1:], Segments: segments, BilledMs: 605_000})

		checkpoints, err := database.store.STTCheckpoints(ctx, media.probeResultID, sttTestIdentity)

		if err != nil {
			t.Fatalf("STTCheckpoints() error = %v", err)
		}
		want := map[int][]TranscriptSegment{0: segments, 1: segments, 2: {}}
		if !reflect.DeepEqual(checkpoints, want) {
			t.Fatalf("checkpoints = %#v, want %#v (a silent chunk stays a checkpoint)", checkpoints, want)
		}
		var uncertainOnlyRows int
		if err := database.admin.QueryRow(ctx, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1 AND stt_provider_identity=$2 AND segments IS NULL`, media.probeResultID, sttTestIdentity).Scan(&uncertainOnlyRows); err != nil || uncertainOnlyRows != 0 {
			t.Fatalf("rows without segments = %d (err %v), want the later success to fill chunk 1", uncertainOnlyRows, err)
		}

		// An uncertain-only chunk is not a checkpoint, so it is transcribed again.
		other := "e" + sttTestIdentity[1:]
		save(STTOutcome{ChunkIndex: 2, Identity: other, UncertainMs: 1_000})
		otherCheckpoints, err := database.store.STTCheckpoints(ctx, media.probeResultID, other)
		if err != nil || len(otherCheckpoints) != 0 {
			t.Fatalf("checkpoints for an uncertain-only identity = (%#v, %v), want none", otherCheckpoints, err)
		}
	})

	t.Run("a lost fence discards the result instead of committing it", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("expire lease: %v", err)
		}

		err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 1000})

		if !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("SaveSTTOutcome() error = %v, want ErrJobFenceLost", err)
		}
		if count := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1`, media.probeResultID); count != 0 {
			t.Fatalf("rows after a fenced save = %d, want 0", count)
		}
		// Keep the expired lease from being reclaimed by the next subtest.
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET status='FAILED' WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("park job: %v", err)
		}
	})

	t.Run("a cancelled Document fences the save", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET cancellation_marker_id=gen_random_uuid(), cancellation_reason='DOCUMENT_DELETED', cancelled_at=now() WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("cancel job: %v", err)
		}

		err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 1000})

		if !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("SaveSTTOutcome() error = %v, want ErrJobFenceLost", err)
		}
	})

	t.Run("completion writes time locators and reports STT spend of every attempt once", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		for _, outcome := range []STTOutcome{
			{ChunkIndex: 0, Segments: segments, BilledMs: 605_000},
			{ChunkIndex: 1, UncertainMs: 610_000},
			{ChunkIndex: 1, Segments: segments, BilledMs: 610_000},
			{ChunkIndex: 2, Segments: []TranscriptSegment{}, BilledMs: 300_500},
		} {
			outcome.ProbeResultID, outcome.Identity = media.probeResultID, sttTestIdentity
			if err := database.store.SaveSTTOutcome(ctx, job, outcome); err != nil {
				t.Fatalf("SaveSTTOutcome() error = %v", err)
			}
		}
		chunks := []Chunk{
			{ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", Index: 0, Text: "Xin chào", ContentHash: "h0", Locator: Locator{Kind: LocatorKindTime, StartSec: 0, EndSec: 12.02}},
			{ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", Index: 1, Text: "Quang hợp", ContentHash: "h1", Locator: Locator{Kind: LocatorKindTime, StartSec: 600.5, EndSec: 1499.999}},
			{ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", Index: 2, Text: "trang 3", ContentHash: "h2", Locator: Locator{Kind: "page", Page: 3}},
		}

		persisted, err := database.store.PersistAndComplete(WithUsageTracker(ctx, NewUsageTracker()), job, chunks, nil)

		if err != nil || !persisted {
			t.Fatalf("PersistAndComplete() = (%t, %v)", persisted, err)
		}
		rows, err := database.admin.Query(ctx, `SELECT chunk_index, start_sec::float8, end_sec::float8, page_number, locator FROM ai.chunks WHERE document_id=$1 ORDER BY chunk_index`, media.documentID)
		if err != nil {
			t.Fatalf("read chunks: %v", err)
		}
		defer rows.Close()
		type stored struct {
			index         int
			start, end    *float64
			page          *int
			locatorKind   string
			locatorStart  *float64
			locatorFields map[string]any
		}
		var got []stored
		for rows.Next() {
			var row stored
			var locator []byte
			if err := rows.Scan(&row.index, &row.start, &row.end, &row.page, &locator); err != nil {
				t.Fatalf("scan chunk: %v", err)
			}
			if err := json.Unmarshal(locator, &row.locatorFields); err != nil {
				t.Fatalf("decode locator: %v", err)
			}
			got = append(got, row)
		}
		if len(got) != 3 {
			t.Fatalf("chunks = %d, want 3", len(got))
		}
		if got[0].start == nil || *got[0].start != 0 || got[0].end == nil || *got[0].end != 12.02 || got[0].page != nil || got[0].locatorFields["kind"] != "time" || got[0].locatorFields["startSec"] != float64(0) {
			t.Fatalf("time chunk 0 = %#v: start_sec 0 must be stored, not NULL", got[0])
		}
		if got[1].start == nil || *got[1].start != 600.5 || got[1].end == nil || *got[1].end != 1499.999 {
			t.Fatalf("time chunk 1 = %#v", got[1])
		}
		if got[2].start != nil || got[2].end != nil || got[2].page == nil || *got[2].page != 3 {
			t.Fatalf("page chunk = %#v: page rows keep NULL seconds", got[2])
		}

		usage := readUsage(t, job)
		// Billed 605 + 610 + 300.5 = 1515.5 s -> 1516; chunk 1's earlier uncertain dispatch was resolved by its later success.
		if usage["sttBilledSeconds"] != float64(1516) || usage["sttUncertainSeconds"] != float64(0) {
			t.Fatalf("usage = %#v, want sttBilledSeconds 1516 and sttUncertainSeconds 0", usage)
		}
		if count := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1`, media.probeResultID); count != 0 {
			t.Fatalf("checkpoints after completion = %d, want them removed with the terminal write", count)
		}
	})

	t.Run("a failed job reports spend and drops the transcript; a PDF job omits STT fields", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, UncertainMs: 1_200}); err != nil {
			t.Fatalf("SaveSTTOutcome() error = %v", err)
		}

		finalized, err := database.store.Fail(WithUsageTracker(ctx, NewUsageTracker()), job, Failure{Code: MediaTranscriptEmpty})

		if err != nil || !finalized {
			t.Fatalf("Fail() = (%t, %v)", finalized, err)
		}
		usage := readUsage(t, job)
		if usage["sttBilledSeconds"] != float64(0) || usage["sttUncertainSeconds"] != float64(2) {
			t.Fatalf("usage = %#v, want 0 billed and 2 uncertain seconds (1.2 s rounded up)", usage)
		}
		if count := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1`, media.probeResultID); count != 0 {
			t.Fatalf("checkpoints after failure = %d, want 0", count)
		}

		database.insertDocumentAndJob(t, ctx)
		pdfJob := database.claim(t, ctx)
		if _, err := database.store.Fail(WithUsageTracker(ctx, NewUsageTracker()), *pdfJob, Failure{Code: PDFInvalid}); err != nil {
			t.Fatalf("Fail() error = %v", err)
		}
		pdfUsage := readUsage(t, *pdfJob)
		if _, present := pdfUsage["sttBilledSeconds"]; present {
			t.Fatalf("PDF usage = %#v, want no STT fields", pdfUsage)
		}
	})

	t.Run("a DLQ finalization reports STT spend", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 10_000}); err != nil {
			t.Fatalf("SaveSTTOutcome() error = %v", err)
		}
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET technical_retry_count=3 WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("exhaust retries: %v", err)
		}

		result, err := database.store.Retry(WithUsageTracker(ctx, NewUsageTracker()), job, ProviderUnavailable)

		if err != nil || !result.Finalized {
			t.Fatalf("Retry() = (%#v, %v), want finalized", result, err)
		}
		usage := readUsage(t, job)
		if usage["sttBilledSeconds"] != float64(10) || usage["sttUncertainSeconds"] != float64(0) {
			t.Fatalf("usage = %#v", usage)
		}
	})

	t.Run("a scheduled retry keeps the checkpoints for the next attempt", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 10_000}); err != nil {
			t.Fatalf("SaveSTTOutcome() error = %v", err)
		}

		result, err := database.store.Retry(ctx, job, ProviderUnavailable)

		if err != nil || !result.Scheduled {
			t.Fatalf("Retry() = (%#v, %v), want scheduled", result, err)
		}
		if count := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1`, media.probeResultID); count != 1 {
			t.Fatalf("checkpoints after a scheduled retry = %d, want 1 kept", count)
		}
	})

	t.Run("unsaved spend carried on the tracker is written by the terminal transaction", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		tracker := NewUsageTracker()
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 600_000})
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 1, Identity: sttTestIdentity, UncertainMs: 600_000})

		finalized, err := database.store.Fail(WithUsageTracker(ctx, tracker), job, Failure{Code: MediaTranscriptEmpty})

		if err != nil || !finalized {
			t.Fatalf("Fail() = (%t, %v)", finalized, err)
		}
		usage := readUsage(t, job)
		if usage["sttBilledSeconds"] != float64(600) || usage["sttUncertainSeconds"] != float64(600) {
			t.Fatalf("usage = %#v, want the carried 600 s billed and 600 s uncertain", usage)
		}
		if len(tracker.UnsavedSTT()) != 0 {
			t.Fatal("the tracker must be cleared after the terminal commit")
		}
	})

	t.Run("a scheduled retry persists carried spend and the next attempt reports it once", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		tracker := NewUsageTracker()
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 600_000})

		result, err := database.store.Retry(WithUsageTracker(ctx, tracker), job, ProviderUnavailable)

		if err != nil || !result.Scheduled {
			t.Fatalf("Retry() = (%#v, %v), want scheduled", result, err)
		}
		if len(tracker.UnsavedSTT()) != 0 {
			t.Fatal("the tracker must be cleared after the retry commit")
		}
		checkpoints, err := database.store.STTCheckpoints(ctx, media.probeResultID, sttTestIdentity)
		if err != nil || !reflect.DeepEqual(checkpoints, map[int][]TranscriptSegment{0: segments}) {
			t.Fatalf("checkpoints = (%#v, %v), want the carried chunk resumable", checkpoints, err)
		}
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET next_visible_at=now() WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("make retry visible: %v", err)
		}
		next := database.claim(t, ctx)
		if _, err := database.store.Fail(WithUsageTracker(ctx, NewUsageTracker()), *next, Failure{Code: MediaTranscriptEmpty}); err != nil {
			t.Fatalf("Fail() error = %v", err)
		}
		usage := readUsage(t, *next)
		if usage["sttBilledSeconds"] != float64(600) {
			t.Fatalf("usage = %#v, want 600 s billed exactly once", usage)
		}
	})

	t.Run("an uncertain dispatch resolved by a later success bills the chunk once; one that never succeeds stays uncertain", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		save := func(outcome STTOutcome) {
			t.Helper()
			outcome.ProbeResultID, outcome.Identity = media.probeResultID, sttTestIdentity
			if err := database.store.SaveSTTOutcome(ctx, job, outcome); err != nil {
				t.Fatalf("SaveSTTOutcome() error = %v", err)
			}
		}
		save(STTOutcome{ChunkIndex: 0, UncertainMs: 600_000})
		save(STTOutcome{ChunkIndex: 0, Segments: segments, BilledMs: 600_000})
		save(STTOutcome{ChunkIndex: 1, UncertainMs: 600_000})
		save(STTOutcome{ChunkIndex: 1, UncertainMs: 600_000})
		// A repeated or reordered billed answer never double bills, and a late uncertain row never re-opens a billed chunk.
		save(STTOutcome{ChunkIndex: 2, Segments: segments, BilledMs: 600_000})
		save(STTOutcome{ChunkIndex: 2, Segments: segments, BilledMs: 600_000})
		save(STTOutcome{ChunkIndex: 2, UncertainMs: 600_000})
		var billed0, uncertain0, billed1, uncertain1, billed2, uncertain2 int
		row := func(index int, billed, uncertain *int) {
			if err := database.admin.QueryRow(ctx, `SELECT billed_ms, uncertain_ms FROM ai.media_stt_chunk_results WHERE probe_result_id=$1 AND chunk_index=$2`, media.probeResultID, index).Scan(billed, uncertain); err != nil {
				t.Fatalf("read chunk %d: %v", index, err)
			}
		}
		row(0, &billed0, &uncertain0)
		row(1, &billed1, &uncertain1)
		row(2, &billed2, &uncertain2)
		if billed0 != 600_000 || uncertain0 != 0 || billed1 != 0 || uncertain1 != 1_200_000 || billed2 != 600_000 || uncertain2 != 0 {
			t.Fatalf("rows = (%d,%d) (%d,%d) (%d,%d), want chunk 0 billed once, chunk 1 uncertain only, chunk 2 billed once", billed0, uncertain0, billed1, uncertain1, billed2, uncertain2)
		}

		finalized, err := database.store.Fail(WithUsageTracker(ctx, NewUsageTracker()), job, Failure{Code: ProviderUnavailable})

		if err != nil || !finalized {
			t.Fatalf("Fail() = (%t, %v)", finalized, err)
		}
		usage := readUsage(t, job)
		if usage["sttBilledSeconds"] != float64(1200) || usage["sttUncertainSeconds"] != float64(1200) {
			t.Fatalf("usage = %#v, want 1200 s billed (chunks 0 and 2) and 1200 s uncertain (chunk 1 only)", usage)
		}
	})

	t.Run("carried outcomes keep the same resolution when flushed in either order", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		tracker := NewUsageTracker()
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 600_000})
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, UncertainMs: 600_000})
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 1, Identity: sttTestIdentity, UncertainMs: 600_000})
		tracker.AddUnsavedSTT(STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 1, Identity: sttTestIdentity, Segments: segments, BilledMs: 600_000})

		if _, err := database.store.Fail(WithUsageTracker(ctx, tracker), job, Failure{Code: MediaTranscriptEmpty}); err != nil {
			t.Fatalf("Fail() error = %v", err)
		}

		usage := readUsage(t, job)
		if usage["sttBilledSeconds"] != float64(1200) || usage["sttUncertainSeconds"] != float64(0) {
			t.Fatalf("usage = %#v, want 1200 s billed and no uncertain seconds", usage)
		}
	})

	t.Run("hard-deleting the probe result removes the transcript", func(t *testing.T) {
		media, job := claimMedia(t, 1_500_000)
		if err := database.store.SaveSTTOutcome(ctx, job, STTOutcome{ProbeResultID: media.probeResultID, ChunkIndex: 0, Identity: sttTestIdentity, Segments: segments, BilledMs: 10_000}); err != nil {
			t.Fatalf("SaveSTTOutcome() error = %v", err)
		}
		if _, err := database.admin.Exec(ctx, `DELETE FROM ai.processing_jobs WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("delete job: %v", err)
		}
		if _, err := database.admin.Exec(ctx, `DELETE FROM ai.media_probe_results WHERE id=$1`, media.probeResultID); err != nil {
			t.Fatalf("delete probe result: %v", err)
		}

		if count := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.media_stt_chunk_results WHERE probe_result_id=$1`, media.probeResultID); count != 0 {
			t.Fatalf("checkpoints after the cascade = %d, want 0", count)
		}
	})
}
