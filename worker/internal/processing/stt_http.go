package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

const (
	// STTCapabilityVersion names the wire contract HTTPTranscriber speaks. It is declared, not inferred from the model
	// name, and takes part in the checkpoint identity so a contract change never reuses an old transcript.
	STTCapabilityVersion = "audio-transcriptions-verbose-json-v1"
	// sttProviderType is the provider kind part of the checkpoint identity.
	sttProviderType = "openai-compatible-transcriptions"
	// MaxSTTChunkBytes bounds one audio chunk read into memory and sent to the provider (provider limit ~25 MiB).
	MaxSTTChunkBytes = 25 * 1024 * 1024
	// maxSTTResponseBytes bounds a verbose_json body (segments with token arrays for a 10 minute chunk stay far below).
	maxSTTResponseBytes = 8 * 1024 * 1024
	// maxSTTSegmentsPerChunk rejects absurd provider output before it reaches the stitcher.
	maxSTTSegmentsPerChunk = 20000
	sttDefaultTimeout      = 2 * time.Minute
)

// TranscribeError is a classified speech-to-text failure. Failure carries the stable domain code; the flags describe
// what the call may have cost so the caller can account for it without guessing (ADR-0022, ADR-0032):
//   - Sent: the request left the worker.
//   - Billed: the provider answered 2xx, so the audio was processed even if the body is unusable.
//   - Uncertain: sent without a definite answer (timeout, transport loss, 408/5xx); the spend is unknown.
//
// A definite rejection (other 4xx, 429) is Sent without Billed or Uncertain: nothing was spent.
type TranscribeError struct {
	Failure   Failure
	Sent      bool
	Billed    bool
	Uncertain bool
}

func (err TranscribeError) Error() string { return string(err.Failure.Code) }

// As lets errors.As(err, *Failure) see the domain failure without exposing provider text.
func (err TranscribeError) As(target any) bool {
	value, ok := target.(*Failure)
	if !ok {
		return false
	}
	*value = err.Failure
	return true
}

// HTTPTranscriber calls an OpenAI-compatible POST {baseURL}/audio/transcriptions with response_format=verbose_json.
// It never retries and never falls back to another model or endpoint: the first request may already have been paid.
type HTTPTranscriber struct {
	client  *http.Client
	apiKey  string
	baseURL string
	model   string
	timeout time.Duration
}

// NewHTTPTranscriber builds a transcriber. A non-positive timeout uses a 2 minute default. Redirects are not followed
// so the API key and audio are never replayed to a host the operator did not configure.
func NewHTTPTranscriber(apiKey, baseURL, model string, timeout time.Duration) *HTTPTranscriber {
	if timeout <= 0 {
		timeout = sttDefaultTimeout
	}
	client := &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return &HTTPTranscriber{client: client, apiKey: apiKey, baseURL: strings.TrimRight(baseURL, "/"), model: model, timeout: timeout}
}

// Identity returns the checkpoint identity (ADR-0032): sha256 over provider type, canonical base URL, model and
// capability version. The API key is deliberately excluded.
func (transcriber *HTTPTranscriber) Identity() string {
	return STTProviderIdentity(sttProviderType, transcriber.baseURL, transcriber.model, STTCapabilityVersion)
}

// Transcribe sends one chunk and returns its segments with times relative to the chunk file.
func (transcriber *HTTPTranscriber) Transcribe(ctx context.Context, request TranscribeRequest) ([]TranscriptSegment, error) {
	body, contentType, err := transcriber.encode(request)
	if err != nil {
		return nil, TranscribeError{Failure: Failure{Code: ProcessingFailed, Technical: true}}
	}
	requestContext, cancel := context.WithTimeout(ctx, transcriber.timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(requestContext, http.MethodPost, transcriber.baseURL+"/audio/transcriptions", bytes.NewReader(body))
	if err != nil {
		return nil, TranscribeError{Failure: Failure{Code: ProcessingFailed, Technical: true}}
	}
	httpRequest.Header.Set("Authorization", "Bearer "+transcriber.apiKey)
	httpRequest.Header.Set("Content-Type", contentType)
	httpRequest.Header.Set("Accept", "application/json")
	response, err := transcriber.client.Do(httpRequest)
	if err != nil {
		// Whether the provider saw the audio is unknown after any transport error.
		return nil, TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, classifyTranscribeStatus(response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxSTTResponseBytes+1))
	if err != nil {
		// The body was cut after a 2xx header: the provider processed the audio but the outcome is unknown.
		return nil, TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}
	}
	if int64(len(raw)) > maxSTTResponseBytes {
		return nil, TranscribeError{Failure: Failure{Code: TranscriptionOutputInvalid}, Sent: true, Billed: true}
	}
	segments, err := decodeVerboseJSON(raw)
	if err != nil {
		return nil, TranscribeError{Failure: Failure{Code: TranscriptionOutputInvalid}, Sent: true, Billed: true}
	}
	return segments, nil
}

func (transcriber *HTTPTranscriber) encode(request TranscribeRequest) ([]byte, string, error) {
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	fields := [][2]string{{"model", transcriber.model}, {"response_format", "verbose_json"}}
	if request.Language != "" {
		fields = append(fields, [2]string{"language", request.Language})
	}
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, "", err
		}
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="chunk-%d.mp3"`, request.ChunkIndex))
	header.Set("Content-Type", "audio/mpeg")
	part, err := writer.CreatePart(header)
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, request.Audio); err != nil {
		return nil, "", err
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return buffer.Bytes(), writer.FormDataContentType(), nil
}

// classifyTranscribeStatus maps a non-2xx status. 408 and 5xx can come from a proxy after the provider already
// processed the audio, so they stay uncertain and retryable. 429, 401, 403, 404 and redirects are definite rejections
// that cost nothing; they are operator-side conditions (rotated key, wrong base URL or /v1 path, moved endpoint), so
// they are technical and retryable instead of blaming the user's file. Other 4xx (400, 413, 415, 422, ...) say the
// request itself is unacceptable: terminal business PROVIDER_INCOMPATIBLE.
func classifyTranscribeStatus(status int) error {
	switch {
	case status == http.StatusRequestTimeout || status >= http.StatusInternalServerError:
		return TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}
	case status == http.StatusTooManyRequests || status == http.StatusUnauthorized || status == http.StatusForbidden ||
		status == http.StatusNotFound || (status >= 300 && status < 400):
		return TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true}
	default:
		return TranscribeError{Failure: Failure{Code: ProviderIncompatible}, Sent: true}
	}
}

var errInvalidVerboseJSON = errors.New("invalid verbose_json transcription")

// decodeVerboseJSON validates the response strictly: `segments` must be present, and every segment needs finite,
// ordered, non-negative times and a string text. Unknown fields (language, duration, tokens, ...) are ignored.
func decodeVerboseJSON(raw []byte) ([]TranscriptSegment, error) {
	var decoded struct {
		Segments *[]struct {
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
			Text  *string  `json:"text"`
		} `json:"segments"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&decoded); err != nil || decoded.Segments == nil || decoder.Decode(&struct{}{}) != io.EOF {
		return nil, errInvalidVerboseJSON
	}
	if len(*decoded.Segments) > maxSTTSegmentsPerChunk {
		return nil, errInvalidVerboseJSON
	}
	segments := make([]TranscriptSegment, 0, len(*decoded.Segments))
	for _, item := range *decoded.Segments {
		if item.Start == nil || item.End == nil || item.Text == nil {
			return nil, errInvalidVerboseJSON
		}
		start, end := *item.Start, *item.End
		if !isFinite(start) || !isFinite(end) || start < 0 || end < start {
			return nil, errInvalidVerboseJSON
		}
		segments = append(segments, TranscriptSegment{StartSec: start, EndSec: end, Text: *item.Text})
	}
	return segments, nil
}
