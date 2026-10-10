package mediaprobe

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

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
