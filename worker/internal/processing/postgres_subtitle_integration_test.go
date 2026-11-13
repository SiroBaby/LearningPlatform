package processing

import (
	"context"
	"testing"
)

const youtubeTestVideoID = "dQw4w9WgXcQ"

type subtitleSeed struct {
	documentStatus  string
	documentType    string
	videoID         any
	cues            string
	rightsConfirmed bool
	// snapshotOwnerMismatch stores the snapshot under another owner id.
	snapshotOwnerMismatch bool
	skipSnapshot          bool
}

func defaultSubtitleSeed() subtitleSeed {
	return subtitleSeed{
		documentStatus:  "PROCESSING",
		documentType:    "YOUTUBE",
		videoID:         youtubeTestVideoID,
		cues:            `[{"startMs":0,"endMs":4000,"text":"Xin chào"},{"startMs":2000,"endMs":6000,"text":"các bạn"}]`,
		rightsConfirmed: true,
	}
}

// seedSubtitle inserts a Document, its optional snapshot and a FULL_PIPELINE job, then claims the job.
func (database *postgresIntegration) seedSubtitle(t *testing.T, ctx context.Context, seed subtitleSeed) Job {
	t.Helper()
	var documentID, ownerID, otherOwnerID string
	if err := database.admin.QueryRow(ctx, `SELECT gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&documentID, &ownerID, &otherOwnerID); err != nil {
		t.Fatalf("create IDs: %v", err)
	}
	if _, err := database.admin.Exec(ctx, `INSERT INTO course.documents(id, owner_id, type, original_name, storage_ref, size_bytes, status, youtube_video_id)
		VALUES($1, $2, $3, 'bai-giang.vtt', 'owners/bai-giang.vtt', 64, $4, $5)`, documentID, ownerID, seed.documentType, seed.documentStatus, seed.videoID); err != nil {
		t.Fatalf("insert document: %v", err)
	}
	if !seed.skipSnapshot {
		snapshotOwner := ownerID
		if seed.snapshotOwnerMismatch {
			snapshotOwner = otherOwnerID
		}
		var rightsAt any
		if seed.rightsConfirmed {
			rightsAt = "2026-11-14T00:00:00Z"
		}
		if _, err := database.admin.Exec(ctx, `INSERT INTO course.document_subtitle_transcripts
			(document_id, owner_id, source_format, source_sha256, source_size_bytes, parser_version, cues, cue_count, char_count, duration_ms, rights_confirmed_at)
			VALUES ($1, $2, 'VTT', repeat('a', 64), 64, 'test', $3::jsonb, jsonb_array_length($3::jsonb), 12, 6000, $4::timestamptz)`,
			documentID, snapshotOwner, seed.cues, rightsAt); err != nil {
			t.Fatalf("insert snapshot: %v", err)
		}
	}
	if _, err := database.admin.Exec(ctx, `INSERT INTO ai.processing_jobs(document_id, owner_id, job_type, idempotency_key, correlation_id)
		VALUES($1, $2, 'FULL_PIPELINE', $3, gen_random_uuid())`, documentID, ownerID, "key-"+documentID); err != nil {
		t.Fatalf("insert processing job: %v", err)
	}
	return *database.claim(t, ctx)
}

func TestPostgresStoreSubtitleSegments(t *testing.T) {
	ctx := context.Background()
	database := startPostgresIntegration(t, ctx)
	t.Cleanup(func() {
		database.store.Close()
		database.admin.Close()
		if err := database.container.Terminate(ctx); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})

	t.Run("returns the confirmed cues as time segments in start order", func(t *testing.T) {
		job := database.seedSubtitle(t, ctx, defaultSubtitleSeed())

		segments, err := database.store.SubtitleSegments(ctx, job)

		if err != nil {
			t.Fatalf("SubtitleSegments() error = %v", err)
		}
		if len(segments) != 2 || segments[0] != (TranscriptSegment{StartSec: 0, EndSec: 4, Text: "Xin chào"}) || segments[1] != (TranscriptSegment{StartSec: 2, EndSec: 6, Text: "các bạn"}) {
			t.Fatalf("segments = %#v", segments)
		}
	})

	t.Run("reports ObjectNotFound while the Owner has not confirmed the rights", func(t *testing.T) {
		seed := defaultSubtitleSeed()
		seed.rightsConfirmed = false
		job := database.seedSubtitle(t, ctx, seed)

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ObjectNotFound, false)
	})

	t.Run("reports ObjectNotFound without a snapshot", func(t *testing.T) {
		seed := defaultSubtitleSeed()
		seed.skipSnapshot = true
		job := database.seedSubtitle(t, ctx, seed)

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ObjectNotFound, false)
	})

	t.Run("does not serve a snapshot stored under another Owner", func(t *testing.T) {
		seed := defaultSubtitleSeed()
		seed.snapshotOwnerMismatch = true
		job := database.seedSubtitle(t, ctx, seed)

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ObjectNotFound, false)
	})

	t.Run("does not serve a snapshot once the Document left PROCESSING", func(t *testing.T) {
		job := database.seedSubtitle(t, ctx, defaultSubtitleSeed())
		if _, err := database.admin.Exec(ctx, `UPDATE course.documents SET status = 'DELETING' WHERE id = $1`, job.DocumentID); err != nil {
			t.Fatalf("mark Document DELETING: %v", err)
		}

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ObjectNotFound, false)
	})

	t.Run("does not serve a snapshot for a Document that is not YOUTUBE", func(t *testing.T) {
		seed := defaultSubtitleSeed()
		seed.documentType = "TEXT"
		seed.videoID = nil
		job := database.seedSubtitle(t, ctx, seed)

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ObjectNotFound, false)
	})

	t.Run("fails terminally when the stored snapshot breaks an invariant", func(t *testing.T) {
		seed := defaultSubtitleSeed()
		seed.cues = `[{"startMs":5000,"endMs":6000,"text":"sau"},{"startMs":1000,"endMs":2000,"text":"truoc"}]`
		job := database.seedSubtitle(t, ctx, seed)

		_, err := database.store.SubtitleSegments(ctx, job)

		assertFailure(t, err, ProcessingFailed, false)
	})
}
