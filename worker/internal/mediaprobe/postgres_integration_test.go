package mediaprobe

import (
	"context"
	"encoding/json"
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

const (
	postgresImage       = "postgres:16-alpine"
	integrationBucket   = "learning-platform-test-media"
	integrationPolicy   = "media-v1"
	lockWaitTimeout     = 10 * time.Second
	lockWaitPollDelay   = 10 * time.Millisecond
	integrationDuration = 42
)

type mediaProbeIntegration struct {
	admin     *pgxpool.Pool
	container testcontainers.Container
	store     *PostgresStore
}

// TestPostgresStoreDeletionFenceIntegration races Document deletion against the
// media-probe worker on a real PostgreSQL. Every interleaving is forced by a
// held lock and confirmed through pg_stat_activity before the next step runs.
func TestPostgresStoreDeletionFenceIntegration(t *testing.T) {
	ctx := context.Background()
	database := startMediaProbeIntegration(t, ctx)
	t.Cleanup(func() {
		database.store.Close()
		database.admin.Close()
		if err := database.container.Terminate(ctx); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})

	t.Run("deletion before claim leaves nothing claimable", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		database.deleteDocument(t, ctx, probe)

		database.assertNothingClaimable(t, ctx, probe)
		// The tombstone is the second line of defence: even if the cancelled row
		// were made claimable again, its old fence must keep Claim away from it.
		database.exec(t, ctx, `UPDATE ai.media_probe_jobs SET status='PENDING', next_visible_at=now() WHERE id=$1`, probe.jobID)
		database.assertNothingClaimable(t, ctx, probe)
	})

	t.Run("deletion after the first locator rejects completion", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		locator := probe.locator()
		persisted, err := database.store.PersistLocator(ctx, job, locator)
		if err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v), want (true, nil)", persisted, err)
		}
		database.deleteDocument(t, ctx, probe)

		completed, err := database.store.Complete(ctx, job, ProbeResult{DurationSec: integrationDuration, Locator: locator})
		if completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("Complete() = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.media_probe_results WHERE media_probe_job_id=$1`, job.ID); count != 0 {
			t.Fatalf("media_probe_results rows = %d, want 0", count)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1`, job.ID); count != 0 {
			t.Fatalf("ai.outbox rows = %d, want 0", count)
		}
		database.assertJobStatus(t, ctx, probe, "CANCELLED")
	})

	t.Run("deletion waiting behind an in-flight completion commits a newer fence", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		locator := probe.locator()
		if persisted, err := database.store.PersistLocator(ctx, job, locator); err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v), want (true, nil)", persisted, err)
		}
		// Park Complete after it locked the job row: its outbox INSERT needs ROW
		// EXCLUSIVE on ai.outbox, which conflicts with this EXCLUSIVE lock.
		outboxGate, err := database.admin.Begin(ctx)
		if err != nil {
			t.Fatalf("begin outbox gate: %v", err)
		}
		defer outboxGate.Rollback(ctx)
		if _, err := outboxGate.Exec(ctx, `LOCK TABLE ai.outbox IN EXCLUSIVE MODE`); err != nil {
			t.Fatalf("lock ai.outbox: %v", err)
		}
		completion := make(chan completeOutcome, 1)
		go func() {
			completed, err := database.store.Complete(ctx, job, ProbeResult{DurationSec: integrationDuration, Locator: locator})
			completion <- completeOutcome{completed: completed, err: err}
		}()
		database.waitForRelationLockWaiter(t, ctx, "ai.outbox")

		deletionConn, err := database.admin.Acquire(ctx)
		if err != nil {
			t.Fatalf("acquire deletion connection: %v", err)
		}
		defer deletionConn.Release()
		var deletionPID int
		if err := deletionConn.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&deletionPID); err != nil {
			t.Fatalf("read deletion backend pid: %v", err)
		}
		deletion := make(chan error, 1)
		go func() { deletion <- runDeletion(ctx, deletionConn.Conn(), probe) }()
		database.waitForBackendLockWait(t, ctx, deletionPID)

		if err := outboxGate.Commit(ctx); err != nil {
			t.Fatalf("release ai.outbox: %v", err)
		}
		outcome := <-completion
		if !outcome.completed || outcome.err != nil {
			t.Fatalf("Complete() = (%t, %v), want (true, nil)", outcome.completed, outcome.err)
		}
		if err := <-deletion; err != nil {
			t.Fatalf("deletion transaction: %v", err)
		}

		var payload struct {
			DeletionFence *int64 `json:"deletionFence"`
		}
		var encoded []byte
		if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProbeCompleted'`, job.ID).Scan(&encoded); err != nil {
			t.Fatalf("read DocumentProbeCompleted outbox: %v", err)
		}
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatalf("decode DocumentProbeCompleted outbox: %v", err)
		}
		var documentFence int64
		var documentStatus string
		if err := database.admin.QueryRow(ctx, `SELECT deletion_fence, status FROM course.documents WHERE id=$1`, probe.documentID).Scan(&documentFence, &documentStatus); err != nil {
			t.Fatalf("read deleted document: %v", err)
		}
		// The return relay drops a completion whose fence differs from the Document.
		if payload.DeletionFence == nil || *payload.DeletionFence != job.DeletionFence || documentFence != job.DeletionFence+1 || documentStatus != "DELETING" {
			t.Fatalf("outbox fence = %v, document = (%d, %s), want stale fence %d behind DELETING fence %d", payload.DeletionFence, documentFence, documentStatus, job.DeletionFence, job.DeletionFence+1)
		}
	})

	t.Run("a hung worker whose lease expires after deletion is not reclaimed", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		database.deleteDocument(t, ctx, probe)
		database.assertJobStatus(t, ctx, probe, "CANCELLED")

		database.assertNothingClaimable(t, ctx, probe)
		// Model the hung worker's row as if cancellation had not reset it: an
		// expired RUNNING lease must still stay fenced by the tombstone.
		database.exec(t, ctx, `UPDATE ai.media_probe_jobs SET status='RUNNING', lease_id=$2::uuid, lease_until=now()-interval '1 second' WHERE id=$1`, probe.jobID, job.LeaseID)
		database.assertNothingClaimable(t, ctx, probe)
		if active, err := database.store.CheckActive(ctx, job); active || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("CheckActive() = (%t, %v), want (false, ErrJobFenceLost)", active, err)
		}
	})
}

type completeOutcome struct {
	completed bool
	err       error
}

type seededProbe struct {
	documentID, ownerID, jobID, storageRef string
}

func (probe seededProbe) locator() Locator {
	return Locator{Bucket: integrationBucket, Key: probe.storageRef, VersionID: "version-" + probe.jobID, ETag: "etag-" + probe.jobID, ContentLength: 1024}
}

func (database *mediaProbeIntegration) seedProbe(t *testing.T, ctx context.Context) seededProbe {
	t.Helper()
	var probe seededProbe
	if err := database.admin.QueryRow(ctx, `SELECT gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&probe.documentID, &probe.ownerID); err != nil {
		t.Fatalf("create IDs: %v", err)
	}
	probe.storageRef = "media/" + probe.ownerID + "/" + probe.documentID + ".mp4"
	database.exec(t, ctx, `INSERT INTO course.documents(id, owner_id, type, original_name, storage_ref, size_bytes, status) VALUES($1, $2, 'VIDEO', 'source.mp4', $3, 1024, 'PROBING')`, probe.documentID, probe.ownerID, probe.storageRef)
	if err := database.admin.QueryRow(ctx, `
		INSERT INTO ai.media_probe_jobs
		  (document_id, owner_id, correlation_id, probe_generation, policy_version,
		   deletion_fence, full_pipeline_job_id, source_bucket, source_key, status, idempotency_key)
		VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), $3, 0, gen_random_uuid(), $4, $5, 'PENDING', gen_random_uuid()::text)
		RETURNING id::text`, probe.documentID, probe.ownerID, integrationPolicy, integrationBucket, probe.storageRef).Scan(&probe.jobID); err != nil {
		t.Fatalf("insert media probe job: %v", err)
	}
	return probe
}

// claim expects the seeded job: every earlier subtest leaves its rows fenced,
// so any other claimed row means a fence predicate regressed.
func (database *mediaProbeIntegration) claim(t *testing.T, ctx context.Context, probe seededProbe) Job {
	t.Helper()
	job, err := database.store.Claim(ctx)
	if err != nil || job == nil || job.ID != probe.jobID {
		t.Fatalf("Claim() = (%#v, %v), want seeded job %s", job, err, probe.jobID)
	}
	return *job
}

func (database *mediaProbeIntegration) assertNothingClaimable(t *testing.T, ctx context.Context, probe seededProbe) {
	t.Helper()
	job, err := database.store.Claim(ctx)
	if err != nil || job != nil {
		t.Fatalf("Claim() after deletion of %s = (%#v, %v), want (nil, nil)", probe.documentID, job, err)
	}
}

func (database *mediaProbeIntegration) assertJobStatus(t *testing.T, ctx context.Context, probe seededProbe, want string) {
	t.Helper()
	var status string
	if err := database.admin.QueryRow(ctx, `SELECT status FROM ai.media_probe_jobs WHERE id=$1`, probe.jobID).Scan(&status); err != nil {
		t.Fatalf("read media probe job status: %v", err)
	}
	if status != want {
		t.Fatalf("media probe job status = %q, want %q", status, want)
	}
}

func (database *mediaProbeIntegration) deleteDocument(t *testing.T, ctx context.Context, probe seededProbe) {
	t.Helper()
	conn, err := database.admin.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire deletion connection: %v", err)
	}
	defer conn.Release()
	if err := runDeletion(ctx, conn.Conn(), probe); err != nil {
		t.Fatalf("deletion transaction: %v", err)
	}
}

// runDeletion mirrors the AI-facing part of ContentRepository.deleteOwnedDocument
// (app/src/modules/content/repositories/content.repository.ts): advisory lock,
// Document row lock, FOR UPDATE on every media probe job while collecting purge
// locators, fence bump to DELETING, then cancelAiWork's tombstone and job
// cancellation. Course outbox and purge manifest rows are omitted because the
// worker never reads them.
func runDeletion(ctx context.Context, conn *pgx.Conn, probe seededProbe) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	statements := []struct {
		sql  string
		args []any
	}{
		{`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, []any{"media-probe:" + probe.documentID + ":" + probe.ownerID}},
		{`SELECT id FROM course.documents WHERE id=$1 AND owner_id=$2 FOR UPDATE`, []any{probe.documentID, probe.ownerID}},
		{`SELECT source_version_id FROM ai.media_probe_jobs WHERE document_id=$1 AND owner_id=$2 FOR UPDATE`, []any{probe.documentID, probe.ownerID}},
		{`UPDATE course.documents SET deletion_fence=deletion_fence+1, status='DELETING' WHERE id=$1 AND owner_id=$2 AND status<>'DELETING'`, []any{probe.documentID, probe.ownerID}},
		{`INSERT INTO ai.media_probe_cancellation_tombstones (document_id, owner_id, deletion_fence, reason, event_idempotency_key)
		  SELECT id, owner_id, deletion_fence, 'DOCUMENT_DELETED', 'document-cancel:' || id || ':' || deletion_fence || ':MEDIA_PROBE'
		    FROM course.documents WHERE id=$1 AND owner_id=$2
		  ON CONFLICT (document_id, owner_id, deletion_fence) DO NOTHING`, []any{probe.documentID, probe.ownerID}},
		{`UPDATE ai.media_probe_jobs AS job
		     SET status='CANCELLED', lease_id=NULL, lease_until=NULL, updated_at=now()
		    FROM course.documents AS document
		   WHERE document.id=$1 AND document.owner_id=$2
		     AND job.document_id=document.id AND job.owner_id=document.owner_id
		     AND job.deletion_fence<=document.deletion_fence
		     AND job.status IN ('PENDING', 'RUNNING')`, []any{probe.documentID, probe.ownerID}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (database *mediaProbeIntegration) waitForRelationLockWaiter(t *testing.T, ctx context.Context, relation string) {
	t.Helper()
	database.waitFor(t, ctx, "a waiter on "+relation, `
		SELECT EXISTS (
		  SELECT 1 FROM pg_locks
		   WHERE locktype='relation' AND relation=$1::regclass AND NOT granted
		)`, relation)
}

func (database *mediaProbeIntegration) waitForBackendLockWait(t *testing.T, ctx context.Context, pid int) {
	t.Helper()
	database.waitFor(t, ctx, fmt.Sprintf("backend %d to wait on a lock", pid), `
		SELECT EXISTS (
		  SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'
		)`, pid)
}

// waitFor polls an observable lock state with a bounded deadline; it never
// assumes the other transaction progressed after a fixed delay.
func (database *mediaProbeIntegration) waitFor(t *testing.T, ctx context.Context, description, query string, args ...any) {
	t.Helper()
	deadline := time.Now().Add(lockWaitTimeout)
	for time.Now().Before(deadline) {
		var observed bool
		if err := database.admin.QueryRow(ctx, query, args...).Scan(&observed); err != nil {
			t.Fatalf("observe %s: %v", description, err)
		}
		if observed {
			return
		}
		time.Sleep(lockWaitPollDelay)
	}
	t.Fatalf("timed out waiting for %s", description)
}

func (database *mediaProbeIntegration) exec(t *testing.T, ctx context.Context, sql string, args ...any) {
	t.Helper()
	if _, err := database.admin.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec fixture SQL: %v", err)
	}
}

func (database *mediaProbeIntegration) count(t *testing.T, ctx context.Context, sql string, args ...any) int {
	t.Helper()
	var count int
	if err := database.admin.QueryRow(ctx, sql, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

func startMediaProbeIntegration(t *testing.T, ctx context.Context) *mediaProbeIntegration {
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
	defer connection.Close(ctx)
	// Migrations grant to the media-probe role, which the cluster provisions.
	if _, err := connection.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe') THEN
				CREATE ROLE learning_platform_media_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
			END IF;
		END
		$$;
	`); err != nil {
		t.Fatalf("create media-probe database role: %v", err)
	}
	if err := migrations.Run(ctx, connection, migrationDirectory(t)); err != nil {
		t.Fatalf("run tracked migrations: %v", err)
	}
	poolConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatalf("parse store URL: %v", err)
	}
	store, err := NewPostgresStore(ctx, poolConfig)
	if err != nil {
		t.Fatalf("connect media probe store: %v", err)
	}
	return &mediaProbeIntegration{admin: admin, container: container, store: store}
}

func migrationDirectory(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate integration test source")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "app", "src", "database", "migrations")
}
