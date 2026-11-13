package processing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// RecordDispatch inserts the UNAVAILABLE record of an LLM call before it is sent. The row exists only while the
// attempt still owns an active job (attempt, lease, no cancellation, no revocation); a lost fence inserts nothing.
func (store *PostgresStore) RecordDispatch(ctx context.Context, job Job, requestKey, model string) error {
	tag, err := store.pool.Exec(ctx, `INSERT INTO ai.provider_usage_records(owner_id,job_id,job_attempt,request_key,provider_identity,usage_status)
SELECT job.owner_id, job.id, job.processing_attempt, $4, $5, 'UNAVAILABLE'
  FROM ai.processing_jobs AS job
 WHERE job.id=$1 AND job.job_type='FULL_PIPELINE' AND job.attempts=$2 AND job.lease_id=$3 AND job.status='RUNNING' AND job.lease_until>now() AND job.cancellation_marker_id IS NULL AND job.processing_attempt IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ai.account_access_revocations AS revocation WHERE revocation.user_id=job.owner_id)
ON CONFLICT (request_key) DO NOTHING`, job.ID, job.Attempt, job.LeaseID, requestKey, model)
	if err != nil {
		return fmt.Errorf("record llm dispatch: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrJobFenceLost
	}
	return nil
}

// RecordOutcome resolves a dispatch record by request key.
func (store *PostgresStore) RecordOutcome(ctx context.Context, requestKey string, inputTokens, outputTokens int64, status UsageStatus) error {
	if _, err := store.pool.Exec(ctx, `UPDATE ai.provider_usage_records SET usage_status=$2,input_tokens=$3,output_tokens=$4 WHERE request_key=$1`, requestKey, string(status), inputTokens, outputTokens); err != nil {
		return fmt.Errorf("record llm outcome: %w", err)
	}
	return nil
}

// readRecordedLLMUsage aggregates every LLM dispatch of the job's Document processing attempt across technical
// retries and lease reclaim. Uncertain dispatches are those still UNAVAILABLE (sent, outcome unknown).
func readRecordedLLMUsage(ctx context.Context, tx pgx.Tx, job Job) (Usage, error) {
	rows, err := tx.Query(ctx, `SELECT provider_identity,
       COALESCE(SUM(input_tokens) FILTER (WHERE usage_status='AVAILABLE'),0)::bigint,
       COALESCE(SUM(output_tokens) FILTER (WHERE usage_status='AVAILABLE'),0)::bigint,
       COUNT(*) FILTER (WHERE usage_status='AVAILABLE')::int,
       COUNT(*) FILTER (WHERE usage_status='UNAVAILABLE' AND NOT cached)::int
  FROM ai.provider_usage_records
 WHERE job_id=$1 AND job_attempt=$2 AND request_key LIKE 'go-llm:%'
 GROUP BY provider_identity ORDER BY provider_identity`, job.ID, *job.ProcessingAttempt)
	if err != nil {
		return Usage{}, err
	}
	defer rows.Close()
	usage := Usage{LLM: []ModelUsage{}}
	for rows.Next() {
		var entry ModelUsage
		var available, uncertain int
		if err := rows.Scan(&entry.Model, &entry.InputTokens, &entry.OutputTokens, &available, &uncertain); err != nil {
			return Usage{}, err
		}
		if available > 0 {
			usage.LLM = append(usage.LLM, entry)
		}
		usage.UncertainDispatches += uncertain
	}
	return usage, rows.Err()
}
