package processing

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/migrations"
	"github.com/docker/go-connections/nat"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const postgresImage = "postgres:16-alpine"

type postgresIntegration struct {
	admin     *pgxpool.Pool
	container testcontainers.Container
	store     *PostgresStore
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
		if err != nil || completed {
			t.Fatalf("stale finalize = (%t, %v), want (false, nil)", completed, err)
		}
		retryResult, err := database.store.Retry(ctx, *first, ProviderUnavailable)
		if err != nil || retryResult.Scheduled || retryResult.Finalized {
			t.Fatalf("stale retry = (%#v, %v), want ({}, nil)", retryResult, err)
		}
		completed, err = database.store.Fail(ctx, *second, Failure{Code: ProcessingFailed})
		if err != nil || !completed {
			t.Fatalf("current finalize = (%t, %v), want (true, nil)", completed, err)
		}
		if countRows(t, ctx, database.admin, "SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1", second.ID) != 1 {
			t.Fatal("current attempt must emit exactly one result outbox event")
		}
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
		var status string
		if err := database.admin.QueryRow(ctx, "SELECT status FROM ai.processing_jobs WHERE id=$1", job.ID).Scan(&status); err != nil {
			t.Fatalf("read terminal job: %v", err)
		}
		if status != "FAILED" {
			t.Fatalf("job status = %q, want FAILED", status)
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
	if err := migrations.Run(ctx, connection, migrationDirectory(t)); err != nil {
		t.Fatalf("run tracked migrations: %v", err)
	}
	connection.Close(ctx)
	store, err := NewPostgresStore(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL store: %v", err)
	}
	return &postgresIntegration{admin: admin, container: container, store: store}
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

func countRows(t *testing.T, ctx context.Context, database *pgxpool.Pool, query string, values ...any) int {
	t.Helper()
	var count int
	if err := database.QueryRow(ctx, query, values...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}
