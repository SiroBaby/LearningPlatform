package processing

import (
	"crypto/sha256"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"unicode"
)

const targetChars = 1200
const maxChars = 1500
const overlapChars = 150
const maxChunks = 20000
const maxTotalChars = 24000000

func ChunkText(documentID, ownerID string, segments []struct {
	Text    string
	Locator Locator
}) ([]Chunk, error) {
	chunks := make([]Chunk, 0)
	total := 0
	for _, segment := range segments {
		leading := len(segment.Text) - len(strings.TrimLeftFunc(segment.Text, unicode.IsSpace))
		text := strings.TrimSpace(segment.Text)
		for start := 0; start < len(text); {
			end := start + targetChars
			if end >= len(text) {
				end = len(text)
			} else {
				limit := start + maxChars
				if limit > len(text) {
					limit = len(text)
				}
				candidate := strings.IndexAny(text[end:limit], " \n\t")
				if candidate >= 0 {
					end += candidate + 1
				} else {
					end = limit
				}
			}
			value := strings.TrimSpace(text[start:end])
			if value != "" {
				total += len(value)
				if len(chunks) >= maxChunks || total > maxTotalChars {
					return nil, Failure{Code: ChunkLimit}
				}
				sum := sha256.Sum256([]byte(value))
				hash := fmt.Sprintf("%x", sum)
				id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(documentID+":"+ownerID+":"+fmt.Sprint(len(chunks))+":"+hash)).String()
				locator := segment.Locator
				if locator.Kind == "text-range" {
					locator.Start += leading + start
					locator.End = locator.Start + len(value)
				}
				chunks = append(chunks, Chunk{ID: id, Index: len(chunks), Text: value, ContentHash: hash, Locator: locator})
			}
			if end == len(text) {
				break
			}
			next := end - overlapChars
			if next <= start {
				next = end
			}
			start = next
		}
	}
	return chunks, nil
}
