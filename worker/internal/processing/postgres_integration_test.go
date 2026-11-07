package processing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/migrations"
	"github.com/docker/go-connections/nat"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const postgresImage = "postgres:16-alpine"

func TestPostgresStoreRetryPreservesScheduledOutcomeWhenCommitFails(t *testing.T) {
	commitErr := errors.New("commit outcome unavailable")
	transaction := &retryTransactionMock{commitErr: commitErr}
	store := &PostgresStore{
		beginRetry: func(context.Context) (pgx.Tx, error) {
			return transaction, nil
		},
	}

	result, err := store.Retry(context.Background(), Job{ID: "job", Attempt: 1, LeaseID: "lease"}, ProviderUnavailable)
	if !result.Scheduled || result.Finalized || !errors.Is(err, commitErr) {
		t.Fatalf("retry after commit error = (%#v, %v), want ({Scheduled:true}, commit error)", result, err)
	}
	if err.Error() != string(ProcessingFailed) {
		t.Fatalf("retry error = %q, want stable redacted failure", err)
	}
	if !transaction.execCalled || !transaction.commitCalled {
		t.Fatalf("retry transaction calls = (exec=%t, commit=%t), want both after update", transaction.execCalled, transaction.commitCalled)
	}
}

func TestPostgresStoreRetryKeepsPreCommitErrorsUnchanged(t *testing.T) {
	queryErr := errors.New("query failed")
	execErr := errors.New("update failed")
	for name, transaction := range map[string]*retryTransactionMock{
		"query": {queryErr: queryErr},
		"exec":  {execErr: execErr},
	} {
		t.Run(name, func(t *testing.T) {
			store := &PostgresStore{
				beginRetry: func(context.Context) (pgx.Tx, error) {
					return transaction, nil
				},
			}
			result, err := store.Retry(context.Background(), Job{ID: "job", Attempt: 1, LeaseID: "lease"}, ProviderUnavailable)
			wantErr := queryErr
			if name == "exec" {
				wantErr = execErr
			}
			if result != (RetryResult{}) || !errors.Is(err, wantErr) {
				t.Fatalf("retry before commit = (%#v, %v), want ({}, %v)", result, err, wantErr)
			}
		})
	}
}

type retryTransactionMock struct {
	pgx.Tx
	queryErr                 error
	execErr                  error
	commitErr                error
	execCalled, commitCalled bool
}

func (transaction *retryTransactionMock) QueryRow(context.Context, string, ...any) pgx.Row {
	return retryRowMock{err: transaction.queryErr}
}

func (transaction *retryTransactionMock) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	transaction.execCalled = true
	if transaction.execErr != nil {
		return pgconn.CommandTag{}, transaction.execErr
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (transaction *retryTransactionMock) Commit(context.Context) error {
	transaction.commitCalled = true
	return transaction.commitErr
}

func (transaction *retryTransactionMock) Rollback(context.Context) error { return nil }

type retryRowMock struct{ err error }

func (row retryRowMock) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*int)) = 0
	return nil
}

type postgresIntegration struct {
	admin       *pgxpool.Pool
	container   testcontainers.Container
	store       *PostgresStore
	databaseURL string
}

func TestPostgresStoreIntegration(t *testing.T) {
	ctx := context.Background()
	database := startPostgresIntegration(t, ctx)
	t.Cleanup(func() {
		database.store.Close()
		database.admin.Close()
		if err := database.container.Terminate(ctx); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})

	t.Run("reads the source descriptor for a claimed job", func(t *testing.T) {
		database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)

		source, err := database.store.Source(ctx, *job)
		if err != nil {
			t.Fatalf("read permitted source descriptor: %v", err)
		}
		if source.StorageRef != "owners/source.txt" || source.Type != "TEXT" {
			t.Fatalf("source = %#v", source)
		}
	})

	t.Run("preserves source operation for a database failure", func(t *testing.T) {
		database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)
		const role = "source_failure_probe"
		if _, err := database.admin.Exec(ctx, "CREATE ROLE "+role+" LOGIN PASSWORD 'source_failure_probe'"); err != nil {
			t.Fatalf("create source failure role: %v", err)
		}
		var probeStore *PostgresStore
		t.Cleanup(func() {
			if probeStore != nil {
				probeStore.Close()
			}
			if _, err := database.admin.Exec(ctx, "REASSIGN OWNED BY "+role+" TO postgres; DROP OWNED BY "+role+"; DROP ROLE IF EXISTS "+role); err != nil {
				t.Errorf("drop source failure role: %v", err)
			}
		})
		if _, err := database.admin.Exec(ctx, "GRANT USAGE ON SCHEMA course TO "+role); err != nil {
			t.Fatalf("grant source failure role schema access: %v", err)
		}
		probeURL := strings.Replace(database.databaseURL, "postgres:postgres@", "source_failure_probe:source_failure_probe@", 1)
		var err error
		probeStore, err = newPostgresStoreFromURL(ctx, probeURL)
		if err != nil {
			t.Fatalf("connect source failure store: %v", err)
		}
		_, err = probeStore.Source(ctx, *job)
		assertFailureOperation(t, err, FailureOperationSourceDescriptorRead)
		if err.Error() != string(ProcessingFailed) {
			t.Fatalf("source database error = %q, want stable redacted failure", err)
		}
	})

	t.Run("classifies only missing descriptors as final failures", func(t *testing.T) {
		_, ownerID := database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)
		job.DocumentID = "00000000-0000-0000-0000-000000000000"
		job.OwnerID = ownerID

		_, err := database.store.Source(ctx, *job)
		assertFailure(t, err, ObjectNotFound, false)

	})

	t.Run("reclaims expired leases and rejects stale attempt fences", func(t *testing.T) {
		database.insertDocumentAndJob(t, ctx)
		first := database.claim(t, ctx)
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`, first.ID); err != nil {
			t.Fatalf("expire first lease: %v", err)
		}
		second := database.claim(t, ctx)
		if second.Attempt != first.Attempt+1 || second.LeaseID == first.LeaseID {
			t.Fatalf("reclaimed job = %#v, first = %#v", second, first)
		}

		completed, err := database.store.Fail(ctx, *first, Failure{Code: ProcessingFailed})
		if err == nil || completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("stale finalize = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		retryResult, err := database.store.Retry(ctx, *first, ProviderUnavailable)
		if err == nil || retryResult.Scheduled || retryResult.Finalized || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("stale retry = (%#v, %v), want ({}, ErrJobFenceLost)", retryResult, err)
		}
		persisted, err := database.store.PersistAndComplete(ctx, *first, []Chunk{{ID: "33333333-3333-4333-8333-333333333333", Index: 0, Text: "stale", ContentHash: "stale"}}, nil)
		if err == nil || persisted || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("stale persistence = (%t, %v), want (false, ErrJobFenceLost)", persisted, err)
		}
		completed, err = database.store.Fail(ctx, *second, Failure{Code: ProcessingFailed})
		if err != nil || !completed {
			t.Fatalf("current finalize = (%t, %v), want (true, nil)", completed, err)
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1", second.ID) != 1 {
			t.Fatal("current attempt must emit exactly one result outbox event")
		}
		assertOutboxFence(t, ctx, database.admin, *second)
	})

	t.Run("retries technical failures then atomically moves the job to the DLQ", func(t *testing.T) {
		database.insertDocumentAndJob(t, ctx)
		var job *Job
		for retry := 0; retry < 4; retry++ {
			job = database.claim(t, ctx)
			retryResult, err := database.store.Retry(ctx, *job, ProviderUnavailable)
			if err != nil || (!retryResult.Scheduled && !retryResult.Finalized) {
				t.Fatalf("technical retry %d = (%#v, %v)", retry+1, retryResult, err)
			}
			if retry < 3 && !retryResult.Scheduled {
				t.Fatalf("technical retry %d should schedule, got %#v", retry+1, retryResult)
			}
			if retry == 3 && !retryResult.Finalized {
				t.Fatalf("technical retry %d should finalize, got %#v", retry+1, retryResult)
			}
			if retry < 3 {
				if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET next_visible_at=now() WHERE id=$1`, job.ID); err != nil {
					t.Fatalf("make retry %d visible: %v", retry+1, err)
				}
			}
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.processing_job_dlq WHERE job_id=$1", job.ID) != 1 {
			t.Fatal("exhausted technical retry must create one DLQ row")
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1", job.ID) != 1 {
			t.Fatal("exhausted technical retry must emit one failed result event")
		}
		assertOutboxFence(t, ctx, database.admin, *job)
		var status string
		if err := database.admin.QueryRow(ctx, "SELECT status FROM ai.processing_jobs WHERE id=$1", job.ID).Scan(&status); err != nil {
			t.Fatalf("read terminal job: %v", err)
		}
		if status != "FAILED" {
			t.Fatalf("job status = %q, want FAILED", status)
		}
	})

	t.Run("does not rearm a completed attempt", func(t *testing.T) {
		documentID, _ := database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)
		chunks := []Chunk{{ID: "22222222-2222-4222-8222-222222222222", Index: 0, Text: "completed chunk", ContentHash: "completed"}}
		persisted, err := database.store.PersistAndComplete(ctx, *job, chunks, nil)
		if err != nil || !persisted {
			t.Fatalf("complete job = (%t, %v), want (true, nil)", persisted, err)
		}

		retryResult, err := database.store.Retry(ctx, *job, ProviderUnavailable)
		if err == nil || retryResult.Scheduled || retryResult.Finalized || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("completed attempt retry = (%#v, %v), want ({}, ErrJobFenceLost)", retryResult, err)
		}
		persisted, err = database.store.PersistAndComplete(ctx, *job, chunks, nil)
		if err == nil || persisted || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("duplicate completed persistence = (%t, %v), want (false, ErrJobFenceLost)", persisted, err)
		}
		finalized, err := database.store.Fail(ctx, *job, Failure{Code: ProviderUnavailable})
		if err == nil || finalized || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("duplicate completed finalization = (%t, %v), want (false, ErrJobFenceLost)", finalized, err)
		}
		var status string
		if err := database.admin.QueryRow(ctx, "SELECT status FROM ai.processing_jobs WHERE id=$1", job.ID).Scan(&status); err != nil {
			t.Fatalf("read completed job: %v", err)
		}
		if status != "COMPLETED" {
			t.Fatalf("status after completed retry = %q, want COMPLETED", status)
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.processing_job_dlq WHERE job_id=$1", job.ID) != 0 {
			t.Fatal("completed attempt must not create a DLQ row")
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1", job.ID) != 1 {
			t.Fatal("completed attempt must keep exactly one result outbox event")
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.chunks WHERE document_id=$1", documentID) != 1 {
			t.Fatal("completed attempt must keep its persisted chunk")
		}
	})

	t.Run("rolls back chunks and finalization when the outbox write fails", func(t *testing.T) {
		documentID, _ := database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)
		if _, err := database.admin.Exec(ctx, `CREATE FUNCTION ai.fail_outbox_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced outbox failure'; END; $$; CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON ai.outbox FOR EACH ROW EXECUTE FUNCTION ai.fail_outbox_insert()`); err != nil {
			t.Fatalf("create outbox failure trigger: %v", err)
		}
		t.Cleanup(func() {
			if _, err := database.admin.Exec(ctx, "DROP TRIGGER IF EXISTS fail_outbox_insert ON ai.outbox; DROP FUNCTION IF EXISTS ai.fail_outbox_insert()"); err != nil {
				t.Errorf("drop outbox failure trigger: %v", err)
			}
		})
		chunks := []Chunk{{ID: "11111111-1111-4111-8111-111111111111", Index: 0, Text: "verified chunk", ContentHash: "a", Locator: Locator{Kind: "text-range", End: 14}}}
		persisted, err := database.store.PersistAndComplete(ctx, *job, chunks, nil)
		if err == nil || persisted {
			t.Fatalf("outbox-denied persistence = (%t, %v), want (false, error)", persisted, err)
		}
		assertFailureOperation(t, err, FailureOperationOutboxInsert)
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.chunks WHERE document_id=$1", documentID) != 0 {
			t.Fatal("failed transaction must not leave chunks")
		}
		var status string
		if err := database.admin.QueryRow(ctx, "SELECT status FROM ai.processing_jobs WHERE id=$1", job.ID).Scan(&status); err != nil {
			t.Fatalf("read fenced job after rollback: %v", err)
		}
		if status != "RUNNING" {
			t.Fatalf("status after rollback = %q, want RUNNING", status)
		}
		if _, err := database.admin.Exec(ctx, "DROP TRIGGER fail_outbox_insert ON ai.outbox; DROP FUNCTION ai.fail_outbox_insert()"); err != nil {
			t.Fatalf("drop outbox failure trigger: %v", err)
		}
		persisted, err = database.store.PersistAndComplete(ctx, *job, chunks, nil)
		if err != nil || !persisted {
			t.Fatalf("atomic persistence = (%t, %v), want (true, nil)", persisted, err)
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.chunks WHERE document_id=$1", documentID) != 1 {
			t.Fatal("successful transaction must persist its chunk")
		}
		if err := database.admin.QueryRow(ctx, "SELECT status FROM ai.processing_jobs WHERE id=$1", job.ID).Scan(&status); err != nil {
			t.Fatalf("read completed job: %v", err)
		}
		if status != "COMPLETED" {
			t.Fatalf("status after persistence = %q, want COMPLETED", status)
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1", job.ID) != 1 {
			t.Fatal("successful transaction must emit one result outbox event")
		}
		assertOutboxFence(t, ctx, database.admin, *job)
	})

	t.Run("writes the tracked usage into completed and failed result payloads", func(t *testing.T) {
		readUsage := func(job Job) (usage Usage, present bool) {
			var encoded []byte
			if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProcessingResult' ORDER BY id DESC LIMIT 1`, job.ID).Scan(&encoded); err != nil {
				t.Fatalf("read result outbox payload: %v", err)
			}
			var payload struct {
				Usage *Usage `json:"usage"`
			}
			if err := json.Unmarshal(encoded, &payload); err != nil {
				t.Fatalf("decode result outbox payload: %v", err)
			}
			if payload.Usage == nil {
				return Usage{}, false
			}
			return *payload.Usage, true
		}
		trackedContext := func() context.Context {
			tracker := NewUsageTracker()
			tracker.Dispatched()
			tracker.Reported("model-a", 12, 3)
			tracker.Dispatched()
			return WithUsageTracker(ctx, tracker)
		}
		expected := Usage{LLM: []ModelUsage{{Model: "model-a", InputTokens: 12, OutputTokens: 3}}, UncertainDispatches: 1}

		database.insertDocumentAndJob(t, ctx)
		completed := database.claim(t, ctx)
		chunks := []Chunk{{ID: "44444444-4444-4444-8444-444444444444", Index: 0, Text: "usage chunk", ContentHash: "usage", Locator: Locator{Kind: "text-range", End: 11}}}
		if persisted, err := database.store.PersistAndComplete(trackedContext(), *completed, chunks, nil); err != nil || !persisted {
			t.Fatalf("complete job = (%t, %v), want (true, nil)", persisted, err)
		}
		if usage, present := readUsage(*completed); !present || !reflect.DeepEqual(usage, expected) {
			t.Fatalf("completed usage = (%#v, %t), want %#v", usage, present, expected)
		}

		database.insertDocumentAndJob(t, ctx)
		failed := database.claim(t, ctx)
		if finalized, err := database.store.Fail(trackedContext(), *failed, Failure{Code: OutputInvalid}); err != nil || !finalized {
			t.Fatalf("fail job = (%t, %v), want (true, nil)", finalized, err)
		}
		if usage, present := readUsage(*failed); !present || !reflect.DeepEqual(usage, expected) {
			t.Fatalf("failed usage = (%#v, %t), want %#v", usage, present, expected)
		}

		database.insertDocumentAndJob(t, ctx)
		untracked := database.claim(t, ctx)
		if finalized, err := database.store.Fail(ctx, *untracked, Failure{Code: PDFInvalid}); err != nil || !finalized {
			t.Fatalf("fail untracked job = (%t, %v), want (true, nil)", finalized, err)
		}
		if _, present := readUsage(*untracked); present {
			t.Fatal("a result without a tracker must keep the legacy payload shape (no usage block)")
		}
	})

	t.Run("completes a TEXT_EXTRACT job and publishes the measured size under the fence", func(t *testing.T) {
		documentID, ownerID := database.insertDocumentAndJob(t, ctx)
		fullPipelineJobID := database.convertToTextExtract(t, ctx, documentID, 3)
		job := database.claim(t, ctx)
		if job.Type != JobTypeTextExtract || job.DocumentID != documentID {
			t.Fatalf("claimed job = %#v, want the TEXT_EXTRACT job", job)
		}
		source, err := database.store.Source(ctx, *job)
		if err != nil || source.StorageRef != "owners/source.txt" {
			t.Fatalf("source for the extract job = (%#v, %v)", source, err)
		}
		if err := database.store.CheckActive(ctx, *job); err != nil {
			t.Fatalf("check active extract job: %v", err)
		}

		stale := *job
		stale.LeaseID = "00000000-0000-0000-0000-000000000000"
		if completed, err := database.store.CompleteExtraction(ctx, stale, ExtractionSummary{Chars: 10, Chunks: 1}); completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("stale extraction = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if got := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1`, job.ID); got != 0 {
			t.Fatalf("a stale extraction wrote %d outbox rows", got)
		}

		if completed, err := database.store.CompleteExtraction(ctx, *job, ExtractionSummary{Chars: 4321, Chunks: 7}); err != nil || !completed {
			t.Fatalf("complete extraction = (%t, %v), want (true, nil)", completed, err)
		}
		var status string
		if err := database.admin.QueryRow(ctx, `SELECT status FROM ai.processing_jobs WHERE id=$1`, job.ID).Scan(&status); err != nil || status != "COMPLETED" {
			t.Fatalf("job status = (%q, %v), want COMPLETED", status, err)
		}
		var encoded []byte
		if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentExtractionCompleted'`, job.ID).Scan(&encoded); err != nil {
			t.Fatalf("read extraction outbox payload: %v", err)
		}
		var payload map[string]any
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatalf("decode extraction payload: %v", err)
		}
		want := map[string]any{"version": float64(1), "documentId": documentID, "ownerId": ownerID, "fullPipelineJobId": fullPipelineJobID, "processingAttempt": float64(3), "deletionFence": float64(0), "chunkCount": float64(7), "extractedChars": float64(4321)}
		for key, value := range want {
			if payload[key] != value {
				t.Fatalf("payload[%s] = %v, want %v (payload %v)", key, payload[key], value, payload)
			}
		}
		if completed, err := database.store.CompleteExtraction(ctx, *job, ExtractionSummary{Chars: 4321, Chunks: 7}); completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("replayed extraction = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if got := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentExtractionCompleted'`, job.ID); got != 1 {
			t.Fatalf("extraction outbox rows = %d, want exactly one", got)
		}
	})

	t.Run("a cancelled TEXT_EXTRACT job fails its fence and cannot complete", func(t *testing.T) {
		documentID, _ := database.insertDocumentAndJob(t, ctx)
		database.convertToTextExtract(t, ctx, documentID, 1)
		job := database.claim(t, ctx)
		if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET status='CANCELLED', cancellation_marker_id=gen_random_uuid(), lease_id=NULL, lease_until=NULL WHERE id=$1`, job.ID); err != nil {
			t.Fatalf("cancel extract job: %v", err)
		}
		if err := database.store.CheckActive(ctx, *job); !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("check active after cancellation = %v, want ErrJobFenceLost", err)
		}
		if completed, err := database.store.CompleteExtraction(ctx, *job, ExtractionSummary{Chars: 1, Chunks: 1}); completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("extraction after cancellation = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if got := countRows(t, ctx, database.admin, `SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1`, job.ID); got != 0 {
			t.Fatalf("a cancelled extraction wrote %d outbox rows", got)
		}
	})

	t.Run("marks the failure result of a TEXT_EXTRACT job and leaves FULL_PIPELINE payloads unchanged", func(t *testing.T) {
		documentID, _ := database.insertDocumentAndJob(t, ctx)
		database.convertToTextExtract(t, ctx, documentID, 1)
		extractJob := database.claim(t, ctx)
		if finalized, err := database.store.Fail(ctx, *extractJob, Failure{Code: PDFTextNotFound}); err != nil || !finalized {
			t.Fatalf("fail extract job = (%t, %v), want (true, nil)", finalized, err)
		}
		database.insertDocumentAndJob(t, ctx)
		pipelineJob := database.claim(t, ctx)
		if finalized, err := database.store.Fail(ctx, *pipelineJob, Failure{Code: PDFInvalid}); err != nil || !finalized {
			t.Fatalf("fail pipeline job = (%t, %v), want (true, nil)", finalized, err)
		}
		readJobType := func(job Job) (any, bool) {
			var encoded []byte
			if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProcessingResult'`, job.ID).Scan(&encoded); err != nil {
				t.Fatalf("read result payload: %v", err)
			}
			var payload map[string]any
			if err := json.Unmarshal(encoded, &payload); err != nil {
				t.Fatalf("decode result payload: %v", err)
			}
			value, present := payload["jobType"]
			return value, present
		}
		if value, present := readJobType(*extractJob); !present || value != JobTypeTextExtract {
			t.Fatalf("extract failure payload jobType = (%v, %t), want TEXT_EXTRACT", value, present)
		}
		if _, present := readJobType(*pipelineJob); present {
			t.Fatal("a FULL_PIPELINE payload must keep its legacy shape (no jobType)")
		}
	})
}

func startPostgresIntegration(t *testing.T, ctx context.Context) *postgresIntegration {
	t.Helper()
	container, err := testcontainers.Run(ctx, postgresImage,
		testcontainers.WithEnv(map[string]string{"POSTGRES_PASSWORD": "postgres", "POSTGRES_USER": "postgres", "POSTGRES_DB": "learning"}),
		testcontainers.WithExposedPorts("5432/tcp"),
		testcontainers.WithWaitStrategy(wait.ForSQL("5432/tcp", "pgx", func(host string, port nat.Port) string {
			return fmt.Sprintf("postgres://postgres:postgres@%s:%s/learning?sslmode=disable", host, port.Port())
		}).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start PostgreSQL test container: %v", err)
	}
	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("get PostgreSQL host: %v", err)
	}
	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		t.Fatalf("get PostgreSQL port: %v", err)
	}
	adminURL := fmt.Sprintf("postgres://postgres:postgres@%s:%s/learning?sslmode=disable", host, port.Port())
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL administrator: %v", err)
	}
	connection, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect migration runner: %v", err)
	}
	if _, err := connection.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe'
			) THEN
				CREATE ROLE learning_platform_media_probe
					NOLOGIN
					NOSUPERUSER
					NOCREATEDB
					NOCREATEROLE
					NOINHERIT;
			END IF;
		END
		$$;
	`); err != nil {
		t.Fatalf("create media-probe database role: %v", err)
	}
	if err := migrations.Run(ctx, connection, migrationDirectory(t)); err != nil {
		t.Fatalf("run tracked migrations: %v", err)
	}
	connection.Close(ctx)
	store, err := newPostgresStoreFromURL(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL store: %v", err)
	}
	return &postgresIntegration{admin: admin, container: container, store: store, databaseURL: adminURL}
}

// newPostgresStoreFromURL connects the local testcontainers fixture, whose URL
// explicitly sets sslmode=disable.
func newPostgresStoreFromURL(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	return NewPostgresStore(ctx, poolConfig)
}

func migrationDirectory(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate integration test source")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "app", "src", "database", "migrations")
}

func (database *postgresIntegration) insertDocumentAndJob(t *testing.T, ctx context.Context) (string, string) {
	t.Helper()
	var documentID, ownerID string
	if err := database.admin.QueryRow(ctx, `SELECT gen_random_uuid(), gen_random_uuid()`).Scan(&documentID, &ownerID); err != nil {
		t.Fatalf("create IDs: %v", err)
	}
	if _, err := database.admin.Exec(ctx, `INSERT INTO course.documents(id, owner_id, type, original_name, storage_ref, size_bytes, status) VALUES($1, $2, 'TEXT', 'source.txt', 'owners/source.txt', 4, 'PROCESSING')`, documentID, ownerID); err != nil {
		t.Fatalf("insert document: %v", err)
	}
	if _, err := database.admin.Exec(ctx, `INSERT INTO ai.processing_jobs(document_id, owner_id, job_type, idempotency_key, correlation_id) VALUES($1, $2, 'FULL_PIPELINE', $3, gen_random_uuid())`, documentID, ownerID, "key-"+documentID); err != nil {
		t.Fatalf("insert processing job: %v", err)
	}
	return documentID, ownerID
}

func (database *postgresIntegration) claim(t *testing.T, ctx context.Context) *Job {
	t.Helper()
	job, err := database.store.Claim(ctx)
	if err != nil || job == nil {
		t.Fatalf("claim job = (%#v, %v)", job, err)
	}
	return job
}

func assertFailure(t *testing.T, err error, code FailureCode, technical bool) {
	t.Helper()
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != code || failure.Technical != technical {
		t.Fatalf("error = %#v, want failure (%s, technical=%t)", err, code, technical)
	}
}

func assertFailureOperation(t *testing.T, err error, operation FailureOperation) {
	t.Helper()
	var failure Failure
	if !errors.As(err, &failure) || failure.Operation != operation {
		t.Fatalf("error = %#v, want failure operation %s", err, operation)
	}
}

func assertOutboxFence(t *testing.T, ctx context.Context, database *pgxpool.Pool, job Job) {
	t.Helper()
	var payload struct {
		Attempt *int    `json:"attempt"`
		LeaseID *string `json:"leaseId"`
	}
	var encoded []byte
	if err := database.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProcessingResult' ORDER BY id DESC LIMIT 1`, job.ID).Scan(&encoded); err != nil {
		t.Fatalf("read result outbox payload: %v", err)
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("decode result outbox payload: %v", err)
	}
	if payload.Attempt == nil || *payload.Attempt != job.Attempt {
		t.Fatalf("result outbox attempt = %v, want %d", payload.Attempt, job.Attempt)
	}
	if payload.LeaseID == nil || *payload.LeaseID != job.LeaseID {
		t.Fatalf("result outbox leaseId = %v, want claimed lease", payload.LeaseID)
	}
}

func countRows(t *testing.T, ctx context.Context, database *pgxpool.Pool, query string, values ...any) int {
	t.Helper()
	var count int
	if err := database.QueryRow(ctx, query, values...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

// convertToTextExtract turns the document's job into the TEXT_EXTRACT job Node queues for a Platform Model.
func (database *postgresIntegration) convertToTextExtract(t *testing.T, ctx context.Context, documentID string, processingAttempt int) string {
	t.Helper()
	var fullPipelineJobID string
	if err := database.admin.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&fullPipelineJobID); err != nil {
		t.Fatalf("create full pipeline job id: %v", err)
	}
	if _, err := database.admin.Exec(ctx, `UPDATE ai.processing_jobs SET job_type='TEXT_EXTRACT', full_pipeline_job_id=$2, processing_attempt=$3, attempts=$3-1, idempotency_key=idempotency_key||':extract' WHERE document_id=$1`, documentID, fullPipelineJobID, processingAttempt); err != nil {
		t.Fatalf("convert job to TEXT_EXTRACT: %v", err)
	}
	return fullPipelineJobID
}
