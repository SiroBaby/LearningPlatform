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

// splitByWords cuts one oversized segment into pieces of at most maxChars
// bytes (the same byte unit ChunkText uses). Times are interpolated by rune
// offset in the normalised text, so multibyte text is not skewed. A single
// token longer than maxChars is hard-split at a rune boundary.
func splitByWords(text string, locator Locator) []ExtractedSegment {
	type token struct {
		text string
		solo bool
	}
	tokens := make([]token, 0)
	for _, word := range strings.Fields(text) {
		if len(word) <= maxChars {
			tokens = append(tokens, token{text: word})
			continue
		}
		for len(word) > 0 {
			end := moveToRuneBoundary(word, maxChars)
			if end == 0 {
				end = len(word)
			}
			tokens = append(tokens, token{text: word[:end], solo: true})
			word = word[end:]
		}
	}
	span := locator.EndSec - locator.StartSec
	totalRunes := utf8.RuneCountInString(text)
	interpolate := func(offset int) float64 {
		return roundMillis(locator.StartSec + span*float64(offset)/float64(totalRunes))
	}
	pieces := make([]ExtractedSegment, 0)
	var current []string
	currentBytes, currentStart, offset := 0, 0, 0
	emit := func(value string, startOffset int) {
		piece := locator
		piece.StartSec = interpolate(startOffset)
		piece.EndSec = interpolate(startOffset + utf8.RuneCountInString(value))
		pieces = append(pieces, ExtractedSegment{Text: value, Locator: piece})
	}
	flush := func() {
		if len(current) > 0 {
			emit(strings.Join(current, " "), currentStart)
		}
		current, currentBytes = nil, 0
	}
	for _, item := range tokens {
		if item.solo {
			flush()
			emit(item.text, offset)
			offset += utf8.RuneCountInString(item.text)
			continue
		}
		if currentBytes > 0 && currentBytes+1+len(item.text) > maxChars {
			flush()
		}
		if currentBytes == 0 {
			currentStart = offset
		} else {
			currentBytes++
		}
		current = append(current, item.text)
		currentBytes += len(item.text)
		offset += utf8.RuneCountInString(item.text) + 1
	}
	flush()
	if last := len(pieces) - 1; last >= 0 {
		pieces[last].Locator.EndSec = locator.EndSec
	}
	return pieces
}
