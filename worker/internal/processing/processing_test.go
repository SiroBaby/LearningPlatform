package processing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

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

func TestLocatorMarshalJSONUsesKindSpecificFields(t *testing.T) {
	tests := []struct {
		name     string
		locator  Locator
		expected map[string]string
	}{
		{
			name:    "text range preserves zero start",
			locator: Locator{Kind: "text-range", Start: 0, End: 14, Page: 3},
			expected: map[string]string{
				"kind":  `"text-range"`,
				"start": "0",
				"end":   "14",
			},
		},
		{
			name:    "page emits page only",
			locator: Locator{Kind: "page", Page: 3, Start: 1, End: 14},
			expected: map[string]string{
				"kind": `"page"`,
				"page": "3",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			encoded, err := json.Marshal(test.locator)
			if err != nil {
				t.Fatalf("marshal locator: %v", err)
			}
			var actual map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &actual); err != nil {
				t.Fatalf("decode locator JSON: %v", err)
			}
			if len(actual) != len(test.expected) {
				t.Fatalf("locator JSON fields = %s, want %#v", encoded, test.expected)
			}
			for field, expected := range test.expected {
				if string(actual[field]) != expected {
					t.Fatalf("locator JSON field %q = %s, want %s", field, actual[field], expected)
				}
			}
		})
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
		name        string
		response    string
		reason      ParserReason
		choiceCount int
	}{
		{name: "invalid envelope", response: `{`, reason: InvalidEnvelope},
		{name: "zero choices", response: providerResponse(t), reason: ChoiceCount, choiceCount: 0},
		{name: "multiple choices", response: providerResponse(t, validQuestion, validQuestion), reason: ChoiceCount, choiceCount: 2},
		{name: "invalid JSON", response: providerResponse(t, `{`), reason: InvalidJSON},
		{name: "question count", response: providerResponse(t, `{"questions":[]}`), reason: QuestionCount},
		{name: "empty stem", response: providerResponse(t, strings.Replace(validQuestion, `"stem":"stem"`, `"stem":" "`, 1)), reason: EmptyStem},
		{name: "empty explanation", response: providerResponse(t, strings.Replace(validQuestion, `"explanation":"explanation"`, `"explanation":" "`, 1)), reason: EmptyExplanation},
		{name: "option count", response: providerResponse(t, `{"questions":[{"stem":"stem","explanation":"explanation","options":[]}]}`), reason: OptionCount},
		{name: "empty option", response: providerResponse(t, strings.Replace(validQuestion, `"content":"A"`, `"content":" "`, 1)), reason: EmptyOption},
		{name: "normalized duplicate option", response: providerResponse(t, strings.Replace(validQuestion, `"content":"B"`, `"content":"  a\t  "`, 1)), reason: DuplicateOption},
		{name: "answer count", response: providerResponse(t, strings.Replace(validQuestion, `"isCorrect":true`, `"isCorrect":false`, 1)), reason: AnswerCount},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.response))
			}))
			defer server.Close()

			_, err := NewOpenAI("test-key", server.URL, "test-model", chatCompletionsJSONProfile(), time.Second).Generate(context.Background(), "source content")
			assertParserFailure(t, err, test.reason, test.choiceCount)
		})
	}
}

func TestOpenAIGenerateRequestsOneChoice(t *testing.T) {
	response := providerResponse(t, `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			N              int            `json:"n"`
			ResponseFormat map[string]any `json:"response_format"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if payload.N != 1 || payload.ResponseFormat["type"] != "json_object" {
			t.Fatalf("provider request = %#v", payload)
		}
		if _, hasSchema := payload.ResponseFormat["json_schema"]; hasSchema {
			t.Fatalf("json-object request unexpectedly includes a schema: %#v", payload.ResponseFormat)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(response))
	}))
	defer server.Close()

	if _, err := NewOpenAI("test-key", server.URL, "test-model", chatCompletionsJSONProfile(), time.Second).Generate(context.Background(), "source content"); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
}

func TestOpenAIGenerateSendsStrictSchemaMatchingQuizDecoder(t *testing.T) {
	validQuestion := `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			ResponseFormat struct {
				Type       string `json:"type"`
				JSONSchema struct {
					Name   string         `json:"name"`
					Schema map[string]any `json:"schema"`
					Strict bool           `json:"strict"`
				} `json:"json_schema"`
			} `json:"response_format"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if payload.ResponseFormat.Type != "json_schema" || payload.ResponseFormat.JSONSchema.Name != "quiz_question" || !payload.ResponseFormat.JSONSchema.Strict {
			t.Fatalf("response format = %#v", payload.ResponseFormat)
		}
		assertQuizSchema(t, payload.ResponseFormat.JSONSchema.Schema)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(providerResponse(t, validQuestion)))
	}))
	defer server.Close()

	profile := ProviderProfile{CapabilityVersion: ChatCompletionsJSONV1, StructuredOutputMode: JSONSchemaStrict, Transport: ChatCompletions}
	if _, err := NewOpenAI("test-key", server.URL, "test-model", profile, time.Second).Generate(context.Background(), "source content"); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
}

func TestOpenAIGenerateHonorsStructuredOutputModeForUnknownFields(t *testing.T) {
	outputWithUnknownField := `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}],"extra":"accepted only in JSON-object mode"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(providerResponse(t, outputWithUnknownField)))
	}))
	defer server.Close()

	tests := []struct {
		name    string
		profile ProviderProfile
		wantErr bool
	}{
		{name: "JSON object accepts unknown fields", profile: chatCompletionsJSONProfile()},
		{name: "strict JSON schema rejects unknown fields", profile: ProviderProfile{CapabilityVersion: ChatCompletionsJSONV1, StructuredOutputMode: JSONSchemaStrict, Transport: ChatCompletions}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewOpenAI("test-key", server.URL, "test-model", test.profile, time.Second).Generate(context.Background(), "source content")
			if test.wantErr {
				assertParserFailure(t, err, InvalidJSON, 0)
				return
			}
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
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

	actual, err := NewOpenAI("test-key", server.URL, "test-model", chatCompletionsJSONProfile(), time.Second).Generate(context.Background(), "source content")
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

func TestDecodeQuizAcceptsOnlyPlainOrOuterJSONFencedOutput(t *testing.T) {
	validQuestion := `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`
	tests := []struct {
		name       string
		raw        string
		wantReason ParserReason
	}{
		{name: "plain JSON", raw: validQuestion},
		{name: "outer JSON fence", raw: "```json\n" + validQuestion + "\n```"},
		{name: "invalid JSON", raw: `{`, wantReason: InvalidJSON},
		{name: "wrong shape", raw: `{"questions":[]}`, wantReason: QuestionCount},
		{name: "non JSON fence", raw: "```\n" + validQuestion + "\n```", wantReason: InvalidJSON},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := decodeQuiz(test.raw, JSONSchemaStrict)
			if test.wantReason == "" {
				if err != nil {
					t.Fatalf("decodeQuiz() error = %v", err)
				}
				return
			}
			assertParserFailure(t, err, test.wantReason, 0)
		})
	}
}

func TestQuizSchemaRejectsWhitespaceOnlyRequiredTextLikeDecoder(t *testing.T) {
	for property, schema := range quizSchemaTextProperties(t) {
		if schema["pattern"] != "\\S" {
			t.Fatalf("%s schema pattern = %#v, want \\S", property, schema["pattern"])
		}
	}

	tests := []struct {
		name       string
		raw        string
		wantReason ParserReason
	}{
		{name: "whitespace stem", raw: `{"questions":[{"stem":" \t ","explanation":"explanation","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`, wantReason: EmptyStem},
		{name: "whitespace explanation", raw: `{"questions":[{"stem":"stem","explanation":" \n ","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`, wantReason: EmptyExplanation},
		{name: "whitespace option", raw: `{"questions":[{"stem":"stem","explanation":"explanation","options":[{"content":" \r ","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`, wantReason: EmptyOption},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := decodeQuiz(test.raw, JSONSchemaStrict)
			assertParserFailure(t, err, test.wantReason, 0)
		})
	}
}

func quizSchemaTextProperties(t *testing.T) map[string]map[string]any {
	t.Helper()
	root := quizSchema()
	questions := schemaProperty(t, root["properties"].(map[string]any), "questions")
	question := questions["items"].(map[string]any)
	questionProperties := question["properties"].(map[string]any)
	options := schemaProperty(t, questionProperties, "options")
	option := options["items"].(map[string]any)
	optionProperties := option["properties"].(map[string]any)
	return map[string]map[string]any{
		"stem":        schemaProperty(t, questionProperties, "stem"),
		"explanation": schemaProperty(t, questionProperties, "explanation"),
		"content":     schemaProperty(t, optionProperties, "content"),
	}
}

func TestOpenAIPreflightRejectsInvalidQuizOutput(t *testing.T) {
	tests := []struct {
		name   string
		output string
	}{
		{name: "shallow JSON", output: `{"ready":true}`},
		{name: "malformed JSON", output: `{`},
		{name: "wrong question cardinality", output: `{"questions":[]}`},
		{name: "wrong option cardinality", output: `{"questions":[{"stem":"stem","explanation":"explanation","options":[]}]}`},
		{name: "blank required text", output: strings.Replace(validQuizOutput(), `"stem":"Cau hoi kiem tra"`, `"stem":" "`, 1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				calls++
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(providerResponse(t, test.output)))
			}))
			defer server.Close()

			err := NewOpenAI("test-key", server.URL, "gateway-alias", chatCompletionsJSONProfile(), time.Second).Preflight(context.Background())
			assertProviderFailure(t, err, ProviderIncompatible)
			if calls != 1 {
				t.Fatalf("preflight calls = %d, want 1", calls)
			}
		})
	}
}

func TestOpenAIPreflightAcceptsOuterFencedQuizJSONForJSONObjectProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(providerResponse(t, "```json\n"+validQuizOutput()+"\n```")))
	}))
	defer server.Close()

	if err := NewOpenAI("test-key", server.URL, "gateway-alias", chatCompletionsJSONProfile(), time.Second).Preflight(context.Background()); err != nil {
		t.Fatalf("Preflight() error = %v", err)
	}
}

func TestOpenAIPreflightUsesConfiguredAliasAndProfile(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("request path = %q", request.URL.Path)
		}
		var payload struct {
			Model          string `json:"model"`
			N              int    `json:"n"`
			ResponseFormat struct {
				Type string `json:"type"`
			} `json:"response_format"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if payload.Model != "gateway-alias" || payload.N != 1 || payload.ResponseFormat.Type != "json_object" || len(payload.Messages) != 2 || payload.Messages[0].Content != preflightInstructions || payload.Messages[1].Content != preflightInput {
			t.Fatalf("preflight request = %#v", payload)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(providerResponse(t, validQuizOutput())))
	}))
	defer server.Close()

	if err := NewOpenAI("test-key", server.URL, "gateway-alias", chatCompletionsJSONProfile(), time.Second).Preflight(context.Background()); err != nil {
		t.Fatalf("Preflight() error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("preflight calls = %d, want 1", calls)
	}
}

func TestOpenAIPreflightSupportsResponsesJSONSchemaProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("request path = %q", request.URL.Path)
		}
		var payload struct {
			Input string `json:"input"`
			Text  struct {
				Format struct {
					Type   string         `json:"type"`
					Strict bool           `json:"strict"`
					Name   string         `json:"name"`
					Schema map[string]any `json:"schema"`
				} `json:"format"`
			} `json:"text"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if payload.Input != preflightInput || payload.Text.Format.Type != "json_schema" || !payload.Text.Format.Strict || payload.Text.Format.Name != "quiz_question" {
			t.Fatalf("preflight request = %#v", payload)
		}
		assertQuizSchema(t, payload.Text.Format.Schema)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":` + strconv.Quote(validQuizOutput()) + `}]}]}`))
	}))
	defer server.Close()

	profile := ProviderProfile{CapabilityVersion: ResponsesJSONV1, StructuredOutputMode: JSONSchemaStrict, Transport: Responses}
	if err := NewOpenAI("test-key", server.URL, "gateway-alias", profile, time.Second).Preflight(context.Background()); err != nil {
		t.Fatalf("Preflight() error = %v", err)
	}
}

func TestDecodeResponsesEnvelopeSelectsFinalUsableOutputText(t *testing.T) {
	response := `{"status":"completed","output":[{"type":"reasoning","content":[{"type":"output_text","text":"ignore reasoning"}]},{"type":"message","content":[{"type":"output_text","text":"first output"},{"type":"refusal","text":"ignore refusal"}]},{"type":"message","content":[{"type":"output_text","text":" \t "},{"type":"output_text","text":"final output"}]}]}`

	actual, err := decodeResponsesEnvelope(strings.NewReader(response))
	if err != nil {
		t.Fatalf("decodeResponsesEnvelope() error = %v", err)
	}
	if actual != "final output" {
		t.Fatalf("decodeResponsesEnvelope() = %q, want final usable output text", actual)
	}
}

func TestOpenAIPreflightTimesOutWithoutExposingProviderPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"content":"raw-provider-response`))
		if flusher, ok := writer.(http.Flusher); ok {
			flusher.Flush()
		}
		<-request.Context().Done()
	}))
	defer server.Close()

	started := time.Now()
	err := NewOpenAI("test-key", server.URL, "gateway-alias", chatCompletionsJSONProfile(), 40*time.Millisecond).Preflight(context.Background())
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Preflight() took %s, want bounded termination", elapsed)
	}
	assertProviderFailure(t, err, ProviderUnavailable)
	for _, forbidden := range []string{"test-key", server.URL, "raw-provider-response"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("Preflight() exposed %q in %q", forbidden, err)
		}
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

func validQuizOutput() string {
	return `{"questions":[{"stem":"Cau hoi kiem tra","explanation":"Giai thich kiem tra","options":[{"content":"A","isCorrect":true},{"content":"B","isCorrect":false},{"content":"C","isCorrect":false},{"content":"D","isCorrect":false}]}]}`
}

func assertParserFailure(t *testing.T, err error, reason ParserReason, choiceCount int) {
	t.Helper()
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != OutputInvalid || failure.Reason != reason || failure.ChoiceCount != choiceCount {
		t.Fatalf("error = %#v, want output-invalid failure with reason %q", err, reason)
	}
}

func assertProviderFailure(t *testing.T, err error, code FailureCode) {
	t.Helper()
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != code {
		t.Fatalf("error = %#v, want provider failure %q", err, code)
	}
}

func assertQuizSchema(t *testing.T, schema map[string]any) {
	t.Helper()
	rootProperties := assertSchemaObject(t, schema, []string{"questions"})
	questions := assertSchemaArray(t, schemaProperty(t, rootProperties, "questions"), 1, 1)
	questionProperties := assertSchemaObject(t, questions, []string{"stem", "explanation", "options"})
	assertSchemaString(t, schemaProperty(t, questionProperties, "stem"))
	assertSchemaString(t, schemaProperty(t, questionProperties, "explanation"))
	options := assertSchemaArray(t, schemaProperty(t, questionProperties, "options"), 4, 4)
	optionProperties := assertSchemaObject(t, options, []string{"content", "isCorrect"})
	assertSchemaString(t, schemaProperty(t, optionProperties, "content"))
	if schemaProperty(t, optionProperties, "isCorrect")["type"] != "boolean" {
		t.Fatalf("isCorrect schema = %#v", schemaProperty(t, optionProperties, "isCorrect"))
	}
}

func assertSchemaArray(t *testing.T, schema map[string]any, minItems, maxItems float64) map[string]any {
	t.Helper()
	if schema["type"] != "array" || schema["minItems"] != minItems || schema["maxItems"] != maxItems {
		t.Fatalf("array schema = %#v", schema)
	}
	items, ok := schema["items"].(map[string]any)
	if !ok {
		t.Fatalf("array items = %#v", schema["items"])
	}
	return items
}

func assertSchemaObject(t *testing.T, schema map[string]any, required []string) map[string]any {
	t.Helper()
	if schema["type"] != "object" || schema["additionalProperties"] != false || !reflect.DeepEqual(schema["required"], stringsToAny(required)) {
		t.Fatalf("object schema = %#v", schema)
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("object properties = %#v", schema["properties"])
	}
	return properties
}

func assertSchemaString(t *testing.T, schema map[string]any) {
	t.Helper()
	if schema["type"] != "string" || schema["minLength"] != float64(1) || schema["pattern"] != "\\S" {
		t.Fatalf("string schema = %#v", schema)
	}
}

func schemaProperty(t *testing.T, properties map[string]any, name string) map[string]any {
	t.Helper()
	property, ok := properties[name].(map[string]any)
	if !ok {
		t.Fatalf("property %q = %#v", name, properties[name])
	}
	return property
}

func stringsToAny(values []string) []any {
	output := make([]any, len(values))
	for index, value := range values {
		output[index] = value
	}
	return output
}

func chatCompletionsJSONProfile() ProviderProfile {
	return ProviderProfile{
		CapabilityVersion:    ChatCompletionsJSONV1,
		StructuredOutputMode: JSONObject,
		Transport:            ChatCompletions,
	}
}
func TestFakeGeneratorIsSafeForLocalWorker(t *testing.T) {
	if _, err := (FakeGenerator{}).Generate(context.Background(), "source"); err != nil {
		t.Fatal(err)
	}
}
