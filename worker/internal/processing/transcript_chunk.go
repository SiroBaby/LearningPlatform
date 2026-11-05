package processing

import (
	"strings"
	"unicode/utf8"
)

// ExtractedSegment is a block of extracted text with the locator it cites.
type ExtractedSegment struct {
	Text    string
	Locator Locator
}

// TimedSegmentsToExtracted converts a stitched transcript into time-locator
// segments, dropping segments that are empty after normalisation.
func TimedSegmentsToExtracted(segments []TranscriptSegment) []ExtractedSegment {
	extracted := make([]ExtractedSegment, 0, len(segments))
	for _, segment := range segments {
		text := normalizeExtractedText(segment.Text)
		if text == "" {
			continue
		}
		extracted = append(extracted, ExtractedSegment{
			Text:    text,
			Locator: Locator{Kind: LocatorKindTime, StartSec: segment.StartSec, EndSec: segment.EndSec},
		})
	}
	return extracted
}

// ChunkTranscript packs whole time segments into chunks of about targetChars
// (never above maxChars). Each chunk cites [first.start, last.end]; the next
// chunk re-starts with trailing segments of the previous one totalling at most
// overlapChars. A single segment above maxChars is split at word boundaries
// with times interpolated by character position.
func ChunkTranscript(documentID, ownerID string, segments []ExtractedSegment) ([]Chunk, error) {
	pieces := splitOversizedSegments(segments)
	chunks := make([]Chunk, 0)
	total := 0
	for start := 0; start < len(pieces); {
		end, text := packPieces(pieces, start)
		total += len(text)
		if len(chunks) >= maxChunks || total > maxTotalChars {
			return nil, Failure{Code: ChunkLimit}
		}
		locator := Locator{Kind: LocatorKindTime, StartSec: pieces[start].Locator.StartSec, EndSec: pieces[end-1].Locator.EndSec}
		chunks = append(chunks, newChunk(documentID, ownerID, len(chunks), text, locator))
		if end == len(pieces) {
			break
		}
		start = nextChunkStart(pieces, start, end)
	}
	return chunks, nil
}

func packPieces(pieces []ExtractedSegment, start int) (int, string) {
	var builder strings.Builder
	end := start
	for end < len(pieces) {
		piece := pieces[end].Text
		if end > start && builder.Len()+1+len(piece) > maxChars {
			break
		}
		if end > start {
			builder.WriteByte(' ')
		}
		builder.WriteString(piece)
		end++
		if builder.Len() >= targetChars {
			break
		}
	}
	return end, builder.String()
}

// nextChunkStart returns the first index after start whose tail up to end fits
// in the overlap budget; it always advances past start.
func nextChunkStart(pieces []ExtractedSegment, start, end int) int {
	size := 0
	next := end
	for index := end - 1; index > start; index-- {
		size += len(pieces[index].Text) + 1
		if size > overlapChars {
			break
		}
		next = index
	}
	return next
}

func splitOversizedSegments(segments []ExtractedSegment) []ExtractedSegment {
	pieces := make([]ExtractedSegment, 0, len(segments))
	for _, segment := range segments {
		text := normalizeExtractedText(segment.Text)
		if text == "" {
			continue
		}
		if len(text) <= maxChars {
			pieces = append(pieces, ExtractedSegment{Text: text, Locator: segment.Locator})
			continue
		}
		pieces = append(pieces, splitByWords(text, segment.Locator)...)
	}
	return pieces
}

func splitByWords(text string, locator Locator) []ExtractedSegment {
	pieces := make([]ExtractedSegment, 0)
	span := locator.EndSec - locator.StartSec
	totalRunes := utf8.RuneCountInString(text)
	consumed := 0
	var current []string
	currentLen := 0
	flush := func() {
		if len(current) == 0 {
			return
		}
		value := strings.Join(current, " ")
		runes := utf8.RuneCountInString(value)
		piece := locator
		piece.StartSec = locator.StartSec + span*float64(consumed)/float64(totalRunes)
		piece.EndSec = locator.StartSec + span*float64(consumed+runes)/float64(totalRunes)
		pieces = append(pieces, ExtractedSegment{Text: value, Locator: piece})
		consumed += runes + 1
		current, currentLen = nil, 0
	}
	for _, word := range strings.Fields(text) {
		if currentLen > 0 && currentLen+1+len(word) > maxChars {
			flush()
		}
		if currentLen > 0 {
			currentLen++
		}
		current = append(current, word)
		currentLen += len(word)
	}
	flush()
	if last := len(pieces) - 1; last >= 0 {
		pieces[last].Locator.EndSec = locator.EndSec
	}
	return pieces
}
