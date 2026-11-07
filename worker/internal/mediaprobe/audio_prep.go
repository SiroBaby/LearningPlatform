package mediaprobe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

const (
	// DerivedAudioPrefix is the media bucket namespace owned by the system for
	// derived audio. The S3 lifecycle rule and the probe IAM grant target it.
	DerivedAudioPrefix = "derived-audio/"

	// audioChunkBodySec and audioChunkOverlapSec are the ADR-0032 proposals
	// (600 s body, 5 s overlap). Real size is not binding: 32 kbps mono is about
	// 2.4 MB for 610 s, ten times under maxAudioChunkBytes, so they are kept.
	audioChunkBodySec    = processing.DefaultAudioChunkBodySec
	audioChunkOverlapSec = processing.DefaultAudioChunkOverlapSec
	// maxAudioChunkBytes is the STT request limit (25 MiB).
	maxAudioChunkBytes = 25 * 1024 * 1024

	chunkContentType = "audio/mpeg"

	// D10: reject when decoded and metadata durations differ by more than
	// max(durationToleranceFloorSec, durationToleranceRatio * metadata).
	durationToleranceFloorSec = 5.0
	durationToleranceRatio    = 0.02
)

// DerivedAudioReason is a log-safe label for why derived audio failed. It never
// carries a raw storage or ffmpeg message.
type DerivedAudioReason string

const (
	DerivedAudioReasonAccessDenied   DerivedAudioReason = "access_denied"
	DerivedAudioReasonConfiguration  DerivedAudioReason = "configuration"
	DerivedAudioReasonVersionMissing DerivedAudioReason = "version_missing"
	DerivedAudioReasonRejected       DerivedAudioReason = "rejected"
	DerivedAudioReasonPlanMismatch   DerivedAudioReason = "plan_mismatch"
)

// DerivedAudioError is a permanent audio preparation failure with a reason that
// operators can act on (for example a missing PutObject IAM grant).
type DerivedAudioError struct {
	Reason  DerivedAudioReason
	Failure Failure
}

func (failure DerivedAudioError) Error() string { return string(failure.Failure.Code) }

// As lets errors.As(err, *Failure) classify this error like a plain Failure.
func (failure DerivedAudioError) As(target any) bool {
	value, ok := target.(*Failure)
	if !ok {
		return false
	}
	*value = failure.Failure
	return true
}

// PutObjectRequest uploads one local file to an exact bucket and key.
type PutObjectRequest struct {
	Bucket, Key, FilePath, ContentType string
}

// PutObjectResult carries the identity S3 assigned to the uploaded version.
type PutObjectResult struct {
	VersionID, ETag string
	Size            int64
}

// DerivedObjectStore writes derived audio. It deliberately has no delete.
type DerivedObjectStore interface {
	PutDerivedObject(context.Context, PutObjectRequest) (PutObjectResult, error)
}

// AudioChunk is one manifest entry: where the file lives and which part of the
// media timeline it covers. The body is the span the chunk is responsible for;
// the file additionally covers the overlap on both sides. Times are in
// milliseconds from the start of the decoded audio.
type AudioChunk struct {
	Index                                          int
	Bucket, Key, VersionID, ETag, SHA256           string
	SizeBytes                                      int64
	BodyStartMs, BodyEndMs, FileStartMs, FileEndMs int64
}

// DurationMs is the length of the audio file.
func (chunk AudioChunk) DurationMs() int64 { return chunk.FileEndMs - chunk.FileStartMs }

// AudioChunkStore persists the chunk manifest. SaveAudioChunk is the checkpoint
// and the fence: it fails with ErrJobFenceLost once the job lost its lease or
// the Document was deleted, and it returns the row that is actually stored.
type AudioChunkStore interface {
	LoadAudioChunks(context.Context, Job) ([]AudioChunk, error)
	SaveAudioChunk(context.Context, Job, AudioChunk) (AudioChunk, error)
}

// AudioPrep wires the optional audio preparation step into the Worker.
type AudioPrep struct {
	Encoder AudioEncoder
	Objects DerivedObjectStore
	Chunks  AudioChunkStore
}

// PreparedAudio is the outcome of a successful preparation.
type PreparedAudio struct {
	DecodedDurationMs int64
	Chunks            []AudioChunk
}

// ValidateDecodedDuration applies D10: the decoded duration is the billable
// truth, so a container that claims a very different length is rejected.
func ValidateDecodedDuration(metadataSec float64, decodedMs int64) error {
	if decodedMs <= 0 || metadataSec <= 0 || math.IsNaN(metadataSec) || math.IsInf(metadataSec, 0) {
		return Failure{Code: FailureAudioPrep}
	}
	decodedSec := float64(decodedMs) / 1000
	if decodedSec > maxMediaDurationSec {
		return Failure{Code: FailureDurationExceeded}
	}
	tolerance := math.Max(durationToleranceFloorSec, durationToleranceRatio*metadataSec)
	if math.Abs(decodedSec-metadataSec) > tolerance {
		return Failure{Code: FailureDurationMismatch}
	}
	return nil
}

// parseDurationSeconds returns the exact ffprobe duration; policy.go rounds it
// up for the persisted metadata duration.
func parseDurationSeconds(raw string) (float64, error) {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
		return 0, strconv.ErrSyntax
	}
	return seconds, nil
}

// DerivedAudioKey is the deterministic object key of one chunk, so a replay of
// the same probe generation addresses the same key.
func DerivedAudioKey(job Job, index int) string {
	return fmt.Sprintf("%s%s/%s/%s/%04d.mp3", DerivedAudioPrefix, job.OwnerID, job.DocumentID, job.ProbeGeneration, index)
}

// planAudioChunks maps the pure plan onto manifest entries without VersionIds.
func planAudioChunks(job Job, bucket string, decodedMs int64) ([]AudioChunk, error) {
	spans, err := processing.PlanAudioChunks(float64(decodedMs)/1000, audioChunkBodySec, audioChunkOverlapSec)
	if err != nil {
		return nil, Failure{Code: FailureAudioPrep}
	}
	chunks := make([]AudioChunk, 0, len(spans))
	for _, span := range spans {
		chunk := AudioChunk{
			Index:       span.Index,
			Bucket:      bucket,
			Key:         DerivedAudioKey(job, span.Index),
			BodyStartMs: secondsToMs(span.BodyStartSec),
			BodyEndMs:   secondsToMs(span.BodyEndSec),
			FileStartMs: secondsToMs(span.FileStartSec),
			FileEndMs:   secondsToMs(span.FileEndSec),
		}
		if span.Index == len(spans)-1 {
			chunk.BodyEndMs, chunk.FileEndMs = decodedMs, decodedMs
		}
		chunks = append(chunks, chunk)
	}
	return chunks, nil
}

func secondsToMs(seconds float64) int64 { return int64(math.Round(seconds * 1000)) }

// sameChunkPlan reports whether a stored row describes the planned chunk, so a
// replay reuses it instead of uploading again.
func sameChunkPlan(stored, planned AudioChunk) bool {
	return stored.Index == planned.Index && stored.Bucket == planned.Bucket && stored.Key == planned.Key &&
		stored.BodyStartMs == planned.BodyStartMs && stored.BodyEndMs == planned.BodyEndMs &&
		stored.FileStartMs == planned.FileStartMs && stored.FileEndMs == planned.FileEndMs
}

// audioPreparer runs the decode measurement, the chunk plan, and per-chunk
// extract, upload and checkpoint for one claimed job.
type audioPreparer struct {
	prep     AudioPrep
	store    Store
	logger   *slog.Logger
	tempDir  string
	bucketOf func(Job) string
}

// prepare must run inside withActiveFence: operationCtx is cancelled when the
// deletion or lease fence is lost, which also kills the running ffmpeg.
func (preparer audioPreparer) prepare(ctx context.Context, job Job, sourcePath string, metadataSec float64) (PreparedAudio, error) {
	decodedMs, err := preparer.prep.Encoder.MeasureDecodedDuration(ctx, sourcePath)
	if err != nil {
		return PreparedAudio{}, err
	}
	if err := ValidateDecodedDuration(metadataSec, decodedMs); err != nil {
		return PreparedAudio{}, err
	}
	planned, err := planAudioChunks(job, preparer.bucketOf(job), decodedMs)
	if err != nil {
		return PreparedAudio{}, err
	}
	existing, err := preparer.prep.Chunks.LoadAudioChunks(ctx, job)
	if err != nil {
		return PreparedAudio{}, err
	}
	reusable, err := indexReusableChunks(existing, planned)
	if err != nil {
		return PreparedAudio{}, err
	}
	workDir, err := os.MkdirTemp(preparer.tempDir, "audio-prep-*")
	if err != nil {
		return PreparedAudio{}, Failure{Code: FailureMediaProbe, Technical: true}
	}
	defer func() { _ = os.RemoveAll(workDir) }()
	stored := make([]AudioChunk, 0, len(planned))
	for _, chunk := range planned {
		if reused, ok := reusable[chunk.Index]; ok {
			stored = append(stored, reused)
			continue
		}
		saved, err := preparer.produceChunk(ctx, job, sourcePath, workDir, chunk)
		if err != nil {
			return PreparedAudio{}, err
		}
		stored = append(stored, saved)
	}
	return PreparedAudio{DecodedDurationMs: decodedMs, Chunks: stored}, nil
}

// indexReusableChunks matches stored rows to the plan. A stored row that does
// not belong to the plan means the same generation decoded differently, which
// cannot be resolved without deleting rows, so it fails closed.
func indexReusableChunks(existing, planned []AudioChunk) (map[int]AudioChunk, error) {
	plannedByIndex := make(map[int]AudioChunk, len(planned))
	for _, chunk := range planned {
		plannedByIndex[chunk.Index] = chunk
	}
	reusable := make(map[int]AudioChunk, len(existing))
	for _, stored := range existing {
		want, ok := plannedByIndex[stored.Index]
		if !ok || !sameChunkPlan(stored, want) || stored.VersionID == "" {
			return nil, DerivedAudioError{Reason: DerivedAudioReasonPlanMismatch, Failure: Failure{Code: FailureAudioPrep}}
		}
		reusable[stored.Index] = stored
	}
	return reusable, nil
}

func (preparer audioPreparer) produceChunk(ctx context.Context, job Job, sourcePath, workDir string, chunk AudioChunk) (AudioChunk, error) {
	chunkPath := filepath.Join(workDir, fmt.Sprintf("chunk-%04d.mp3", chunk.Index))
	defer func() { _ = os.Remove(chunkPath) }()
	if err := preparer.prep.Encoder.ExtractChunk(ctx, ExtractRequest{
		SourcePath:  sourcePath,
		DestPath:    chunkPath,
		StartSec:    float64(chunk.FileStartMs) / 1000,
		DurationSec: float64(chunk.DurationMs()) / 1000,
		MaxBytes:    maxAudioChunkBytes,
	}); err != nil {
		return AudioChunk{}, err
	}
	digest, size, err := hashFile(chunkPath)
	if err != nil {
		return AudioChunk{}, Failure{Code: FailureAudioPrep}
	}
	// Fence before the only external mutation of this step.
	if active, err := preparer.store.CheckActive(ctx, job); err != nil {
		return AudioChunk{}, err
	} else if !active {
		return AudioChunk{}, ErrJobFenceLost
	}
	put, err := preparer.prep.Objects.PutDerivedObject(ctx, PutObjectRequest{
		Bucket: chunk.Bucket, Key: chunk.Key, FilePath: chunkPath, ContentType: chunkContentType,
	})
	if err != nil {
		return AudioChunk{}, err
	}
	if put.Size != size {
		return AudioChunk{}, Failure{Code: FailureAudioPrep}
	}
	chunk.VersionID, chunk.ETag, chunk.SHA256, chunk.SizeBytes = put.VersionID, put.ETag, digest, size
	// Recording the VersionId right away keeps the purge manifest able to see
	// it; the store re-checks lease and deletion fence in its own transaction.
	return preparer.prep.Chunks.SaveAudioChunk(ctx, job, chunk)
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}

// logAudioPrepFailure emits one safe event; only the code and a fixed reason
// label are logged, never a storage or ffmpeg message.
func logAudioPrepFailure(logger *slog.Logger, job Job, err error) {
	var failure Failure
	if !errors.As(err, &failure) {
		return
	}
	attributes := []any{
		"event", "media_probe_worker.audio_prep.failed",
		"job_id", job.ID, "attempt", job.Attempt, "code", string(failure.Code), "technical", failure.Technical,
	}
	var derived DerivedAudioError
	if errors.As(err, &derived) {
		attributes = append(attributes, "reason", string(derived.Reason))
	}
	logger.Warn("media_probe_worker.audio_prep.failed", attributes...)
}
