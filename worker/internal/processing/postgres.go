package processing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect worker database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping worker database: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}
func (store *PostgresStore) Close() { store.pool.Close() }
func (store *PostgresStore) Claim(ctx context.Context) (*Job, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM ai.processing_jobs WHERE (status='PENDING' AND next_visible_at<=now()) OR (status='RUNNING' AND lease_until<=now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var job Job
	err = tx.QueryRow(ctx, `UPDATE ai.processing_jobs SET attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '15 minutes',status='RUNNING',updated_at=now() WHERE id=$1 RETURNING id,document_id,owner_id,correlation_id,attempts,lease_id`, id).Scan(&job.ID, &job.DocumentID, &job.OwnerID, &job.CorrelationID, &job.Attempt, &job.LeaseID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &job, nil
}
func (store *PostgresStore) Source(ctx context.Context, job Job) (Source, error) {
	var source Source
	err := store.pool.QueryRow(ctx, `SELECT storage_ref,type FROM course.documents WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'`, job.DocumentID, job.OwnerID).Scan(&source.StorageRef, &source.Type)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Source{}, Failure{Code: ObjectNotFound}
		}
		return Source{}, Failure{Code: ProcessingFailed, Technical: true}
	}
	return source, nil
}
func (store *PostgresStore) ReplaceChunks(ctx context.Context, job Job, chunks []Chunk) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var present bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ai.processing_jobs WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now())`, job.ID, job.Attempt, job.LeaseID).Scan(&present)
	if err != nil {
		return false, err
	}
	if !present {
		return false, nil
	}
	if _, err = tx.Exec(ctx, `DELETE FROM ai.chunks WHERE document_id=$1 AND owner_id=$2`, job.DocumentID, job.OwnerID); err != nil {
		return false, err
	}
	for _, chunk := range chunks {
		locator, err := json.Marshal(chunk.Locator)
		if err != nil {
			return false, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO ai.chunks(id,document_id,owner_id,chunk_index,text,locator,page_number,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, chunk.ID, job.DocumentID, job.OwnerID, chunk.Index, chunk.Text, locator, nullPage(chunk.Locator), chunk.ContentHash); err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}
func nullPage(locator Locator) any {
	if locator.Kind == "page" {
		return locator.Page
	}
	return nil
}
func (store *PostgresStore) Complete(ctx context.Context, job Job) (bool, error) {
	return store.finalize(ctx, job, "COMPLETED", "READY", "")
}

func (store *PostgresStore) PersistAndComplete(ctx context.Context, job Job, chunks []Chunk, questions []Question) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var present bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ai.processing_jobs WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now())`, job.ID, job.Attempt, job.LeaseID).Scan(&present); err != nil || !present {
		return false, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM ai.chunks WHERE document_id=$1 AND owner_id=$2`, job.DocumentID, job.OwnerID); err != nil {
		return false, err
	}
	for _, chunk := range chunks {
		locator, marshalErr := json.Marshal(chunk.Locator)
		if marshalErr != nil {
			return false, marshalErr
		}
		if _, err = tx.Exec(ctx, `INSERT INTO ai.chunks(id,document_id,owner_id,chunk_index,text,locator,page_number,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, chunk.ID, job.DocumentID, job.OwnerID, chunk.Index, chunk.Text, locator, nullPage(chunk.Locator), chunk.ContentHash); err != nil {
			return false, err
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE ai.processing_jobs SET status='COMPLETED',failure_code=NULL,error_message=NULL,lease_id=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now()`, job.ID, job.Attempt, job.LeaseID)
	if err != nil || tag.RowsAffected() != 1 {
		return tag.RowsAffected() == 1, err
	}
	payload, err := json.Marshal(map[string]any{"version": 1, "documentId": job.DocumentID, "ownerId": job.OwnerID, "status": "READY", "questions": questions, "promptVersion": "phase0-v1", "minimumQuestionCount": 1, "errorCode": nil, "errorMessage": nil, "budgetStatus": nil, "estimatedCredits": nil, "estimateStatus": nil, "settledCredits": nil})
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO ai.outbox(aggregate_id,event_type,payload) VALUES($1,'DocumentProcessingResult',$2)`, job.ID, payload); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
func (store *PostgresStore) Fail(ctx context.Context, job Job, failure Failure) (bool, error) {
	return store.finalize(ctx, job, "FAILED", "FAILED", string(failure.Code))
}
func (store *PostgresStore) finalize(ctx context.Context, job Job, status, result, code string) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE ai.processing_jobs SET status=$4,failure_code=NULLIF($5,''),error_message=NULL,lease_id=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now()`, job.ID, job.Attempt, job.LeaseID, status, code)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil
	}
	payload, err := json.Marshal(map[string]any{"version": 1, "documentId": job.DocumentID, "ownerId": job.OwnerID, "status": result, "errorCode": nilIfEmpty(code), "errorMessage": nil, "budgetStatus": nil, "estimatedCredits": nil, "estimateStatus": nil, "settledCredits": nil})
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ai.outbox(aggregate_id,event_type,payload) VALUES($1,'DocumentProcessingResult',$2)`, job.ID, payload)
	if err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func (store *PostgresStore) Retry(ctx context.Context, job Job, code FailureCode) (RetryResult, error) {
	delays := []string{"5 seconds", "30 seconds", "5 minutes"}
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return RetryResult{}, err
	}
	defer tx.Rollback(ctx)
	var retry int
	err = tx.QueryRow(ctx, `SELECT technical_retry_count FROM ai.processing_jobs WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now() FOR UPDATE`, job.ID, job.Attempt, job.LeaseID).Scan(&retry)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RetryResult{}, nil
		}
		return RetryResult{}, err
	}
	if retry >= len(delays) {
		// finalizeWithDLQ obtains its own transaction; release this row lock first.
		if err = tx.Rollback(ctx); err != nil {
			return RetryResult{}, err
		}
		finalized, finalizeErr := store.finalizeWithDLQ(ctx, job, code)
		return RetryResult{Finalized: finalized}, finalizeErr
	}
	tag, err := tx.Exec(ctx, `UPDATE ai.processing_jobs SET status='PENDING',technical_retry_count=technical_retry_count+1,failure_code=$4,lease_id=NULL,lease_until=NULL,next_visible_at=now()+$5::interval,updated_at=now() WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now()`, job.ID, job.Attempt, job.LeaseID, code, delays[retry])
	if err != nil || tag.RowsAffected() != 1 {
		return RetryResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return RetryResult{}, err
	}
	return RetryResult{Scheduled: true}, nil
}

func (store *PostgresStore) finalizeWithDLQ(ctx context.Context, job Job, code FailureCode) (bool, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE ai.processing_jobs SET status='FAILED', failure_code=$4, error_message=NULL, lease_id=NULL, lease_until=NULL, completed_at=now(), updated_at=now() WHERE id=$1 AND attempts=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now()`, job.ID, job.Attempt, job.LeaseID, code)
	if err != nil || tag.RowsAffected() != 1 {
		return tag.RowsAffected() == 1, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO ai.processing_job_dlq(job_id,document_id,owner_id,correlation_id,idempotency_key,last_attempt,reason_code) SELECT id,document_id,owner_id,correlation_id,idempotency_key,attempts,$2 FROM ai.processing_jobs WHERE id=$1`, job.ID, code); err != nil {
		return false, err
	}
	payload, err := json.Marshal(map[string]any{"version": 1, "documentId": job.DocumentID, "ownerId": job.OwnerID, "status": "FAILED", "errorCode": code, "errorMessage": nil, "budgetStatus": nil, "estimatedCredits": nil, "estimateStatus": nil, "settledCredits": nil})
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO ai.outbox(aggregate_id,event_type,payload) VALUES($1,'DocumentProcessingResult',$2)`, job.ID, payload); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
