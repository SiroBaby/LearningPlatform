package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ledongthuc/pdf"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio-go/v7/pkg/s3utils"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type S3Reader struct {
	client      *minio.Client
	bucket      string
	mediaClient *minio.Client
	mediaBucket string
}

func NewS3Reader(endpoint, accessKey, secretKey, bucket string) (*S3Reader, error) {
	client, err := newS3Client(endpoint, accessKey, secretKey, "")
	if err != nil {
		return nil, err
	}
	return &S3Reader{client: client, bucket: bucket}, nil
}

// NewS3ReaderWithMedia adds a separate least-privilege reader for the media
// bucket while preserving the existing document reader for PDF/TEXT.
func NewS3ReaderWithMedia(endpoint, accessKey, secretKey, bucket, mediaAccessKey, mediaSecretKey, mediaBucket, proxyURL string) (*S3Reader, error) {
	reader, err := NewS3Reader(endpoint, accessKey, secretKey, bucket)
	if err != nil {
		return nil, err
	}
	mediaClient, err := newS3Client(endpoint, mediaAccessKey, mediaSecretKey, proxyURL)
	if err != nil {
		return nil, err
	}
	reader.mediaClient = mediaClient
	reader.mediaBucket = mediaBucket
	return reader, nil
}

func newS3Client(endpoint, accessKey, secretKey, proxyURL string) (*minio.Client, error) {
	server := endpoint
	secure := false
	if strings.Contains(endpoint, "://") {
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Host == "" {
			return nil, fmt.Errorf("parse object storage endpoint")
		}
		server = parsed.Host
		secure = parsed.Scheme == "https"
	}
	region, err := resolveS3Region(url.URL{Host: server})
	if err != nil {
		return nil, err
	}
	options := &minio.Options{Creds: credentials.NewStaticV4(accessKey, secretKey, ""), Secure: secure, Region: region}
	if strings.TrimSpace(proxyURL) != "" {
		proxy, err := url.Parse(proxyURL)
		if err != nil || proxy.Host == "" || (proxy.Scheme != "http" && proxy.Scheme != "https") {
			return nil, fmt.Errorf("object storage proxy URL is invalid")
		}
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = http.ProxyURL(proxy)
		options.Transport = transport
	}
	client, err := minio.New(server, options)
	if err != nil {
		return nil, fmt.Errorf("create object storage client: %w", err)
	}
	// minio-go rewrites Amazon endpoints to s3.dualstack.* by default; the
	// egress proxy allowlists only the configured host, so keep that host.
	client.SetS3EnableDualstack(false)
	return client, nil
}

// resolveS3Region pins the region parsed from an Amazon endpoint. Without it
// minio-go discovers the region via GET ?location; a least-privilege credential
// gets AccessDenied there, minio-go falls back to us-east-1 and sends requests
// to a host the egress proxy does not allowlist.
func resolveS3Region(endpoint url.URL) (string, error) {
	region := s3utils.GetRegionFromURL(endpoint)
	if region == "" && strings.HasSuffix(endpoint.Hostname(), ".amazonaws.com") {
		return "", fmt.Errorf("object storage endpoint must be a regional Amazon S3 endpoint")
	}
	return region, nil
}

func (reader *S3Reader) Read(ctx context.Context, key string, max int64) ([]byte, error) {
	object, err := reader.client.GetObject(ctx, reader.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, classifyObjectReadError(err)
	}
	defer object.Close()
	bytes, err := io.ReadAll(io.LimitReader(object, max+1))
	if err != nil {
		return nil, classifyObjectReadError(err)
	}
	if int64(len(bytes)) > max {
		return nil, Failure{Code: ObjectTooLarge}
	}
	return bytes, nil
}

func (reader *S3Reader) ReadVersion(ctx context.Context, locator ObjectLocator, max int64) ([]byte, error) {
	if reader.mediaClient == nil || locator.Bucket == "" || locator.Bucket != reader.mediaBucket || locator.Key == "" || locator.VersionID == "" || locator.ETag == "" || locator.ContentLength < 0 {
		return nil, Failure{Code: ObjectNotFound}
	}
	object, err := reader.mediaClient.GetObject(ctx, locator.Bucket, locator.Key, minio.GetObjectOptions{VersionID: locator.VersionID})
	if err != nil {
		return nil, classifyObjectReadError(err)
	}
	defer object.Close()
	info, err := object.Stat()
	if err != nil {
		return nil, classifyObjectReadError(err)
	}
	if info.VersionID != locator.VersionID || info.ETag != locator.ETag || info.Size != locator.ContentLength {
		return nil, Failure{Code: ObjectNotFound}
	}
	bytes, err := io.ReadAll(io.LimitReader(object, max+1))
	if err != nil {
		return nil, classifyObjectReadError(err)
	}
	if int64(len(bytes)) > max {
		return nil, Failure{Code: ObjectTooLarge}
	}
	return bytes, nil
}

func classifyObjectReadError(err error) Failure {
	var response minio.ErrorResponse
	if errors.As(err, &response) && (response.Code == "NoSuchKey" || response.Code == "NoSuchObject" || response.Code == "NoSuchVersion") {
		return Failure{Code: ObjectNotFound}
	}
	return Failure{Code: ProcessingFailed, Technical: true}
}

func (reader *S3Reader) Check(ctx context.Context) error {
	exists, err := reader.client.BucketExists(ctx, reader.bucket)
	if err != nil || !exists {
		return fmt.Errorf("object storage bucket is unavailable or misconfigured")
	}
	return nil
}

func Extract(source Source, input []byte) ([]struct {
	Text    string
	Locator Locator
}, error) {
	if source.Type == "TEXT" {
		text := normalizeExtractedText(string(input))
		if text == "" {
			return nil, Failure{Code: PDFTextNotFound}
		}
		return []struct {
			Text    string
			Locator Locator
		}{{Text: text, Locator: Locator{Kind: "text-range", Start: 0, End: len(text)}}}, nil
	}
	if source.Type != "PDF" {
		return nil, Failure{Code: ObjectNotFound}
	}
	file, err := os.CreateTemp("", "ai-worker-*.pdf")
	if err != nil {
		return nil, fmt.Errorf("create temporary pdf: %w", err)
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err := file.Write(input); err != nil {
		file.Close()
		return nil, fmt.Errorf("write temporary pdf: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close temporary pdf: %w", err)
	}
	handle, reader, err := pdf.Open(name)
	if err != nil {
		return nil, Failure{Code: PDFInvalid}
	}
	defer handle.Close()
	result := make([]struct {
		Text    string
		Locator Locator
	}, 0, reader.NumPage())
	for page := 1; page <= reader.NumPage(); page++ {
		text, err := pageText(reader, page)
		if err != nil {
			return nil, Failure{Code: PDFInvalid}
		}
		text = normalizeExtractedText(text)
		if text != "" {
			result = append(result, struct {
				Text    string
				Locator Locator
			}{Text: text, Locator: Locator{Kind: "page", Page: page}})
		}
	}
	if len(result) == 0 {
		return nil, Failure{Code: PDFTextNotFound}
	}
	return result, nil
}

func normalizeExtractedText(text string) string {
	return strings.Join(strings.Fields(strings.ToValidUTF8(text, " ")), " ")
}

func pageText(reader *pdf.Reader, page int) (text string, err error) {
	document := reader.Page(page)
	if document.V.IsNull() {
		return "", nil
	}
	defer func() {
		if recover() != nil {
			text = ""
			err = fmt.Errorf("parse PDF page content")
		}
	}()
	plainText, err := document.GetPlainText(nil)
	if err != nil {
		return "", err
	}
	// GetPlainText follows content-stream order. It does not infer missing
	// spaces from visual coordinates or reorder text by page geometry.
	return plainText, nil
}

type OpenAI struct {
	client                 *http.Client
	apiKey, baseURL, model string
	profile                ProviderProfile
	timeout                time.Duration
}

const (
	preflightInstructions = "Return JSON {questions:[{stem,explanation,options:[{content,isCorrect}]}]}. Generate one Vietnamese MCQ using only the synthetic input."
	preflightInput        = "Synthetic contract probe: the reference token is mau-kiem-tra. This is not a document."
)

func NewOpenAI(apiKey, baseURL, model string, profile ProviderProfile, timeout time.Duration) *OpenAI {
	if timeout <= 0 {
		timeout = time.Minute
	}
	return &OpenAI{client: &http.Client{Timeout: timeout}, apiKey: apiKey, baseURL: strings.TrimRight(baseURL, "/"), model: model, profile: profile, timeout: timeout}
}

func (provider *OpenAI) Generate(ctx context.Context, source string) (Question, error) {
	output, err := provider.request(ctx, "Return JSON {questions:[{stem,explanation,options:[{content,isCorrect}]}]}. Generate one Vietnamese grounded MCQ.", source, 8000, "quiz_question", quizSchema())
	if err != nil {
		return Question{}, err
	}
	return decodeQuiz(output, provider.profile.StructuredOutputMode)
}

// Preflight verifies the configured alias and profile with one bounded, non-document request.
func (provider *OpenAI) Preflight(ctx context.Context) error {
	output, err := provider.request(ctx, preflightInstructions, preflightInput, 512, "quiz_question", quizSchema())
	if err != nil {
		return preflightFailure(err)
	}
	if _, err := decodeQuiz(output, provider.profile.StructuredOutputMode); err != nil {
		return Failure{Code: ProviderIncompatible}
	}
	return nil
}

func (provider *OpenAI) request(ctx context.Context, instructions, input string, maxOutputTokens int, schemaName string, schema map[string]any) (string, error) {
	payload, endpoint := provider.requestPayload(instructions, input, maxOutputTokens, schemaName, schema)
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode provider request: %w", err)
	}
	requestContext, cancel := context.WithTimeout(ctx, provider.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodPost, provider.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create provider request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+provider.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return "", Failure{Code: ProviderUnavailable, Technical: true}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", Failure{Code: ProviderUnavailable, Technical: true}
	}
	output, err := provider.decodeResponse(response.Body)
	if err != nil && requestContext.Err() != nil {
		return "", Failure{Code: ProviderUnavailable, Technical: true}
	}
	return output, err
}

func (provider *OpenAI) requestPayload(instructions, input string, maxOutputTokens int, schemaName string, schema map[string]any) (map[string]any, string) {
	switch provider.profile.Transport {
	case Responses:
		return map[string]any{
			"model": provider.model, "max_output_tokens": maxOutputTokens, "instructions": instructions, "input": input, "store": false,
			"text": map[string]any{"format": responseFormat(provider.profile.StructuredOutputMode, schemaName, schema)},
		}, "/responses"
	default:
		return map[string]any{
			"model": provider.model, "max_tokens": maxOutputTokens, "n": 1,
			"response_format": chatResponseFormat(provider.profile.StructuredOutputMode, schemaName, schema),
			"messages":        []map[string]string{{"role": "system", "content": instructions}, {"role": "user", "content": input}},
		}, "/chat/completions"
	}
}

func (provider *OpenAI) decodeResponse(body io.Reader) (string, error) {
	if provider.profile.Transport == Responses {
		return decodeResponsesEnvelope(body)
	}
	var decoded struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 1<<20)).Decode(&decoded); err != nil {
		return "", Failure{Code: OutputInvalid, Reason: InvalidEnvelope}
	}
	if len(decoded.Choices) != 1 {
		return "", Failure{Code: OutputInvalid, Reason: ChoiceCount, ChoiceCount: len(decoded.Choices)}
	}
	if decoded.Choices[0].FinishReason == "length" {
		return "", Failure{Code: OutputTruncated, Technical: true}
	}
	if strings.TrimSpace(decoded.Choices[0].Message.Content) == "" {
		return "", Failure{Code: OutputInvalid, Reason: InvalidJSON}
	}
	return decoded.Choices[0].Message.Content, nil
}

func decodeResponsesEnvelope(body io.Reader) (string, error) {
	var decoded struct {
		Status string `json:"status"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 1<<20)).Decode(&decoded); err != nil {
		return "", Failure{Code: OutputInvalid, Reason: InvalidEnvelope}
	}
	if decoded.Status != "completed" {
		return "", Failure{Code: OutputInvalid, Reason: InvalidEnvelope}
	}
	var output string
	for _, item := range decoded.Output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if content.Type == "output_text" && strings.TrimSpace(content.Text) != "" {
				output = content.Text
			}
		}
	}
	if output == "" {
		return "", Failure{Code: OutputInvalid, Reason: InvalidEnvelope}
	}
	return output, nil
}

func decodeQuiz(raw string, mode StructuredOutputMode) (Question, error) {
	raw = normalizeGeneratedJSON(raw)
	var output struct {
		Questions []struct {
			Stem        string `json:"stem"`
			Explanation string `json:"explanation"`
			Options     []struct {
				Content string `json:"content"`
				Correct bool   `json:"isCorrect"`
			} `json:"options"`
		} `json:"questions"`
	}
	if !decodeJSON(raw, &output, mode == JSONSchemaStrict) {
		return Question{}, Failure{Code: OutputInvalid, Reason: InvalidJSON}
	}
	if len(output.Questions) != 1 {
		return Question{}, Failure{Code: OutputInvalid, Reason: QuestionCount}
	}
	question := output.Questions[0]
	if strings.TrimSpace(question.Stem) == "" {
		return Question{}, Failure{Code: OutputInvalid, Reason: EmptyStem}
	}
	if strings.TrimSpace(question.Explanation) == "" {
		return Question{}, Failure{Code: OutputInvalid, Reason: EmptyExplanation}
	}
	if len(question.Options) != 4 {
		return Question{}, Failure{Code: OutputInvalid, Reason: OptionCount}
	}
	correct := 0
	seenOptions := make(map[string]struct{}, len(question.Options))
	for _, option := range question.Options {
		if strings.TrimSpace(option.Content) == "" {
			return Question{}, Failure{Code: OutputInvalid, Reason: EmptyOption}
		}
		normalizedContent := normalizeOptionContent(option.Content)
		if _, exists := seenOptions[normalizedContent]; exists {
			return Question{}, Failure{Code: OutputInvalid, Reason: DuplicateOption}
		}
		seenOptions[normalizedContent] = struct{}{}
		if option.Correct {
			correct++
		}
	}
	if correct != 1 {
		return Question{}, Failure{Code: OutputInvalid, Reason: AnswerCount}
	}
	options := make([]Option, len(question.Options))
	for index, option := range question.Options {
		options[index] = Option{Content: option.Content, IsCorrect: option.Correct}
	}
	return Question{Stem: question.Stem, Explanation: question.Explanation, Options: options}, nil
}

func normalizeOptionContent(content string) string {
	return strings.ToLower(strings.Join(strings.Fields(content), " "))
}

func normalizeGeneratedJSON(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	if !strings.HasPrefix(trimmed, "```json\n") || !strings.HasSuffix(trimmed, "\n```") {
		return ""
	}
	return strings.TrimSpace(trimmed[len("```json\n") : len(trimmed)-len("\n```")])
}

func strictDecodeJSON(raw string, output any) bool {
	return decodeJSON(raw, output, true)
}

func decodeJSON(raw string, output any, rejectUnknownFields bool) bool {
	decoder := json.NewDecoder(strings.NewReader(raw))
	if rejectUnknownFields {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(output); err != nil {
		return false
	}
	return decoder.Decode(&struct{}{}) == io.EOF
}

func preflightFailure(err error) error {
	var failure Failure
	if errors.As(err, &failure) && failure.Code == ProviderUnavailable {
		return failure
	}
	return Failure{Code: ProviderIncompatible}
}

func chatResponseFormat(mode StructuredOutputMode, schemaName string, schema map[string]any) map[string]any {
	if mode == JSONObject {
		return map[string]any{"type": "json_object"}
	}
	return map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": schemaName, "strict": true, "schema": schema}}
}

func responseFormat(mode StructuredOutputMode, schemaName string, schema map[string]any) map[string]any {
	if mode == JSONObject {
		return map[string]any{"type": "json_object"}
	}
	return map[string]any{"type": "json_schema", "name": schemaName, "strict": true, "schema": schema}
}

func quizSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"questions": map[string]any{
				"type":     "array",
				"minItems": 1,
				"maxItems": 1,
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"stem":        map[string]any{"type": "string", "minLength": 1, "pattern": "\\S"},
						"explanation": map[string]any{"type": "string", "minLength": 1, "pattern": "\\S"},
						"options": map[string]any{
							"type":     "array",
							"minItems": 4,
							"maxItems": 4,
							"items": map[string]any{
								"type":                 "object",
								"additionalProperties": false,
								"properties": map[string]any{
									"content":   map[string]any{"type": "string", "minLength": 1, "pattern": "\\S"},
									"isCorrect": map[string]any{"type": "boolean"},
								},
								"required": []string{"content", "isCorrect"},
							},
						},
					},
					"required": []string{"stem", "explanation", "options"},
				},
			},
		},
		"required": []string{"questions"},
	}
}

type FakeGenerator struct{}

func (FakeGenerator) Generate(context.Context, string) (Question, error) {
	return Question{Stem: "Cau hoi kiem thu", Explanation: "Dap an kiem thu", Options: []Option{{Content: "A", IsCorrect: true}, {Content: "B"}, {Content: "C"}, {Content: "D"}}}, nil
}
