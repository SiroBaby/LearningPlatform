package mediaprobe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxTechnicalRetries = 3

var retryDelays = [...]string{"5 seconds", "30 seconds", "5 minutes"}

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, poolConfig *pgxpool.Config) (*PostgresStore, error) {
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("connect media probe database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping media probe database: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (store *PostgresStore) Close() { store.pool.Close() }

func (store *PostgresStore) CheckActive(ctx context.Context, job Job) (bool, error) {
	var active bool
	err := store.pool.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1
		      FROM "ai"."media_probe_jobs" AS job
		     WHERE job."id" = $1
	         AND job."attempts" = $2
	         AND job."lease_id" = $3::uuid
	         AND job."status" = 'RUNNING'
	         AND job."lease_until" > now()
	         AND NOT EXISTS (
	             SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
	              WHERE tombstone."document_id" = job."document_id"
	                AND tombstone."owner_id" = job."owner_id"
	                AND tombstone."deletion_fence" >= job."deletion_fence"
	         )
		)`, job.ID, job.Attempt, job.LeaseID).Scan(&active)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	if !active {
		return false, ErrJobFenceLost
	}
	return true, nil
}

func (store *PostgresStore) Claim(ctx context.Context) (*Job, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `
		SELECT "id"
		  FROM "ai"."media_probe_jobs" AS job
		 WHERE (("status" = 'PENDING' AND "next_visible_at" <= now())
		     OR ("status" = 'RUNNING' AND "lease_until" <= now()))
		   AND NOT EXISTS (
		       SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
		        WHERE tombstone."document_id" = job."document_id"
		          AND tombstone."owner_id" = job."owner_id"
		          AND tombstone."deletion_fence" >= job."deletion_fence"
		   )
		 ORDER BY "created_at" ASC
		 LIMIT 1
		 FOR UPDATE SKIP LOCKED`,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, PersistenceError{Err: err}
	}
	job, err := scanJob(tx.QueryRow(ctx, `
		UPDATE "ai"."media_probe_jobs" AS job
		   SET "attempts" = "attempts" + 1,
		       "lease_id" = gen_random_uuid(),
		       "lease_until" = now() + interval '15 minutes',
		       "status" = 'RUNNING',
		       "updated_at" = now()
		 WHERE "id" = $1
		   AND NOT EXISTS (
		       SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
		        WHERE tombstone."document_id" = job."document_id"
		          AND tombstone."owner_id" = job."owner_id"
		          AND tombstone."deletion_fence" >= job."deletion_fence"
		   )
		 RETURNING "id", "document_id", "owner_id", "correlation_id",
		           "probe_generation", "policy_version", "source_bucket", "source_key",
		           "full_pipeline_job_id", "deletion_fence", "attempts", "lease_id"::text,
		           "created_at", "source_version_id", "source_etag", "source_content_length"`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, PersistenceError{Err: err}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, PersistenceError{Err: err}
	}
	return job, nil
}

func (store *PostgresStore) PersistLocator(ctx context.Context, job Job, locator Locator) (bool, error) {
	if locator.Bucket != job.SourceBucket || locator.Key != job.SourceKey || locator.VersionID == "" || locator.ETag == "" || locator.ContentLength < 0 {
		return false, Failure{Code: FailureMediaProbe}
	}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	// Serialize first-locator persistence with enqueue and document deletion.
	// The context-aware lock query exits if deletion keeps the lock too long.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`,
		"media-probe:"+job.DocumentID+":"+job.OwnerID); err != nil {
		return false, PersistenceError{Err: err}
	}
	result, err := tx.Exec(ctx, `
		UPDATE "ai"."media_probe_jobs" AS job
		   SET "source_version_id" = $4,
		       "source_etag" = $5,
		       "source_content_length" = $6,
		       "updated_at" = now()
		 WHERE "id" = $1
		   AND "attempts" = $2
		   AND "lease_id" = $3::uuid
		   AND "document_id" = $7::uuid
		   AND "owner_id" = $8::uuid
		   AND "probe_generation" = $9::uuid
		   AND "policy_version" = $10
		   AND "deletion_fence" = $11
		   AND "status" = 'RUNNING'
		   AND "lease_until" > now()
		   AND "source_version_id" IS NULL
		   AND "source_etag" IS NULL
		   AND "source_content_length" IS NULL
		   AND NOT EXISTS (
		       SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
		        WHERE tombstone."document_id" = job."document_id"
		          AND tombstone."owner_id" = job."owner_id"
		          AND tombstone."deletion_fence" >= job."deletion_fence"
		   )`,
		job.ID, job.Attempt, job.LeaseID, locator.VersionID, locator.ETag, locator.ContentLength,
		job.DocumentID, job.OwnerID, job.ProbeGeneration, job.PolicyVersion, job.DeletionFence)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	if result.RowsAffected() == 0 {
		return false, ErrJobFenceLost
	}
	if err := tx.Commit(ctx); err != nil {
		return true, PersistenceError{Err: err}
	}
	return true, nil
}

func (store *PostgresStore) Complete(ctx context.Context, job Job, result ProbeResult) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	if err := lockActiveJob(ctx, tx, job); err != nil {
		return false, err
	}
	var resultID string
	err = tx.QueryRow(ctx, `
		SELECT "id" FROM "ai"."media_probe_results"
		 WHERE "media_probe_job_id" = $1`, job.ID).Scan(&resultID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO "ai"."media_probe_results"
			  ("media_probe_job_id", "document_id", "owner_id", "probe_generation",
			   "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
			   "version_id", "etag", "content_length", "full_pipeline_job_id")
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			 RETURNING "id"`,
			job.ID, job.DocumentID, job.OwnerID, job.ProbeGeneration, job.PolicyVersion,
			job.DeletionFence, result.DurationSec, result.Locator.Bucket, result.Locator.Key,
			result.Locator.VersionID, result.Locator.ETag, result.Locator.ContentLength, job.FullPipelineJobID).Scan(&resultID)
	}
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	if err := ensureResultMatches(ctx, tx, resultID, job, result); err != nil {
		return false, err
	}
	updated, err := tx.Exec(ctx, `
		UPDATE "ai"."media_probe_jobs"
		   SET "status" = 'COMPLETED', "failure_code" = NULL, "error_message" = NULL,
		       "lease_id" = NULL, "lease_until" = NULL, "completed_at" = now(),
		       "probe_result_id" = $4, "updated_at" = now()
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid AND "status" = 'RUNNING'`,
		job.ID, job.Attempt, job.LeaseID, resultID)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	if updated.RowsAffected() != 1 {
		return false, ErrJobFenceLost
	}
	payload, err := json.Marshal(map[string]any{
		"version": 1, "documentId": job.DocumentID, "ownerId": job.OwnerID,
		"attempt": job.Attempt, "leaseId": job.LeaseID, "status": "READY",
		"jobType": "MEDIA_PROBE", "probeGeneration": job.ProbeGeneration,
		"policyVersion": job.PolicyVersion, "deletionFence": job.DeletionFence,
		"durationSec": result.DurationSec, "fullPipelineJobId": job.FullPipelineJobID,
		"probeResultId": resultID, "locator": map[string]any{
			"bucket": result.Locator.Bucket, "key": result.Locator.Key,
			"versionId": result.Locator.VersionID, "etag": result.Locator.ETag,
			"contentLength": result.Locator.ContentLength, "policyVersion": job.PolicyVersion,
			"deletionFence": job.DeletionFence,
		},
	})
	if err != nil {
		return false, err
	}
	if err := insertOutboxOnce(ctx, tx, job.ID, "DocumentProbeCompleted", payload); err != nil {
		return false, PersistenceError{Err: err}
	}
	if err := tx.Commit(ctx); err != nil {
		return true, PersistenceError{Err: err}
	}
	return true, nil
}

func (store *PostgresStore) Fail(ctx context.Context, job Job, failure Failure) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	if err := lockActiveJob(ctx, tx, job); err != nil {
		return false, err
	}
	var versionID, etag *string
	var contentLength *int64
	if err := tx.QueryRow(ctx, `
		SELECT "source_version_id", "source_etag", "source_content_length"
		  FROM "ai"."media_probe_jobs"
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid AND "status" = 'RUNNING'`,
		job.ID, job.Attempt, job.LeaseID).Scan(&versionID, &etag, &contentLength); err != nil {
		return false, PersistenceError{Err: err}
	}
	job.Locator = nil
	if versionID != nil && etag != nil && contentLength != nil {
		job.Locator = &Locator{
			Bucket: job.SourceBucket, Key: job.SourceKey,
			VersionID: *versionID, ETag: *etag, ContentLength: *contentLength,
		}
	}
	updated, err := tx.Exec(ctx, `
		UPDATE "ai"."media_probe_jobs"
		   SET "status" = 'FAILED', "failure_code" = $4, "error_message" = NULL,
		       "lease_id" = NULL, "lease_until" = NULL, "completed_at" = now(), "updated_at" = now()
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid AND "status" = 'RUNNING'`,
		job.ID, job.Attempt, job.LeaseID, string(failure.Code))
	if err != nil {
		return false, PersistenceError{Err: err}
	}
	if updated.RowsAffected() != 1 {
		return false, ErrJobFenceLost
	}
	payload, err := json.Marshal(probeFailurePayload(job, failure))
	if err != nil {
		return false, err
	}
	if err := insertOutboxOnce(ctx, tx, job.ID, "DocumentProbeFailed", payload); err != nil {
		return false, PersistenceError{Err: err}
	}
	if err := tx.Commit(ctx); err != nil {
		return true, PersistenceError{Err: err}
	}
	return true, nil
}

func probeFailurePayload(job Job, failure Failure) map[string]any {
	payload := map[string]any{
		"version": 1, "documentId": job.DocumentID, "ownerId": job.OwnerID,
		"attempt": job.Attempt, "leaseId": job.LeaseID, "status": "FAILED",
		"jobType": "MEDIA_PROBE", "probeGeneration": job.ProbeGeneration,
		"policyVersion": job.PolicyVersion, "deletionFence": job.DeletionFence,
		"errorCode": string(failure.Code), "errorMessage": nil,
	}
	if locator := job.Locator; locator != nil &&
		locator.Bucket == job.SourceBucket && locator.Key == job.SourceKey &&
		locator.VersionID != "" && locator.ETag != "" && locator.ContentLength >= 0 {
		payload["locator"] = map[string]any{
			"bucket": locator.Bucket, "key": locator.Key,
			"versionId": locator.VersionID, "etag": locator.ETag,
			"contentLength": locator.ContentLength,
			"policyVersion": job.PolicyVersion, "deletionFence": job.DeletionFence,
		}
	}
	return payload
}

func (store *PostgresStore) Retry(ctx context.Context, job Job, code FailureCode) (RetryResult, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return RetryResult{}, PersistenceError{Err: err}
	}
	defer tx.Rollback(ctx)
	var retryCount int
	err = tx.QueryRow(ctx, `
		SELECT "technical_retry_count"
		  FROM "ai"."media_probe_jobs" AS job
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid
		   AND "status" = 'RUNNING' AND "lease_until" > now()
		   AND NOT EXISTS (
		       SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
		        WHERE tombstone."document_id" = job."document_id"
		          AND tombstone."owner_id" = job."owner_id"
		          AND tombstone."deletion_fence" >= job."deletion_fence"
		   )
		 FOR UPDATE`, job.ID, job.Attempt, job.LeaseID).Scan(&retryCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return RetryResult{}, ErrJobFenceLost
	}
	if err != nil {
		return RetryResult{}, PersistenceError{Err: err}
	}
	if retryCount >= maxTechnicalRetries {
		if err := tx.Rollback(ctx); err != nil {
			return RetryResult{}, PersistenceError{Err: err}
		}
		finalized, err := store.Fail(ctx, job, Failure{Code: code})
		return RetryResult{Finalized: finalized}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE "ai"."media_probe_jobs"
		   SET "status" = 'PENDING', "technical_retry_count" = "technical_retry_count" + 1,
		       "failure_code" = $4, "lease_id" = NULL, "lease_until" = NULL,
		       "next_visible_at" = now() + $5::interval, "updated_at" = now()
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid`,
		job.ID, job.Attempt, job.LeaseID, string(code), retryDelays[retryCount])
	if err != nil {
		return RetryResult{}, PersistenceError{Err: err}
	}
	if err := tx.Commit(ctx); err != nil {
		return RetryResult{Scheduled: true}, PersistenceError{Err: err}
	}
	return RetryResult{Scheduled: true}, nil
}

func lockActiveJob(ctx context.Context, tx pgx.Tx, job Job) error {
	var id string
	err := tx.QueryRow(ctx, `
		SELECT "id" FROM "ai"."media_probe_jobs" AS job
		 WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3::uuid
		   AND "status" = 'RUNNING' AND "lease_until" > now()
		   AND NOT EXISTS (
		       SELECT 1 FROM "ai"."media_probe_cancellation_tombstones" AS tombstone
		        WHERE tombstone."document_id" = job."document_id"
		          AND tombstone."owner_id" = job."owner_id"
		          AND tombstone."deletion_fence" >= job."deletion_fence"
		   )
		 FOR UPDATE`, job.ID, job.Attempt, job.LeaseID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrJobFenceLost
	}
	if err != nil {
		return PersistenceError{Err: err}
	}
	return nil
}

func ensureResultMatches(ctx context.Context, tx pgx.Tx, resultID string, job Job, result ProbeResult) error {
	var matches bool
	err := tx.QueryRow(ctx, `
		SELECT "document_id" = $2 AND "owner_id" = $3
		   AND "probe_generation" = $4 AND "policy_version" = $5
		   AND "deletion_fence" = $6 AND "duration_sec" = $7
		   AND "bucket" = $8 AND "object_key" = $9 AND "version_id" = $10
		   AND "etag" = $11 AND "content_length" = $12 AND "full_pipeline_job_id" = $13
		  FROM "ai"."media_probe_results" WHERE "id" = $1`,
		resultID, job.DocumentID, job.OwnerID, job.ProbeGeneration, job.PolicyVersion,
		job.DeletionFence, result.DurationSec, result.Locator.Bucket, result.Locator.Key,
		result.Locator.VersionID, result.Locator.ETag, result.Locator.ContentLength, job.FullPipelineJobID).Scan(&matches)
	if err != nil {
		return PersistenceError{Err: err}
	}
	if !matches {
		return Failure{Code: FailureMediaProbe}
	}
	return nil
}

func insertOutboxOnce(ctx context.Context, tx pgx.Tx, aggregateID, eventType string, payload []byte) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO "ai"."outbox" ("aggregate_id", "event_type", "payload")
		SELECT $1::uuid, $2::varchar, $3::jsonb
		 WHERE NOT EXISTS (
			SELECT 1 FROM "ai"."outbox"
			 WHERE "aggregate_id" = $1::uuid AND "event_type" = $2::varchar
		)`, aggregateID, eventType, payload)
	return err
}

func scanJob(row pgx.Row) (*Job, error) {
	var job Job
	var versionID, etag *string
	var contentLength *int64
	if err := row.Scan(
		&job.ID, &job.DocumentID, &job.OwnerID, &job.CorrelationID,
		&job.ProbeGeneration, &job.PolicyVersion, &job.SourceBucket, &job.SourceKey,
		&job.FullPipelineJobID, &job.DeletionFence, &job.Attempt, &job.LeaseID,
		&job.CreatedAt, &versionID, &etag, &contentLength,
	); err != nil {
		return nil, err
	}
	if versionID != nil && etag != nil && *versionID != "" && *etag != "" && contentLength != nil {
		job.Locator = &Locator{Bucket: job.SourceBucket, Key: job.SourceKey, VersionID: *versionID, ETag: *etag, ContentLength: *contentLength}
	}
	return &job, nil
}
