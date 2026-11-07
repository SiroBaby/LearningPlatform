package processing

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

const (
	millisecondsPerSecond = 1000
)

// sttTotals is the speech-to-text spend recorded for a job across every attempt, read when the terminal result is
// written. Seconds are rounded up so a partial second is never under-reported.
type sttTotals struct {
	billedSeconds    int64
	uncertainSeconds int64
}

// AudioManifest reads the derived-audio manifest that the media probe recorded for the job's probe result. The join
// repeats the identity and fence predicates of Source so a stale probe generation or a re-created Document can never
// supply chunks. No rows (or a probe that ran without audio preparation) is Failure{MediaAudioNotPrepared}.
func (store *PostgresStore) AudioManifest(ctx context.Context, job Job) (AudioManifest, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT result.id::text, COALESCE(result.decoded_duration_ms, 0),
		       chunk.chunk_index, chunk.bucket, chunk.object_key, chunk.version_id, chunk.etag, chunk.content_length,
		       chunk.body_start_ms, chunk.body_end_ms, chunk.file_start_ms, chunk.file_end_ms
		  FROM ai.processing_jobs AS pipeline
		  JOIN ai.media_probe_results AS result
		    ON result.id = pipeline.probe_result_id
		   AND result.document_id = pipeline.document_id
		   AND result.owner_id = pipeline.owner_id
		   AND result.full_pipeline_job_id = pipeline.id
		   AND result.probe_generation IS NOT DISTINCT FROM pipeline.probe_generation
		   AND result.policy_version IS NOT DISTINCT FROM pipeline.policy_version
		   AND result.deletion_fence = pipeline.deletion_fence
		  JOIN ai.media_audio_chunks AS chunk
		    ON chunk.media_probe_job_id = result.media_probe_job_id
		   AND chunk.document_id = result.document_id
		   AND chunk.owner_id = result.owner_id
		   AND chunk.probe_generation = result.probe_generation
		 WHERE pipeline.id = $1 AND pipeline.document_id = $2 AND pipeline.owner_id = $3
		   AND pipeline.job_type = 'FULL_PIPELINE'
		 ORDER BY chunk.chunk_index`, job.ID, job.DocumentID, job.OwnerID)
	if err != nil {
		return AudioManifest{}, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
	}
	defer rows.Close()
	manifest := AudioManifest{}
	for rows.Next() {
		var chunk AudioChunkRef
		if err := rows.Scan(&manifest.ProbeResultID, &manifest.DecodedDurationMs,
			&chunk.Index, &chunk.Locator.Bucket, &chunk.Locator.Key, &chunk.Locator.VersionID, &chunk.Locator.ETag, &chunk.Locator.ContentLength,
			&chunk.BodyStartMs, &chunk.BodyEndMs, &chunk.FileStartMs, &chunk.FileEndMs); err != nil {
			return AudioManifest{}, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
		}
		manifest.Chunks = append(manifest.Chunks, chunk)
	}
	if err := rows.Err(); err != nil {
		return AudioManifest{}, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
	}
	if len(manifest.Chunks) == 0 {
		return AudioManifest{}, Failure{Code: MediaAudioNotPrepared}
	}
	return manifest, nil
}

// STTCheckpoints returns the stored segments per chunk index for one provider identity. A chunk whose only row is
// an uncertain or invalid dispatch has no segments and is not returned, so it is transcribed again.
func (store *PostgresStore) STTCheckpoints(ctx context.Context, probeResultID, identity string) (map[int][]TranscriptSegment, error) {
	rows, err := store.pool.Query(ctx, `
		SELECT chunk_index, segments
		  FROM ai.media_stt_chunk_results
		 WHERE probe_result_id = $1::uuid AND stt_provider_identity = $2 AND segments IS NOT NULL`, probeResultID, identity)
	if err != nil {
		return nil, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
	}
	defer rows.Close()
	checkpoints := map[int][]TranscriptSegment{}
	for rows.Next() {
		var index int
		var raw []byte
		if err := rows.Scan(&index, &raw); err != nil {
			return nil, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
		}
		segments := []TranscriptSegment{}
		if err := json.Unmarshal(raw, &segments); err != nil {
			return nil, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
		}
		checkpoints[index] = segments
	}
	if err := rows.Err(); err != nil {
		return nil, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
	}
	return checkpoints, nil
}

// SaveSTTOutcome upserts one chunk outcome inside a small transaction that first locks the active job row (attempt,
// lease, status, cancellation, access revocation). A lost fence discards the result instead of committing it stale.
// Spend only accumulates: repeated outcomes for a chunk add to billed_ms/uncertain_ms and never erase segments.
func (store *PostgresStore) SaveSTTOutcome(ctx context.Context, job Job, outcome STTOutcome) error {
	var segments []byte
	if outcome.Segments != nil {
		encoded, err := json.Marshal(outcome.Segments)
		if err != nil {
			return err
		}
		segments = encoded
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return NewPersistenceError(FailureOperationChunkReplacement, err)
	}
	defer tx.Rollback(ctx)
	if _, err = lockActiveJob(ctx, tx, job); err != nil {
		if errors.Is(err, ErrJobFenceLost) {
			return ErrJobFenceLost
		}
		return NewPersistenceError(FailureOperationChunkReplacement, err)
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO ai.media_stt_chunk_results
		  (probe_result_id, document_id, owner_id, chunk_index, stt_provider_identity, segments, billed_ms, uncertain_ms)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, $8)
		ON CONFLICT (probe_result_id, chunk_index, stt_provider_identity) DO UPDATE SET
		  segments = COALESCE(EXCLUDED.segments, ai.media_stt_chunk_results.segments),
		  billed_ms = ai.media_stt_chunk_results.billed_ms + EXCLUDED.billed_ms,
		  uncertain_ms = ai.media_stt_chunk_results.uncertain_ms + EXCLUDED.uncertain_ms,
		  updated_at = now()`,
		outcome.ProbeResultID, job.DocumentID, job.OwnerID, outcome.ChunkIndex, outcome.Identity, segments, outcome.BilledMs, outcome.UncertainMs); err != nil {
		return NewPersistenceError(FailureOperationChunkReplacement, err)
	}
	if err = tx.Commit(ctx); err != nil {
		return NewPersistenceError(FailureOperationTransactionCommit, err)
	}
	return nil
}

// consumeSTTTotals sums and deletes the job's checkpoints inside the terminal transaction, so the transcript is not
// kept once the job has a final outcome and the spend of every attempt reaches the return seam exactly once. It
// returns nil when the job never dispatched speech-to-text (PDF/TEXT), leaving those payloads unchanged.
func consumeSTTTotals(ctx context.Context, tx pgx.Tx, job Job) (*sttTotals, error) {
	var billedMs, uncertainMs, rowCount int64
	err := tx.QueryRow(ctx, `
		WITH removed AS (
		  DELETE FROM ai.media_stt_chunk_results AS result
		   USING ai.processing_jobs AS pipeline
		   WHERE pipeline.id = $1 AND pipeline.probe_result_id = result.probe_result_id
		   RETURNING result.billed_ms, result.uncertain_ms
		)
		SELECT COALESCE(SUM(billed_ms), 0)::bigint, COALESCE(SUM(uncertain_ms), 0)::bigint, COUNT(*)::bigint FROM removed`, job.ID).Scan(&billedMs, &uncertainMs, &rowCount)
	if err != nil {
		return nil, err
	}
	if rowCount == 0 {
		return nil, nil
	}
	return &sttTotals{billedSeconds: ceilSeconds(billedMs), uncertainSeconds: ceilSeconds(uncertainMs)}, nil
}

func ceilSeconds(milliseconds int64) int64 {
	return (milliseconds + millisecondsPerSecond - 1) / millisecondsPerSecond
}
