package processing

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/minio/minio-go/v7"
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

func TestChunkTextUsesMaxCharsWhenNoBoundaryFollowsTarget(t *testing.T) {
	segments := []struct {
		Text    string
		Locator Locator
	}{{Text: strings.Repeat("x", 1600), Locator: Locator{Kind: "text-range"}}}

	chunks, err := ChunkText("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", segments)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 2 || len(chunks[0].Text) != maxChars {
		t.Fatalf("chunks = %#v, want first chunk length %d", chunks, maxChars)
	}
}

func TestClassifyObjectReadErrorOnlyFinalizesMissingObjects(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		technical bool
		code      FailureCode
	}{
		{name: "missing object", err: minio.ErrorResponse{Code: "NoSuchKey"}, code: ObjectNotFound},
		{name: "permission denied", err: minio.ErrorResponse{Code: "AccessDenied"}, technical: true, code: ProcessingFailed},
		{name: "network error", err: errors.New("connection reset"), technical: true, code: ProcessingFailed},
		{name: "stream error", err: io.ErrUnexpectedEOF, technical: true, code: ProcessingFailed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			failure := classifyObjectReadError(test.err)
			if failure.Code != test.code || failure.Technical != test.technical {
				t.Fatalf("classifyObjectReadError() = %#v", failure)
			}
		})
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
