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
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type S3Reader struct {
	client *minio.Client
	bucket string
}

func NewS3Reader(endpoint, accessKey, secretKey, bucket string) (*S3Reader, error) {
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
	client, err := minio.New(server, &minio.Options{Creds: credentials.NewStaticV4(accessKey, secretKey, ""), Secure: secure})
	if err != nil {
		return nil, fmt.Errorf("create object storage client: %w", err)
	}
	return &S3Reader{client: client, bucket: bucket}, nil
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

func classifyObjectReadError(err error) Failure {
	var response minio.ErrorResponse
	if errors.As(err, &response) && (response.Code == "NoSuchKey" || response.Code == "NoSuchObject") {
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
		text := strings.TrimSpace(string(input))
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
		text = strings.TrimSpace(text)
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
func pageText(reader *pdf.Reader, page int) (string, error) {
	document := reader.Page(page)
	if document.V.IsNull() {
		return "", nil
	}
	rows, err := document.GetTextByRow()
	if err != nil {
		return "", err
	}
	var output strings.Builder
	for _, row := range rows {
		for _, word := range row.Content {
			output.WriteString(word.S)
		}
		output.WriteByte('\n')
	}
	return output.String(), nil
}

type OpenAI struct {
	client                 *http.Client
	apiKey, baseURL, model string
}

func NewOpenAI(apiKey, baseURL, model string) *OpenAI {
	return &OpenAI{client: &http.Client{}, apiKey: apiKey, baseURL: strings.TrimRight(baseURL, "/"), model: model}
}
func (provider *OpenAI) Generate(ctx context.Context, source string) (Question, error) {
	payload := map[string]any{"model": provider.model, "max_tokens": 8000, "n": 1, "response_format": map[string]string{"type": "json_object"}, "messages": []map[string]string{{"role": "system", "content": "Return JSON {questions:[{stem,explanation,options:[{content,isCorrect}]}]}. Generate one Vietnamese grounded MCQ."}, {"role": "user", "content": source}}}
	body, err := json.Marshal(payload)
	if err != nil {
		return Question{}, fmt.Errorf("encode provider request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Question{}, fmt.Errorf("create provider request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+provider.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return Question{}, Failure{Code: ProviderUnavailable, Technical: true}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Question{}, Failure{Code: ProviderUnavailable, Technical: true}
	}
	var decoded struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&decoded); err != nil {
		return Question{}, Failure{Code: OutputInvalid, Reason: InvalidEnvelope}
	}
	if len(decoded.Choices) != 1 {
		return Question{}, Failure{Code: OutputInvalid, Reason: ChoiceCount, ChoiceCount: len(decoded.Choices)}
	}
	if decoded.Choices[0].FinishReason == "length" {
		return Question{}, Failure{Code: OutputTruncated, Technical: true}
	}
	return decodeQuiz(decoded.Choices[0].Message.Content)
}
func decodeQuiz(raw string) (Question, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json\n")
	raw = strings.TrimSuffix(raw, "\n```")
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
	if json.Unmarshal([]byte(raw), &output) != nil {
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
	for _, option := range question.Options {
		if strings.TrimSpace(option.Content) == "" {
			return Question{}, Failure{Code: OutputInvalid, Reason: EmptyOption}
		}
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

type FakeGenerator struct{}

func (FakeGenerator) Generate(context.Context, string) (Question, error) {
	return Question{Stem: "Cau hoi kiem thu", Explanation: "Dap an kiem thu", Options: []Option{{Content: "A", IsCorrect: true}, {Content: "B"}, {Content: "C"}, {Content: "D"}}}, nil
}
