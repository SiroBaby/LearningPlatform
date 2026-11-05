package processing

import (
	"context"
	"errors"
	"io"
)

// TranscriptSegment is one timed span of speech. Times are seconds relative to
// the audio the Transcriber received; StitchTranscript converts them to
// absolute media time.
type TranscriptSegment struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	Text     string  `json:"text"`
}

// TranscribeRequest is one bounded speech-to-text call for a single audio chunk.
type TranscribeRequest struct {
	ChunkIndex int
	// Language is an optional ISO-639 hint such as "vi".
	Language string
	Audio    io.Reader
}

// Transcriber converts one audio chunk into timed segments. Implementations
// must not retry or fall back internally; the caller owns retry policy.
type Transcriber interface {
	Transcribe(context.Context, TranscribeRequest) ([]TranscriptSegment, error)
}

// ErrFakeTranscriptMissing reports that FakeTranscriber has no canned result
// for the requested chunk.
var ErrFakeTranscriptMissing = errors.New("fake transcript missing for chunk")

// FakeTranscriber is a deterministic offline Transcriber: it returns the canned
// segments registered for a chunk index and never reads Audio.
type FakeTranscriber struct {
	Results map[int][]TranscriptSegment
	// Err, when set, is returned for every call.
	Err error
}

func (fake FakeTranscriber) Transcribe(ctx context.Context, request TranscribeRequest) ([]TranscriptSegment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if fake.Err != nil {
		return nil, fake.Err
	}
	segments, ok := fake.Results[request.ChunkIndex]
	if !ok {
		return nil, ErrFakeTranscriptMissing
	}
	return append([]TranscriptSegment(nil), segments...), nil
}
