package mediaprobe

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrJobFenceLost means the job was cancelled, reclaimed, or superseded while
// the worker was doing I/O. The worker must discard the result in this case.
var ErrJobFenceLost = errors.New("media probe job fence lost")

type FailureCode string

const (
	FailureMediaProbe                  FailureCode = "MEDIA_PROBE_FAILED"
	FailureMediaProbeStorageTemporary  FailureCode = "MEDIA_PROBE_STORAGE_TEMPORARY"
	FailureMediaProbeTimeout           FailureCode = "MEDIA_PROBE_TIMEOUT"
	FailureMediaProbeOutputCapExceeded FailureCode = "MEDIA_PROBE_OUTPUT_CAP_EXCEEDED"
	FailureUnsupportedContainer        FailureCode = "MEDIA_UNSUPPORTED_CONTAINER"
	FailureUnsupportedVideoCodec       FailureCode = "MEDIA_UNSUPPORTED_VIDEO_CODEC"
	FailureUnsupportedAudioCodec       FailureCode = "MEDIA_UNSUPPORTED_AUDIO_CODEC"
	FailureAudioTrackRequired          FailureCode = "MEDIA_AUDIO_TRACK_REQUIRED"
	FailureObjectTooLarge              FailureCode = "MEDIA_OBJECT_TOO_LARGE"
)

type Failure struct {
	Code      FailureCode
	Technical bool
}

func (failure Failure) Error() string { return string(failure.Code) }

type PersistenceError struct {
	Err error
}

func (failure PersistenceError) Error() string { return string(FailureMediaProbe) }
func (failure PersistenceError) Unwrap() error { return failure.Err }
func (failure PersistenceError) As(target any) bool {
	value, ok := target.(*Failure)
	if !ok {
		return false
	}
	*value = Failure{Code: FailureMediaProbe, Technical: true}
	return true
}

type Job struct {
	ID, DocumentID, OwnerID, CorrelationID string
	ProbeGeneration, PolicyVersion         string
	SourceBucket, SourceKey                string
	FullPipelineJobID                      string
	DeletionFence                          int64
	Attempt                                int
	LeaseID                                string
	CreatedAt                              time.Time
	Locator                                *Locator
}

type Locator struct {
	Bucket        string
	Key           string
	VersionID     string
	ETag          string
	ContentLength int64
}

type ProbeResult struct {
	DurationSec int
	Locator     Locator
}

type ObjectStore interface {
	Head(context.Context, string, string) (Locator, error)
	OpenVersion(context.Context, Locator) (io.ReadCloser, error)
}

type Store interface {
	Claim(context.Context) (*Job, error)
	CheckActive(context.Context, Job) (bool, error)
	PersistLocator(context.Context, Job, Locator) (bool, error)
	Complete(context.Context, Job, ProbeResult) (bool, error)
	Fail(context.Context, Job, Failure) (bool, error)
	Retry(context.Context, Job, FailureCode) (RetryResult, error)
}

type RetryResult struct {
	Scheduled bool
	Finalized bool
}

type Runner interface {
	Run(context.Context, string) (Metadata, error)
}

type Metadata struct {
	Format  FormatMetadata
	Streams []StreamMetadata
}

type FormatMetadata struct {
	Name     string
	Duration string
	Tags     map[string]string
}

type StreamMetadata struct {
	CodecType   string
	CodecName   string
	Profile     string
	PixelFormat string
	CodedWidth  int
	CodedHeight int
	AverageRate string
	Channels    int
	IsDefault   bool
	Tags        map[string]string
	Disposition map[string]int
}
