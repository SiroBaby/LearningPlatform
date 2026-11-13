package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	// MaxSubtitleCues and MaxSubtitleRunes mirror the Node parser caps; the worker re-validates the snapshot so a
	// corrupted row can never reach chunking or a paid provider call.
	MaxSubtitleCues  = 10_000
	MaxSubtitleRunes = 500_000
	// maxSubtitleSnapshotBytes bounds the JSON read from PostgreSQL (500k runes of text plus per-cue framing).
	maxSubtitleSnapshotBytes = 8 << 20
	// maxSubtitleEndMs is the 24 hour duration cap of the Node parser.
	maxSubtitleEndMs int64 = 24 * 60 * 60 * 1000
)

// SubtitleTranscriptStore is an optional Store capability: it returns the Owner-confirmed subtitle transcript of a
// YOUTUBE Document as time segments. A Store without it makes YOUTUBE Documents fail with ObjectNotFound.
type SubtitleTranscriptStore interface {
	SubtitleSegments(ctx context.Context, job Job) ([]TranscriptSegment, error)
}

// subtitleCue is one element of the `cues` JSON written by the Node parser.
type subtitleCue struct {
	StartMs int64  `json:"startMs"`
	EndMs   int64  `json:"endMs"`
	Text    string `json:"text"`
}

// DecodeSubtitleCues validates and converts a stored `cues` JSON array into transcript segments. A snapshot that
// breaks an invariant is a non-technical ProcessingFailed (retrying cannot repair it); an empty one is
// MediaTranscriptEmpty.
func DecodeSubtitleCues(raw []byte) ([]TranscriptSegment, error) {
	if len(raw) == 0 || len(raw) > maxSubtitleSnapshotBytes {
		return nil, Failure{Code: ProcessingFailed}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cues []subtitleCue
	if err := decoder.Decode(&cues); err != nil || decoder.More() {
		return nil, Failure{Code: ProcessingFailed}
	}
	if len(cues) == 0 {
		return nil, Failure{Code: MediaTranscriptEmpty}
	}
	if len(cues) > MaxSubtitleCues {
		return nil, Failure{Code: ProcessingFailed}
	}
	segments := make([]TranscriptSegment, 0, len(cues))
	runes := 0
	var previousStartMs int64
	for _, cue := range cues {
		if cue.StartMs < 0 || cue.EndMs <= cue.StartMs || cue.EndMs > maxSubtitleEndMs || cue.StartMs < previousStartMs || !utf8.ValidString(cue.Text) || containsForbiddenControl(cue.Text) {
			return nil, Failure{Code: ProcessingFailed}
		}
		text := normalizeExtractedText(cue.Text)
		if text == "" {
			return nil, Failure{Code: ProcessingFailed}
		}
		runes += utf8.RuneCountInString(cue.Text)
		if runes > MaxSubtitleRunes {
			return nil, Failure{Code: ProcessingFailed}
		}
		previousStartMs = cue.StartMs
		segments = append(segments, TranscriptSegment{
			StartSec: roundMillis(float64(cue.StartMs) / millisecondsPerSecond),
			EndSec:   roundMillis(float64(cue.EndMs) / millisecondsPerSecond),
			Text:     cue.Text,
		})
	}
	return segments, nil
}

// containsForbiddenControl reports C0, DEL and C1 controls other than tab, LF and CR, which the Node parser rejects.
func containsForbiddenControl(text string) bool {
	for _, character := range text {
		if unicode.IsControl(character) && character != '\t' && character != '\n' && character != '\r' {
			return true
		}
	}
	return false
}

// SubtitleSegments reads the confirmed subtitle snapshot of the job's Document. The query repeats the identity and
// fence predicates of Source and additionally requires the Owner's rights confirmation, so an unconfirmed or stale
// snapshot is indistinguishable from a missing one (ObjectNotFound).
func (store *PostgresStore) SubtitleSegments(ctx context.Context, job Job) ([]TranscriptSegment, error) {
	var raw []byte
	err := store.pool.QueryRow(ctx, `
		SELECT transcript.cues::text
		  FROM course.documents AS document
		  JOIN ai.processing_jobs AS pipeline
		    ON pipeline.id = $3
		   AND pipeline.document_id = document.id
		   AND pipeline.owner_id = document.owner_id
		   AND pipeline.job_type IN ('FULL_PIPELINE','TEXT_EXTRACT')
		  JOIN course.document_subtitle_transcripts AS transcript
		    ON transcript.document_id = document.id
		   AND transcript.owner_id = document.owner_id
		 WHERE document.id = $1 AND document.owner_id = $2
		   AND document.status = 'PROCESSING' AND document.type = 'YOUTUBE'
		   AND transcript.rights_confirmed_at IS NOT NULL`, job.DocumentID, job.OwnerID, job.ID).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, Failure{Code: ObjectNotFound}
		}
		return nil, NewPersistenceError(FailureOperationSourceDescriptorRead, err)
	}
	return DecodeSubtitleCues(raw)
}
