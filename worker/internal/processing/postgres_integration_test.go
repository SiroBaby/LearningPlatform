package processing

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/SiroBaby/LearningPlatform/worker/internal/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const postgresImage = "postgres:16-alpine"

type postgresIntegration struct {
	admin     *pgxpool.Pool
	container testcontainers.Container
	store     *PostgresStore
	workerURL string
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

	t.Run("enforces descriptor least privilege through the ai_worker role", func(t *testing.T) {
		documentID, ownerID := database.insertDocumentAndJob(t, ctx)
		job := database.claim(t, ctx)

		source, err := database.store.Source(ctx, *job)
		if err != nil {
			t.Fatalf("read permitted source descriptor: %v", err)
		}
		if source.StorageRef != "owners/source.txt" || source.Type != "TEXT" {
			t.Fatalf("source = %#v", source)
		}

		worker, err := pgx.Connect(ctx, database.workerURL)
		if err != nil {
			t.Fatalf("connect as worker role member: %v", err)
		}
		defer worker.Close(ctx)
		var currentUser string
		if err := worker.QueryRow(ctx, "SELECT current_user").Scan(&currentUser); err != nil {
			t.Fatalf("identify worker database role: %v", err)
		}
		if currentUser != "ai_worker_login" {
			t.Fatalf("current_user = %q, want ai_worker_login", currentUser)
		}
		assertInsufficientPrivilege(t, worker.QueryRow(ctx, `SELECT original_name FROM course.documents WHERE id=$1`, documentID).Scan(new(string)))
		_, err = worker.Exec(ctx, `UPDATE course.documents SET status='READY' WHERE id=$1 AND owner_id=$2`, documentID, ownerID)
		assertInsufficientPrivilege(t, err)
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
		retried, err := database.store.Retry(ctx, *first, ProviderUnavailable)
		if err != nil || retried {
			t.Fatalf("stale retry = (%t, %v), want (false, nil)", retried, err)
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
			requeued, err := database.store.Retry(ctx, *job, ProviderUnavailable)
			if err != nil || !requeued {
				t.Fatalf("technical retry %d = (%t, %v)", retry+1, requeued, err)
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
		if _, err := database.admin.Exec(ctx, "REVOKE INSERT ON ai.outbox FROM ai_worker"); err != nil {
			t.Fatalf("revoke outbox insert: %v", err)
		}
		t.Cleanup(func() {
			if _, err := database.admin.Exec(ctx, "GRANT INSERT ON ai.outbox TO ai_worker"); err != nil {
				t.Errorf("restore outbox insert: %v", err)
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
		if _, err := database.admin.Exec(ctx, "GRANT INSERT ON ai.outbox TO ai_worker"); err != nil {
			t.Fatalf("restore outbox insert: %v", err)
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
		testcontainers.WithWaitStrategy(wait.ForListeningPort("5432/tcp")),
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
	var canInsertDLQ bool
	if err := admin.QueryRow(ctx, `SELECT has_table_privilege('ai_worker', 'ai.processing_job_dlq', 'INSERT')`).Scan(&canInsertDLQ); err != nil {
		t.Fatalf("read DLQ role grant: %v", err)
	}
	if !canInsertDLQ {
		t.Fatal("tracked migration must grant ai_worker INSERT on the DLQ")
	}
	if _, err := admin.Exec(ctx, "CREATE ROLE ai_worker_login LOGIN PASSWORD 'worker-password' IN ROLE ai_worker"); err != nil {
		t.Fatalf("create worker login role: %v", err)
	}
	workerURL := fmt.Sprintf("postgres://ai_worker_login:%s@%s:%s/learning?sslmode=disable", url.QueryEscape("worker-password"), host, port.Port())
	store, err := NewPostgresStore(ctx, workerURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL store as ai_worker: %v", err)
	}
	return &postgresIntegration{admin: admin, container: container, store: store, workerURL: workerURL}
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

func assertInsufficientPrivilege(t *testing.T, err error) {
	t.Helper()
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "42501" {
		t.Fatalf("error = %v, want PostgreSQL insufficient privilege", err)
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
