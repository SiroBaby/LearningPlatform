package processing

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

const (
	// DefaultAudioChunkBodySec is the non-overlapping span each audio chunk owns.
	DefaultAudioChunkBodySec = 600.0
	// DefaultAudioChunkOverlapSec is the extra audio cut on each side of a body.
	DefaultAudioChunkOverlapSec = 5.0
	// transcriptDurationToleranceSec absorbs provider timestamp drift past the
	// decoded duration before a segment is treated as invalid.
	transcriptDurationToleranceSec = 1.0
	// transcriptOrderToleranceSec is how far a segment may start before the
	// previous one (across chunks) before the provider data is rejected.
	transcriptOrderToleranceSec = 1.0
	transcriptPrecision         = 1000.0
	// MaxTranscribableDurationSec mirrors the media policy maximum (mediaprobe
	// maxMediaDurationSec); longer plans are rejected, not chunked.
	MaxTranscribableDurationSec = 7200.0
	// MinAudioChunkBodySec and maxAudioChunks bound the plan size.
	MinAudioChunkBodySec = 1.0
	maxAudioChunks       = 1000
)

// ErrInvalidTranscript marks provider output that cannot be mapped to the
// media timeline (negative, reversed, non-finite or far beyond the duration).
var ErrInvalidTranscript = errors.New("invalid transcript")

// ErrInvalidAudioPlan marks unusable duration/body/overlap inputs.
var ErrInvalidAudioPlan = errors.New("invalid audio chunk plan")

// AudioChunkSpan describes one audio chunk. The body is the span this chunk is
// responsible for; the file additionally covers the overlap on both sides.
type AudioChunkSpan struct {
	Index        int     `json:"index"`
	BodyStartSec float64 `json:"bodyStartSec"`
	BodyEndSec   float64 `json:"bodyEndSec"`
	FileStartSec float64 `json:"fileStartSec"`
	FileEndSec   float64 `json:"fileEndSec"`
}

// AudioChunkResult carries the segments one chunk returned, with times relative
// to that chunk's file start.
type AudioChunkResult struct {
	Index    int                 `json:"index"`
	Segments []TranscriptSegment `json:"segments"`
}

// PlanAudioChunks splits durationSec into bodies of bodySec. A trailing body
// shorter than 2*overlapSec is merged into the previous chunk so no chunk is
// too short to transcribe reliably.
func PlanAudioChunks(durationSec, bodySec, overlapSec float64) ([]AudioChunkSpan, error) {
	if !isFinitePositive(durationSec) || durationSec > MaxTranscribableDurationSec || !isFinite(bodySec) || bodySec < MinAudioChunkBodySec || !isFinite(overlapSec) || overlapSec < 0 || overlapSec*2 >= bodySec {
		return nil, ErrInvalidAudioPlan
	}
	count := int(math.Ceil(durationSec / bodySec))
	if count > maxAudioChunks {
		return nil, ErrInvalidAudioPlan
	}
	if count > 1 && durationSec-float64(count-1)*bodySec < 2*overlapSec {
		count--
	}
	spans := make([]AudioChunkSpan, 0, count)
	for index := 0; index < count; index++ {
		bodyStart := float64(index) * bodySec
		bodyEnd := bodyStart + bodySec
		if index == count-1 {
			bodyEnd = durationSec
		}
		spans = append(spans, AudioChunkSpan{
			Index:        index,
			BodyStartSec: bodyStart,
			BodyEndSec:   bodyEnd,
			FileStartSec: math.Max(0, bodyStart-overlapSec),
			FileEndSec:   math.Min(durationSec, bodyEnd+overlapSec),
		})
	}
	return spans, nil
}

// StitchTranscript merges per-chunk results into one ordered transcript with
// absolute timestamps. A segment belongs to the chunk whose body contains its
// midpoint, so overlap duplicates are dropped without text matching. Empty
// segments are dropped, times are clamped to [0, durationSec], made monotonic
// and rounded to milliseconds. An empty result is not an error here.
func StitchTranscript(durationSec float64, spans []AudioChunkSpan, results []AudioChunkResult) ([]TranscriptSegment, error) {
	if !isFinitePositive(durationSec) || len(spans) == 0 {
		return nil, ErrInvalidAudioPlan
	}
	known := make(map[int]bool, len(spans))
	for _, span := range spans {
		known[span.Index] = true
	}
	byIndex := make(map[int][]TranscriptSegment, len(results))
	for _, result := range results {
		if !known[result.Index] {
			return nil, fmt.Errorf("%w: result for unknown chunk %d", ErrInvalidTranscript, result.Index)
		}
		if _, duplicate := byIndex[result.Index]; duplicate {
			return nil, fmt.Errorf("%w: duplicate result for chunk %d", ErrInvalidTranscript, result.Index)
		}
		byIndex[result.Index] = result.Segments
	}
	stitched := make([]TranscriptSegment, 0)
	for position, span := range spans {
		segments, ok := byIndex[span.Index]
		if !ok {
			return nil, fmt.Errorf("%w: missing result for chunk %d", ErrInvalidTranscript, span.Index)
		}
		absolute, err := toAbsoluteSegments(span, segments, durationSec)
		if err != nil {
			return nil, err
		}
		isLast := position == len(spans)-1
		for _, segment := range absolute {
			if ownsMidpoint(span, segment, isLast) {
				stitched = append(stitched, segment)
			}
		}
	}
	return finalizeTimeline(stitched, durationSec)
}

func toAbsoluteSegments(span AudioChunkSpan, segments []TranscriptSegment, durationSec float64) ([]TranscriptSegment, error) {
	absolute := make([]TranscriptSegment, 0, len(segments))
	for _, segment := range segments {
		if !isFinite(segment.StartSec) || !isFinite(segment.EndSec) || segment.StartSec < 0 || segment.EndSec < segment.StartSec {
			return nil, fmt.Errorf("%w: malformed times in chunk %d", ErrInvalidTranscript, span.Index)
		}
		start := span.FileStartSec + segment.StartSec
		end := span.FileStartSec + segment.EndSec
		if end > durationSec+transcriptDurationToleranceSec {
			return nil, fmt.Errorf("%w: segment beyond duration in chunk %d", ErrInvalidTranscript, span.Index)
		}
		absolute = append(absolute, TranscriptSegment{StartSec: start, EndSec: end, Text: normalizeExtractedText(segment.Text)})
	}
	sort.SliceStable(absolute, func(i, j int) bool { return absolute[i].StartSec < absolute[j].StartSec })
	return absolute, nil
}

func ownsMidpoint(span AudioChunkSpan, segment TranscriptSegment, isLast bool) bool {
	if segment.Text == "" {
		return false
	}
	midpoint := (segment.StartSec + segment.EndSec) / 2
	if midpoint < span.BodyStartSec {
		return false
	}
	return midpoint < span.BodyEndSec || isLast
}

// finalizeTimeline clamps only rounding-level drift: a start earlier than the
// previous one by up to transcriptOrderToleranceSec is lifted to it, a larger
// regression is rejected as bad provider data.
func finalizeTimeline(segments []TranscriptSegment, durationSec float64) ([]TranscriptSegment, error) {
	finalized := make([]TranscriptSegment, 0, len(segments))
	previousStart := 0.0
	for _, segment := range segments {
		if segment.StartSec < previousStart-transcriptOrderToleranceSec {
			return nil, fmt.Errorf("%w: segments out of order across chunks", ErrInvalidTranscript)
		}
		start := roundMillis(math.Min(math.Max(segment.StartSec, previousStart), durationSec))
		end := roundMillis(math.Min(math.Max(segment.EndSec, start), durationSec))
		previousStart = start
		finalized = append(finalized, TranscriptSegment{StartSec: start, EndSec: end, Text: segment.Text})
	}
	return finalized, nil
}

func roundMillis(value float64) float64 {
	return math.Round(value*transcriptPrecision) / transcriptPrecision
}

func isFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func isFinitePositive(value float64) bool { return isFinite(value) && value > 0 }
