package mediaprobe

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net"
	"os"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPersistLocatorWaitsForDeletionFence(t *testing.T) {
	databaseURL := os.Getenv("MEDIA_PROBE_TEST_DATABASE_URL")
	jobID := os.Getenv("MEDIA_PROBE_TEST_JOB_ID")
	if databaseURL == "" || jobID == "" {
		t.Skip("requires a migrated PostgreSQL media-probe fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var job Job
	err = pool.QueryRow(ctx, `
		SELECT "id"::text, "document_id"::text, "owner_id"::text,
		       "correlation_id"::text, "probe_generation"::text, "policy_version",
		       "source_bucket", "source_key", "full_pipeline_job_id"::text,
		       "deletion_fence", "attempts", "lease_id"::text
		  FROM "ai"."media_probe_jobs" WHERE "id" = $1`, jobID).Scan(
		&job.ID, &job.DocumentID, &job.OwnerID, &job.CorrelationID,
		&job.ProbeGeneration, &job.PolicyVersion, &job.SourceBucket, &job.SourceKey,
		&job.FullPipelineJobID, &job.DeletionFence, &job.Attempt, &job.LeaseID,
	)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := (&PostgresStore{pool: pool}).PersistLocator(ctx, job, Locator{
		Bucket: job.SourceBucket, Key: job.SourceKey, VersionID: "late-version",
		ETag: "late-etag", ContentLength: 1024,
	})
	if persisted || !errors.Is(err, ErrJobFenceLost) {
		t.Fatalf("PersistLocator() = (%v, %v), want (false, ErrJobFenceLost)", persisted, err)
	}
}

func TestScanJobAcceptsNullableSourceLocatorOnFirstClaim(t *testing.T) {
	createdAt := time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)
	job, err := scanJob(fakeRow{values: []any{
		"job-id", "document-id", "owner-id", "correlation-id", "generation", "media-v1",
		"media", "owners/video.mp4", "pipeline-id", int64(0), 1, "lease-id", createdAt,
		nil, nil, nil,
	}})
	if err != nil {
		t.Fatalf("scanJob() error = %v", err)
	}
	if job.Locator != nil {
		t.Fatalf("first claim locator = %#v, want nil", job.Locator)
	}
	if job.ID != "job-id" || job.Attempt != 1 || job.LeaseID != "lease-id" {
		t.Fatalf("job = %#v", job)
	}
}

func TestProbeFailurePayloadIncludesOnlyCapturedLocatorWithMatchingFence(t *testing.T) {
	job := Job{
		ID: "job-id", DocumentID: "document-id", OwnerID: "owner-id",
		ProbeGeneration: "generation-id", PolicyVersion: "media-v1",
		SourceBucket: "media", SourceKey: "owners/video.mp4", DeletionFence: 7,
		Attempt: 3, LeaseID: "lease-id",
		Locator: &Locator{
			Bucket: "media", Key: "owners/video.mp4", VersionID: "version-1",
			ETag: "etag-1", ContentLength: 42,
		},
	}
	payload := probeFailurePayload(job, Failure{Code: FailureMediaProbeStorageTemporary})
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if decoded["errorCode"] != string(FailureMediaProbeStorageTemporary) || decoded["errorMessage"] != nil {
		t.Fatalf("failure payload code/message = %v/%v", decoded["errorCode"], decoded["errorMessage"])
	}
	locator, ok := decoded["locator"].(map[string]any)
	if !ok {
		t.Fatalf("locator = %T, want object", decoded["locator"])
	}
	if locator["bucket"] != job.SourceBucket || locator["key"] != job.SourceKey ||
		locator["versionId"] != "version-1" || locator["etag"] != "etag-1" ||
		locator["contentLength"] != float64(42) || locator["policyVersion"] != job.PolicyVersion ||
		locator["deletionFence"] != float64(job.DeletionFence) {
		t.Fatalf("locator payload = %#v", locator)
	}

	job.Locator.Key = "other/key"
	if _, ok := probeFailurePayload(job, Failure{Code: FailureMediaProbe})["locator"]; ok {
		t.Fatal("failure payload included a locator that does not match the job source")
	}
	job.Locator = nil
	if _, ok := probeFailurePayload(job, Failure{Code: FailureMediaProbe})["locator"]; ok {
		t.Fatal("failure payload included a missing captured locator")
	}
}

func TestScanJobBuildsLocatorWhenAllFieldsArePresent(t *testing.T) {
	contentLength := int64(42)
	job, err := scanJob(fakeRow{values: []any{
		"job-id", "document-id", "owner-id", "correlation-id", "generation", "media-v1",
		"media", "owners/video.mp4", "pipeline-id", int64(0), 2, "lease-id", time.Time{},
		"version-1", "etag-1", &contentLength,
	}})
	if err != nil {
		t.Fatalf("scanJob() error = %v", err)
	}
	if job.Locator == nil || job.Locator.VersionID != "version-1" || job.Locator.ETag != "etag-1" || job.Locator.ContentLength != contentLength {
		t.Fatalf("locator = %#v", job.Locator)
	}
}

type fakeRow struct {
	values []any
}

func (row fakeRow) Scan(dest ...any) error {
	if len(dest) != len(row.values) {
		panic("fakeRow destination count mismatch")
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *string:
			*target = value.(string)
		case **string:
			if value != nil {
				stringValue := value.(string)
				*target = &stringValue
			}
		case *int64:
			*target = value.(int64)
		case **int64:
			if value != nil {
				*target = value.(*int64)
			}
		case *int:
			*target = value.(int)
		case *time.Time:
			*target = value.(time.Time)
		default:
			panic("fakeRow destination type is not covered")
		}
	}
	return nil
}

type fakePingClock struct {
	current time.Time
	sleeps  []time.Duration
}

func (clock *fakePingClock) retryClock() pingRetryClock {
	return pingRetryClock{
		now: func() time.Time { return clock.current },
		sleep: func(ctx context.Context, delay time.Duration) error {
			clock.sleeps = append(clock.sleeps, delay)
			clock.current = clock.current.Add(delay)
			return ctx.Err()
		},
	}
}

func scriptedPing(results ...error) (func(context.Context) error, *int) {
	calls := 0
	return func(context.Context) error {
		result := results[min(calls, len(results)-1)]
		calls++
		return result
	}, &calls
}

var errRefused = &net.OpError{Op: "dial", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}

func TestPingWithRetrySucceedsAfterTransientRefusals(t *testing.T) {
	mockPing, actualCalls := scriptedPing(errRefused, errRefused, nil)
	mockClock := &fakePingClock{}
	err := pingWithRetry(context.Background(), mockPing, defaultPingRetry, mockClock.retryClock())
	if err != nil {
		t.Fatalf("pingWithRetry() error = %v", err)
	}
	expectedSleeps := []time.Duration{500 * time.Millisecond, time.Second}
	if *actualCalls != 3 || !slices.Equal(mockClock.sleeps, expectedSleeps) {
		t.Fatalf("calls = %d sleeps = %v, want 3 calls and %v", *actualCalls, mockClock.sleeps, expectedSleeps)
	}
}

func TestPingWithRetryFailsFastOnNonTransientErrors(t *testing.T) {
	cases := []struct {
		name     string
		input    error
		expected DatabaseStage
	}{
		{"wrong password", &pgconn.PgError{Code: "28P01"}, DatabaseStageAuth},
		{"unknown database", &pgconn.PgError{Code: "3D000"}, DatabaseStageServer},
		{"missing privilege", &pgconn.PgError{Code: "42501"}, DatabaseStageServer},
		{"untrusted certificate", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, DatabaseStageTLSVerify},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			mockPing, actualCalls := scriptedPing(testCase.input, nil)
			mockClock := &fakePingClock{}
			err := pingWithRetry(context.Background(), mockPing, defaultPingRetry, mockClock.retryClock())
			var actual DatabaseConnectError
			if !errors.As(err, &actual) || actual.Stage != testCase.expected || actual.Attempts != 1 {
				t.Fatalf("pingWithRetry() = %#v, want stage %s after 1 attempt", err, testCase.expected)
			}
			if *actualCalls != 1 || len(mockClock.sleeps) != 0 {
				t.Fatalf("calls = %d sleeps = %v, want a single attempt without backoff", *actualCalls, mockClock.sleeps)
			}
		})
	}
}

func TestPingWithRetryStopsWithinTotalBudget(t *testing.T) {
	mockPing, actualCalls := scriptedPing(errRefused)
	mockClock := &fakePingClock{}
	err := pingWithRetry(context.Background(), mockPing, defaultPingRetry, mockClock.retryClock())
	var actual DatabaseConnectError
	if !errors.As(err, &actual) || actual.Stage != DatabaseStageConnectRefused || actual.Attempts != *actualCalls {
		t.Fatalf("pingWithRetry() = %#v, want connect_refused with attempts = calls (%d)", err, *actualCalls)
	}
	var actualElapsed time.Duration
	for _, delay := range mockClock.sleeps {
		actualElapsed += delay
		if delay > defaultPingRetry.MaxDelay {
			t.Fatalf("delay %v exceeds max %v", delay, defaultPingRetry.MaxDelay)
		}
	}
	if actualElapsed > defaultPingRetry.MaxElapsed || *actualCalls < 3 {
		t.Fatalf("elapsed = %v over %d calls, want several attempts within %v", actualElapsed, *actualCalls, defaultPingRetry.MaxElapsed)
	}
}

func TestPingWithRetryStopsWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	mockPing := func(context.Context) error {
		calls++
		cancel()
		return errRefused
	}
	err := pingWithRetry(ctx, mockPing, defaultPingRetry, (&fakePingClock{}).retryClock())
	var actual DatabaseConnectError
	if !errors.As(err, &actual) || actual.Stage != DatabaseStageCanceled || calls != 1 {
		t.Fatalf("pingWithRetry() = %#v after %d calls, want canceled after 1 call", err, calls)
	}
}

func TestNewPostgresStoreFailsFastOnAuthenticationWithoutLeakingSettings(t *testing.T) {
	address := startFakeServer(t, rejectStartup("28P01"))
	poolConfig, err := pgxpool.ParseConfig("postgres://" + fakeServerSecret + ":" + fakeServerSecret + "@" + address + "/media?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	started := time.Now()
	store, err := NewPostgresStore(ctx, poolConfig)
	if store != nil {
		store.Close()
	}
	var actual DatabaseConnectError
	if !errors.As(err, &actual) || actual.Stage != DatabaseStageAuth || actual.SQLState != "28P01" || actual.Attempts != 1 {
		t.Fatalf("NewPostgresStore() = %#v, want auth 28P01 after 1 attempt", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("NewPostgresStore() took %v, want an immediate failure", elapsed)
	}
	if strings.Contains(err.Error(), fakeServerSecret) || strings.Contains(err.Error(), address) {
		t.Fatalf("Error() leaks connection settings: %q", err.Error())
	}
	if poolConfig.ConnConfig.ConnectTimeout != databaseConnectTimeout {
		t.Fatalf("ConnectTimeout = %v, want %v", poolConfig.ConnConfig.ConnectTimeout, databaseConnectTimeout)
	}
}
