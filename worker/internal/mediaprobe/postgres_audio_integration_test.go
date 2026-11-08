package mediaprobe

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// TestPostgresStoreAudioChunksIntegration runs the audio manifest SQL on a real
// PostgreSQL with the tracked migrations: checkpoint idempotency, the deletion
// and lease fences, the Complete manifest guard, and the probe role grants.
func TestPostgresStoreAudioChunksIntegration(t *testing.T) {
	ctx := context.Background()
	database := startMediaProbeIntegration(t, ctx)
	t.Cleanup(func() {
		database.store.Close()
		database.admin.Close()
		if err := database.container.Terminate(ctx); err != nil {
			t.Errorf("terminate PostgreSQL container: %v", err)
		}
	})

	t.Run("a checkpoint is idempotent and survives a reclaim", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		chunk := probe.audioChunk(job, 0)

		first, err := database.store.SaveAudioChunk(ctx, job, chunk)
		if err != nil || first.VersionID != chunk.VersionID {
			t.Fatalf("SaveAudioChunk() = (%#v, %v), want the saved row", first, err)
		}
		replay := chunk
		replay.VersionID = "orphaned-newer-version"
		second, err := database.store.SaveAudioChunk(ctx, job, replay)
		if err != nil || second.VersionID != chunk.VersionID {
			t.Fatalf("replayed SaveAudioChunk() = (%#v, %v), want the first row kept", second, err)
		}
		loaded, err := database.store.LoadAudioChunks(ctx, job)
		if err != nil || len(loaded) != 1 || loaded[0] != chunk {
			t.Fatalf("LoadAudioChunks() = (%#v, %v), want exactly the first chunk", loaded, err)
		}
	})

	t.Run("deletion before the checkpoint fences the save and writes no row", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		database.deleteDocument(t, ctx, probe)

		_, err := database.store.SaveAudioChunk(ctx, job, probe.audioChunk(job, 0))

		if !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("SaveAudioChunk() error = %v, want ErrJobFenceLost", err)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.media_audio_chunks WHERE media_probe_job_id=$1`, job.ID); count != 0 {
			t.Fatalf("media_audio_chunks rows = %d, want 0 after a fenced save", count)
		}
	})

	t.Run("a checkpoint committed before deletion is visible to the purge snapshot", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		chunk := probe.audioChunk(job, 0)
		if _, err := database.store.SaveAudioChunk(ctx, job, chunk); err != nil {
			t.Fatalf("SaveAudioChunk() error = %v", err)
		}

		database.deleteDocument(t, ctx, probe)

		// The query the purge manifest uses to collect derived-audio locators.
		var versionID string
		if err := database.admin.QueryRow(ctx, `
			SELECT "version_id" FROM "ai"."media_audio_chunks"
			 WHERE "document_id" = $1 AND "owner_id" = $2 AND "bucket" = $3`,
			probe.documentID, probe.ownerID, integrationBucket).Scan(&versionID); err != nil || versionID != chunk.VersionID {
			t.Fatalf("purge snapshot = (%q, %v), want the exact VersionId %q", versionID, err, chunk.VersionID)
		}
	})

	t.Run("an expired lease cannot save", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		database.exec(t, ctx, `UPDATE ai.media_probe_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, probe.jobID)

		_, err := database.store.SaveAudioChunk(ctx, job, probe.audioChunk(job, 0))

		// An expired RUNNING lease is claimable; retire it so later subtests claim their own job.
		database.exec(t, ctx, `UPDATE ai.media_probe_jobs SET status = 'CANCELLED', lease_id = NULL, lease_until = NULL WHERE id = $1`, probe.jobID)
		if !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("SaveAudioChunk() error = %v, want ErrJobFenceLost", err)
		}
	})

	t.Run("a job reclaimed after lease expiry fences the old lease and completes once under the new one", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		oldJob := database.claim(t, ctx, probe)
		locator := probe.locator()
		if persisted, err := database.store.PersistLocator(ctx, oldJob, locator); err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v)", persisted, err)
		}
		chunk := probe.audioChunk(oldJob, 0)
		if _, err := database.store.SaveAudioChunk(ctx, oldJob, chunk); err != nil {
			t.Fatalf("SaveAudioChunk() under the first lease error = %v", err)
		}
		database.exec(t, ctx, `UPDATE ai.media_probe_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, probe.jobID)

		newJob := database.claim(t, ctx, probe)

		if newJob.LeaseID == oldJob.LeaseID || newJob.Attempt != oldJob.Attempt+1 {
			t.Fatalf("reclaimed lease/attempt = (%s, %d), want a new lease and attempt %d", newJob.LeaseID, newJob.Attempt, oldJob.Attempt+1)
		}
		if _, err := database.store.SaveAudioChunk(ctx, oldJob, probe.audioChunk(oldJob, 1)); !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("SaveAudioChunk() with the old lease error = %v, want ErrJobFenceLost", err)
		}
		result := ProbeResult{DurationSec: 600, Locator: locator, DecodedDurationMs: 600000, AudioChunkCount: 1}
		if completed, err := database.store.Complete(ctx, oldJob, result); completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("Complete() with the old lease = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.media_probe_results WHERE media_probe_job_id=$1`, probe.jobID); count != 0 {
			t.Fatalf("media_probe_results rows = %d, want 0 after the fenced Complete", count)
		}
		loaded, err := database.store.LoadAudioChunks(ctx, newJob)
		if err != nil || len(loaded) != 1 || loaded[0] != chunk {
			t.Fatalf("LoadAudioChunks() under the new lease = (%#v, %v), want chunk 0 only", loaded, err)
		}
		if completed, err := database.store.Complete(ctx, newJob, result); !completed || err != nil {
			t.Fatalf("Complete() with the new lease = (%t, %v), want (true, nil)", completed, err)
		}
		if completed, err := database.store.Complete(ctx, newJob, result); completed || !errors.Is(err, ErrJobFenceLost) {
			t.Fatalf("second Complete() = (%t, %v), want (false, ErrJobFenceLost)", completed, err)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProbeCompleted'`, probe.jobID); count != 1 {
			t.Fatalf("DocumentProbeCompleted outbox rows = %d, want exactly 1", count)
		}
	})

	t.Run("Complete records the decoded duration and publishes the manifest size", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		locator := probe.locator()
		if persisted, err := database.store.PersistLocator(ctx, job, locator); err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v)", persisted, err)
		}
		for index := 0; index < 2; index++ {
			if _, err := database.store.SaveAudioChunk(ctx, job, probe.audioChunk(job, index)); err != nil {
				t.Fatalf("SaveAudioChunk(%d) error = %v", index, err)
			}
		}

		completed, err := database.store.Complete(ctx, job, ProbeResult{DurationSec: 700, Locator: locator, DecodedDurationMs: 698500, AudioChunkCount: 2})

		if !completed || err != nil {
			t.Fatalf("Complete() = (%t, %v), want (true, nil)", completed, err)
		}
		var decoded *int
		if err := database.admin.QueryRow(ctx, `SELECT decoded_duration_ms FROM ai.media_probe_results WHERE media_probe_job_id=$1`, job.ID).Scan(&decoded); err != nil || decoded == nil || *decoded != 698500 {
			t.Fatalf("decoded_duration_ms = (%v, %v), want 698500", decoded, err)
		}
		var encoded []byte
		if err := database.admin.QueryRow(ctx, `SELECT payload FROM ai.outbox WHERE aggregate_id=$1 AND event_type='DocumentProbeCompleted'`, job.ID).Scan(&encoded); err != nil {
			t.Fatalf("read outbox: %v", err)
		}
		var payload struct {
			DurationSec       int `json:"durationSec"`
			DecodedDurationMs int `json:"decodedDurationMs"`
			AudioChunkCount   int `json:"audioChunkCount"`
		}
		if err := json.Unmarshal(encoded, &payload); err != nil || payload.DurationSec != 700 || payload.DecodedDurationMs != 698500 || payload.AudioChunkCount != 2 {
			t.Fatalf("payload = (%#v, %v), want durationSec 700, decodedDurationMs 698500, audioChunkCount 2", payload, err)
		}
	})

	t.Run("Complete refuses a manifest that is not fully recorded", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		locator := probe.locator()
		if persisted, err := database.store.PersistLocator(ctx, job, locator); err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v)", persisted, err)
		}
		if _, err := database.store.SaveAudioChunk(ctx, job, probe.audioChunk(job, 0)); err != nil {
			t.Fatalf("SaveAudioChunk() error = %v", err)
		}

		completed, err := database.store.Complete(ctx, job, ProbeResult{DurationSec: 700, Locator: locator, DecodedDurationMs: 698500, AudioChunkCount: 2})

		var failure Failure
		if completed || !errors.As(err, &failure) || failure.Code != FailureAudioPrep {
			t.Fatalf("Complete() = (%t, %v), want (false, MEDIA_AUDIO_PREP_FAILED)", completed, err)
		}
		if count := database.count(t, ctx, `SELECT count(*) FROM ai.media_probe_results WHERE media_probe_job_id=$1`, job.ID); count != 0 {
			t.Fatalf("media_probe_results rows = %d, want 0", count)
		}
	})

	t.Run("Complete without audio preparation leaves the decoded duration NULL", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		locator := probe.locator()
		if persisted, err := database.store.PersistLocator(ctx, job, locator); err != nil || !persisted {
			t.Fatalf("PersistLocator() = (%t, %v)", persisted, err)
		}

		if completed, err := database.store.Complete(ctx, job, ProbeResult{DurationSec: 42, Locator: locator}); !completed || err != nil {
			t.Fatalf("Complete() = (%t, %v), want (true, nil)", completed, err)
		}
		var isNull bool
		if err := database.admin.QueryRow(ctx, `SELECT decoded_duration_ms IS NULL FROM ai.media_probe_results WHERE media_probe_job_id=$1`, job.ID).Scan(&isNull); err != nil || !isNull {
			t.Fatalf("decoded_duration_ms IS NULL = (%t, %v), want true", isNull, err)
		}
	})

	t.Run("the probe role can append manifest rows but not change or delete them", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		chunk := probe.audioChunk(job, 0)
		connection, err := database.admin.Acquire(ctx)
		if err != nil {
			t.Fatalf("acquire connection: %v", err)
		}
		defer connection.Release()
		if _, err := connection.Exec(ctx, `SET ROLE learning_platform_media_probe`); err != nil {
			t.Fatalf("SET ROLE: %v", err)
		}
		defer connection.Exec(ctx, `RESET ROLE`)

		if _, err := connection.Exec(ctx, `
			INSERT INTO "ai"."media_audio_chunks"
			  ("media_probe_job_id", "document_id", "owner_id", "probe_generation", "deletion_fence",
			   "chunk_index", "bucket", "object_key", "version_id", "etag", "sha256", "content_length",
			   "body_start_ms", "body_end_ms", "file_start_ms", "file_end_ms")
			VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, $9, $10, 0, 1000, 0, 1000)`,
			job.ID, job.DocumentID, job.OwnerID, job.ProbeGeneration, chunk.Bucket, chunk.Key, chunk.VersionID, chunk.ETag, chunk.SHA256, chunk.SizeBytes); err != nil {
			t.Fatalf("probe role INSERT error = %v, want granted", err)
		}
		if _, err := connection.Exec(ctx, `SELECT "version_id" FROM "ai"."media_audio_chunks" WHERE "media_probe_job_id" = $1`, job.ID); err != nil {
			t.Fatalf("probe role SELECT error = %v, want granted", err)
		}
		for _, statement := range []string{
			`UPDATE "ai"."media_audio_chunks" SET "version_id" = 'x'`,
			`DELETE FROM "ai"."media_audio_chunks"`,
		} {
			if _, err := connection.Exec(ctx, statement); err == nil || !strings.Contains(err.Error(), "permission denied") {
				t.Fatalf("probe role %q error = %v, want permission denied", statement, err)
			}
		}
	})

	t.Run("deleting the probe job removes its manifest", func(t *testing.T) {
		probe := database.seedProbe(t, ctx)
		job := database.claim(t, ctx, probe)
		if _, err := database.store.SaveAudioChunk(ctx, job, probe.audioChunk(job, 0)); err != nil {
			t.Fatalf("SaveAudioChunk() error = %v", err)
		}

		database.exec(t, ctx, `DELETE FROM ai.media_probe_jobs WHERE id=$1`, probe.jobID)

		if count := database.count(t, ctx, `SELECT count(*) FROM ai.media_audio_chunks WHERE media_probe_job_id=$1`, probe.jobID); count != 0 {
			t.Fatalf("media_audio_chunks rows = %d, want 0 after the job was deleted", count)
		}
	})
}

func (probe seededProbe) audioChunk(job Job, index int) AudioChunk {
	return AudioChunk{
		Index: index, Bucket: integrationBucket,
		Key:       DerivedAudioKey(job, index),
		VersionID: "chunk-version-" + probe.jobID, ETag: "chunk-etag", SHA256: strings.Repeat("ab", 32), SizeBytes: 2048,
		BodyStartMs: int64(index) * 600000, BodyEndMs: int64(index+1) * 600000,
		FileStartMs: max(0, int64(index)*600000-5000), FileEndMs: int64(index+1)*600000 + 5000,
	}
}
