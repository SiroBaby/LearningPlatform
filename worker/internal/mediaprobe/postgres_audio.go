package mediaprobe

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const audioChunkColumns = `"chunk_index", "bucket", "object_key", "version_id", "etag", "sha256", "content_length",
	"body_start_ms", "body_end_ms", "file_start_ms", "file_end_ms"`

// nullableDecodedDuration stores "not measured" as NULL so a probe that ran
// without audio preparation is distinguishable from a measured duration.
func nullableDecodedDuration(decodedDurationMs int) *int {
	if decodedDurationMs <= 0 {
		return nil
	}
	return &decodedDurationMs
}

// LoadAudioChunks returns the manifest rows already checkpointed for the job,
// so a retry or reclaim reuses uploaded chunks. The read is scoped to the job's
// identity; the fence is enforced by SaveAudioChunk and Complete, not here.
func (store *PostgresStore) LoadAudioChunks(ctx context.Context, job Job) ([]AudioChunk, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT `+audioChunkColumns+`
		  FROM "ai"."media_audio_chunks"
		 WHERE "media_probe_job_id" = $1 AND "document_id" = $2::uuid AND "owner_id" = $3::uuid
		   AND "probe_generation" = $4::uuid
		 ORDER BY "chunk_index"`,
		job.ID, job.DocumentID, job.OwnerID, job.ProbeGeneration)
	if err != nil {
		return nil, PersistenceError{Err: err}
	}
	defer rows.Close()
	chunks := make([]AudioChunk, 0)
	for rows.Next() {
		chunk, err := scanAudioChunk(rows)
		if err != nil {
			return nil, PersistenceError{Err: err}
		}
		chunks = append(chunks, chunk)
	}
	if err := rows.Err(); err != nil {
		return nil, PersistenceError{Err: err}
	}
	return chunks, nil
}

// SaveAudioChunk records one uploaded chunk. It takes the same advisory lock as
// first-locator persistence and Document deletion, then re-checks lease,
// attempt, and cancellation tombstones through lockActiveJob. Either the
// deletion transaction sees this row (and purges the version), or this call sees
// the tombstone and fails; an unrecorded version is left to the S3 lifecycle.
func (store *PostgresStore) SaveAudioChunk(ctx context.Context, job Job, chunk AudioChunk) (AudioChunk, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return AudioChunk{}, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`,
		"media-probe:"+job.DocumentID+":"+job.OwnerID); err != nil {
		return AudioChunk{}, PersistenceError{Err: err}
	}
	if err := lockActiveJob(ctx, tx, job); err != nil {
		return AudioChunk{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO "ai"."media_audio_chunks"
		  ("media_probe_job_id", "document_id", "owner_id", "probe_generation", "deletion_fence",
		   "chunk_index", "bucket", "object_key", "version_id", "etag", "sha256", "content_length",
		   "body_start_ms", "body_end_ms", "file_start_ms", "file_end_ms")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT ("media_probe_job_id", "chunk_index") DO NOTHING`,
		job.ID, job.DocumentID, job.OwnerID, job.ProbeGeneration, job.DeletionFence,
		chunk.Index, chunk.Bucket, chunk.Key, chunk.VersionID, chunk.ETag, chunk.SHA256, chunk.SizeBytes,
		chunk.BodyStartMs, chunk.BodyEndMs, chunk.FileStartMs, chunk.FileEndMs); err != nil {
		return AudioChunk{}, PersistenceError{Err: err}
	}
	stored, err := scanAudioChunk(tx.QueryRow(ctx, `
		SELECT `+audioChunkColumns+`
		  FROM "ai"."media_audio_chunks"
		 WHERE "media_probe_job_id" = $1 AND "chunk_index" = $2`, job.ID, chunk.Index))
	if err != nil {
		return AudioChunk{}, PersistenceError{Err: err}
	}
	if err := tx.Commit(ctx); err != nil {
		return AudioChunk{}, PersistenceError{Err: err}
	}
	return stored, nil
}

// ensureAudioChunkManifest makes Complete refuse a result whose manifest is not
// fully recorded, inside the same transaction that publishes the result.
func ensureAudioChunkManifest(ctx context.Context, tx pgx.Tx, job Job, result ProbeResult) error {
	var recorded int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)::integer FROM "ai"."media_audio_chunks"
		 WHERE "media_probe_job_id" = $1`, job.ID).Scan(&recorded); err != nil {
		return PersistenceError{Err: err}
	}
	if result.AudioChunkCount > 0 && recorded != result.AudioChunkCount {
		return Failure{Code: FailureAudioPrep}
	}
	return nil
}

func scanAudioChunk(row pgx.Row) (AudioChunk, error) {
	var chunk AudioChunk
	err := row.Scan(
		&chunk.Index, &chunk.Bucket, &chunk.Key, &chunk.VersionID, &chunk.ETag, &chunk.SHA256, &chunk.SizeBytes,
		&chunk.BodyStartMs, &chunk.BodyEndMs, &chunk.FileStartMs, &chunk.FileEndMs,
	)
	return chunk, err
}

var _ AudioChunkStore = (*PostgresStore)(nil)
