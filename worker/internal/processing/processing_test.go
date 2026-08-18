package processing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
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
func TestOpenAIGenerateClassifiesInvalidOutputReasons(t *testing.T) {
	validQuestion := `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`
	tests := []struct {
		name     string
		response string
		reason   ParserReason
	}{
		{name: "invalid envelope", response: `{`, reason: InvalidEnvelope},
		{name: "choice count", response: providerResponse(t), reason: ChoiceCount},
		{name: "invalid JSON", response: providerResponse(t, `{`), reason: InvalidJSON},
		{name: "question count", response: providerResponse(t, `{"questions":[]}`), reason: QuestionCount},
		{name: "empty stem", response: providerResponse(t, strings.Replace(validQuestion, `"stem"`, `""`, 1)), reason: EmptyStem},
		{name: "empty explanation", response: providerResponse(t, strings.Replace(validQuestion, `"explanation"`, `""`, 1)), reason: EmptyExplanation},
		{name: "option count", response: providerResponse(t, `{"questions":[{"stem":"stem","explanation":"explanation","options":[]}]}`), reason: OptionCount},
		{name: "empty option", response: providerResponse(t, strings.Replace(validQuestion, `"content":"A"`, `"content":" "`, 1)), reason: EmptyOption},
		{name: "answer count", response: providerResponse(t, strings.Replace(validQuestion, `"isCorrect":true`, `"isCorrect":false`, 1)), reason: AnswerCount},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.response))
			}))
			defer server.Close()

			_, err := NewOpenAI("test-key", server.URL, "test-model").Generate(context.Background(), "source content")
			assertParserFailure(t, err, test.reason)
		})
	}
}

func TestOpenAIGenerateReturnsValidQuestionFromHTTPResponse(t *testing.T) {
	response := `{"choices":[{"finish_reason":"stop","message":{"content":"{\"questions\":[{\"stem\":\"Thủ đô của Việt Nam là gì?\",\"explanation\":\"Hà Nội là thủ đô của Việt Nam.\",\"options\":[{\"content\":\"Hà Nội\",\"isCorrect\":true},{\"content\":\"Huế\",\"isCorrect\":false},{\"content\":\"Đà Nẵng\",\"isCorrect\":false},{\"content\":\"Cần Thơ\",\"isCorrect\":false}]}]}"}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(response))
	}))
	defer server.Close()

	actual, err := NewOpenAI("test-key", server.URL, "test-model").Generate(context.Background(), "source content")
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	expected := Question{
		Stem:        "Thủ đô của Việt Nam là gì?",
		Explanation: "Hà Nội là thủ đô của Việt Nam.",
		Options: []Option{
			{Content: "Hà Nội", IsCorrect: true},
			{Content: "Huế"},
			{Content: "Đà Nẵng"},
			{Content: "Cần Thơ"},
		},
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Generate() = %#v, want %#v", actual, expected)
	}
}

func providerResponse(t *testing.T, contents ...string) string {
	t.Helper()
	response := struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}{Choices: make([]struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}, len(contents))}
	for index, content := range contents {
		response.Choices[index].Message.Content = content
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal provider response: %v", err)
	}
	return string(encoded)
}

func assertParserFailure(t *testing.T, err error, reason ParserReason) {
	t.Helper()
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != OutputInvalid || failure.Reason != reason {
		t.Fatalf("error = %#v, want output-invalid failure with reason %q", err, reason)
	}
}
func TestFakeGeneratorIsSafeForLocalWorker(t *testing.T) {
	if _, err := (FakeGenerator{}).Generate(context.Background(), "source"); err != nil {
		t.Fatal(err)
	}
}
