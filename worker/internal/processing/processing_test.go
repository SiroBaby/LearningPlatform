package processing

import (
	"context"
	"errors"
	"testing"
)

func TestChunkTextKeepsDeterministicIDsAndTextRanges(t *testing.T) {
	segments := []struct {
		Text    string
		Locator Locator
	}{{Text: "  first content  ", Locator: Locator{Kind: "text-range", Start: 10, End: 25}}}
	first, err := ChunkText("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", segments)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ChunkText("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", segments)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].ID != second[0].ID || first[0].Locator.Start != 12 {
		t.Fatalf("unexpected chunks: %#v", first)
	}
}
func TestValidateQuizRejectsMalformedOutput(t *testing.T) {
	if _, err := decodeQuiz(`{"questions":[{"stem":"s","explanation":"e","options":[{"content":"a","isCorrect":true}]}]}`); !errors.As(err, new(Failure)) {
		t.Fatalf("validateQuiz() error=%v", err)
	}
}
func TestFakeGeneratorIsSafeForLocalWorker(t *testing.T) {
	if _, err := (FakeGenerator{}).Generate(context.Background(), "source"); err != nil {
		t.Fatal(err)
	}
}
