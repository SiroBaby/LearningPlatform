package processing

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// verboseJSONVietnamese mirrors the real groq/whisper-large-v3 answer recorded in #160: a Vietnamese language name,
// no usage block, and provider fields the adapter must ignore.
const verboseJSONVietnamese = `{
  "task": "transcribe",
  "language": "Vietnamese",
  "duration": 12.02,
  "text": "Xin chào các bạn, hôm nay chúng ta học về quá trình quang hợp.",
  "segments": [
    {"id": 0, "seek": 0, "start": 0, "end": 5.5, "text": " Xin chào các bạn,", "tokens": [50364, 1234], "avg_logprob": -0.12, "no_speech_prob": 0.01},
    {"id": 1, "seek": 0, "start": 5.5, "end": 12.02, "text": " hôm nay chúng ta học về quá trình quang hợp.", "tokens": [4321], "avg_logprob": -0.1, "no_speech_prob": 0.02}
  ]
}`

type capturedTranscription struct {
	mutex         sync.Mutex
	Method, Path  string
	Authorization string
	Form          string
	Audio         []byte
}

func (captured *capturedTranscription) snapshot() capturedTranscription {
	captured.mutex.Lock()
	defer captured.mutex.Unlock()
	return capturedTranscription{Method: captured.Method, Path: captured.Path, Authorization: captured.Authorization, Form: captured.Form, Audio: captured.Audio}
}

func newTranscribeServer(t *testing.T, status int, body string) (*httptest.Server, *capturedTranscription) {
	t.Helper()
	captured := &capturedTranscription{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, params, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
		reader := multipart.NewReader(request.Body, params["boundary"])
		form := map[string]string{}
		var audio []byte
		for {
			part, err := reader.NextPart()
			if err != nil {
				break
			}
			data, _ := io.ReadAll(part)
			if part.FormName() == "file" {
				audio = data
				form["filename"] = part.FileName()
				form["filetype"] = part.Header.Get("Content-Type")
				continue
			}
			form[part.FormName()] = string(data)
		}
		captured.mutex.Lock()
		captured.Method, captured.Path, captured.Authorization = request.Method, request.URL.Path, request.Header.Get("Authorization")
		captured.Form, captured.Audio = formToString(form), audio
		captured.mutex.Unlock()
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(status)
		_, _ = writer.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, captured
}

func formToString(form map[string]string) string {
	keys := []string{"model", "response_format", "language", "filename", "filetype"}
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+form[key])
	}
	return strings.Join(parts, "&")
}

func transcribeChunk(transcriber *HTTPTranscriber, audio string) ([]TranscriptSegment, error) {
	return transcriber.Transcribe(context.Background(), TranscribeRequest{ChunkIndex: 2, Language: "vi", Audio: strings.NewReader(audio)})
}

func TestHTTPTranscriberSendsMultipartAndDecodesVietnameseSegments(t *testing.T) {
	server, capture := newTranscribeServer(t, http.StatusOK, verboseJSONVietnamese)
	transcriber := NewHTTPTranscriber("secret-key", server.URL+"/v1/", "groq/whisper-large-v3", time.Second)

	segments, err := transcribeChunk(transcriber, "mp3-bytes")
	if err != nil {
		t.Fatalf("Transcribe() error = %v", err)
	}

	expected := []TranscriptSegment{
		{StartSec: 0, EndSec: 5.5, Text: " Xin chào các bạn,"},
		{StartSec: 5.5, EndSec: 12.02, Text: " hôm nay chúng ta học về quá trình quang hợp."},
	}
	if !reflect.DeepEqual(segments, expected) {
		t.Fatalf("segments = %#v, want %#v", segments, expected)
	}
	captured := capture.snapshot()
	if captured.Method != http.MethodPost || captured.Path != "/v1/audio/transcriptions" {
		t.Fatalf("request = %s %s, want POST /v1/audio/transcriptions", captured.Method, captured.Path)
	}
	if captured.Authorization != "Bearer secret-key" {
		t.Fatalf("Authorization header = %q", captured.Authorization)
	}
	wantForm := "model=groq/whisper-large-v3&response_format=verbose_json&language=vi&filename=chunk-2.mp3&filetype=audio/mpeg"
	if captured.Form != wantForm {
		t.Fatalf("multipart form = %q, want %q", captured.Form, wantForm)
	}
	if string(captured.Audio) != "mp3-bytes" {
		t.Fatalf("uploaded audio = %q", captured.Audio)
	}
}

func TestHTTPTranscriberOmitsLanguageWhenNotConfigured(t *testing.T) {
	server, capture := newTranscribeServer(t, http.StatusOK, `{"segments":[]}`)
	transcriber := NewHTTPTranscriber("key", server.URL, "model", time.Second)

	segments, err := transcriber.Transcribe(context.Background(), TranscribeRequest{Audio: strings.NewReader("x")})
	if err != nil || len(segments) != 0 {
		t.Fatalf("Transcribe() = (%#v, %v), want a valid silent chunk", segments, err)
	}
	if form := capture.snapshot().Form; !strings.Contains(form, "language=&") {
		t.Fatalf("language field must be absent, form = %q", form)
	}
}

func TestHTTPTranscriberRejectsInvalidVerboseJSONAsBilledOutput(t *testing.T) {
	tests := map[string]string{
		"not json":            `not json`,
		"segments missing":    `{"text":"hello"}`,
		"segments null":       `{"segments":null}`,
		"start missing":       `{"segments":[{"end":1,"text":"a"}]}`,
		"end missing":         `{"segments":[{"start":0,"text":"a"}]}`,
		"text missing":        `{"segments":[{"start":0,"end":1}]}`,
		"negative start":      `{"segments":[{"start":-1,"end":1,"text":"a"}]}`,
		"reversed times":      `{"segments":[{"start":2,"end":1,"text":"a"}]}`,
		"overflowing time":    `{"segments":[{"start":0,"end":1e999,"text":"a"}]}`,
		"string time":         `{"segments":[{"start":"0","end":1,"text":"a"}]}`,
		"trailing data":       `{"segments":[]} {"segments":[]}`,
		"segment not object":  `{"segments":[1]}`,
		"segments not array":  `{"segments":{}}`,
		"empty body":          ``,
		"array envelope":      `[]`,
		"text of wrong shape": `{"segments":[{"start":0,"end":1,"text":5}]}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			server, _ := newTranscribeServer(t, http.StatusOK, body)
			_, err := transcribeChunk(NewHTTPTranscriber("key", server.URL, "model", time.Second), "audio")

			assertTranscribeError(t, err, TranscribeError{Failure: Failure{Code: TranscriptionOutputInvalid}, Sent: true, Billed: true})
		})
	}
}

func TestHTTPTranscriberClassifiesStatusCodes(t *testing.T) {
	rejected := func(code FailureCode, technical bool) TranscribeError {
		return TranscribeError{Failure: Failure{Code: code, Technical: technical}, Sent: true}
	}
	uncertain := TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}
	tests := map[int]TranscribeError{
		http.StatusBadRequest:            rejected(ProviderIncompatible, false),
		http.StatusUnauthorized:          rejected(ProviderIncompatible, false),
		http.StatusForbidden:             rejected(ProviderIncompatible, false),
		http.StatusNotFound:              rejected(ProviderIncompatible, false),
		http.StatusRequestEntityTooLarge: rejected(ProviderIncompatible, false),
		http.StatusUnsupportedMediaType:  rejected(ProviderIncompatible, false),
		http.StatusUnprocessableEntity:   rejected(ProviderIncompatible, false),
		http.StatusTemporaryRedirect:     rejected(ProviderIncompatible, false),
		http.StatusTooManyRequests:       rejected(ProviderUnavailable, true),
		http.StatusRequestTimeout:        uncertain,
		http.StatusInternalServerError:   uncertain,
		http.StatusBadGateway:            uncertain,
		http.StatusServiceUnavailable:    uncertain,
		http.StatusGatewayTimeout:        uncertain,
	}
	for status, expected := range tests {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server, _ := newTranscribeServer(t, status, `{"error":{"message":"secret provider detail"}}`)
			_, err := transcribeChunk(NewHTTPTranscriber("key", server.URL, "model", time.Second), "audio")

			assertTranscribeError(t, err, expected)
			if strings.Contains(err.Error(), "secret provider detail") {
				t.Fatalf("error leaks provider text: %v", err)
			}
		})
	}
}

func TestHTTPTranscriberDoesNotFollowRedirects(t *testing.T) {
	var targetHits int
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { targetHits++ }))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()

	_, err := transcribeChunk(NewHTTPTranscriber("key", redirector.URL, "model", time.Second), "audio")

	assertTranscribeError(t, err, TranscribeError{Failure: Failure{Code: ProviderIncompatible}, Sent: true})
	if targetHits != 0 {
		t.Fatalf("redirect target received %d requests, want 0 (the key and audio must not be replayed)", targetHits)
	}
}

func TestHTTPTranscriberTimeoutAndTransportErrorsAreUncertain(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		select {
		case <-request.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer slow.Close()
	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	uncertain := TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true}

	_, timeoutErr := transcribeChunk(NewHTTPTranscriber("key", slow.URL, "model", 50*time.Millisecond), "audio")
	_, transportErr := transcribeChunk(NewHTTPTranscriber("key", closedURL, "model", time.Second), "audio")

	assertTranscribeError(t, timeoutErr, uncertain)
	assertTranscribeError(t, transportErr, uncertain)
}

func TestHTTPTranscriberTruncatedSuccessBodyIsUncertain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Length", "1000")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"segments":[`))
	}))
	defer server.Close()

	_, err := transcribeChunk(NewHTTPTranscriber("key", server.URL, "model", time.Second), "audio")

	assertTranscribeError(t, err, TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true})
}

func TestHTTPTranscriberOversizedResponseIsBilledInvalidOutput(t *testing.T) {
	server, _ := newTranscribeServer(t, http.StatusOK, `{"segments":[],"pad":"`+strings.Repeat("a", maxSTTResponseBytes)+`"}`)

	_, err := transcribeChunk(NewHTTPTranscriber("key", server.URL, "model", 5*time.Second), "audio")

	assertTranscribeError(t, err, TranscribeError{Failure: Failure{Code: TranscriptionOutputInvalid}, Sent: true, Billed: true})
}

func TestHTTPTranscriberCancelledContextIsAFailureNotAPanic(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	server, _ := newTranscribeServer(t, http.StatusOK, verboseJSONVietnamese)

	_, err := NewHTTPTranscriber("key", server.URL, "model", time.Second).Transcribe(ctx, TranscribeRequest{Audio: bytes.NewReader([]byte("x"))})

	var transcribeErr TranscribeError
	if !errors.As(err, &transcribeErr) {
		t.Fatalf("error = %v, want TranscribeError", err)
	}
}

func TestTranscribeErrorExposesOnlyTheDomainFailure(t *testing.T) {
	err := error(TranscribeError{Failure: Failure{Code: ProviderUnavailable, Technical: true}, Sent: true, Uncertain: true})
	var failure Failure
	if !errors.As(err, &failure) || failure.Code != ProviderUnavailable || !failure.Technical {
		t.Fatalf("errors.As(Failure) = %#v", failure)
	}
	if err.Error() != string(ProviderUnavailable) {
		t.Fatalf("Error() = %q", err.Error())
	}
}

func TestSTTProviderIdentityIgnoresKeyAndCanonicalisesURL(t *testing.T) {
	first := NewHTTPTranscriber("key-a", "HTTPS://Router.Example/v1/", "groq/whisper-large-v3", time.Second).Identity()
	second := NewHTTPTranscriber("key-b", "https://router.example/v1", "groq/whisper-large-v3", time.Second).Identity()
	otherModel := NewHTTPTranscriber("key-a", "https://router.example/v1", "groq/whisper-large-v3-turbo", time.Second).Identity()
	otherHost := NewHTTPTranscriber("key-a", "https://other.example/v1", "groq/whisper-large-v3", time.Second).Identity()

	if first != second {
		t.Fatalf("identity differs by key or URL spelling: %s vs %s", first, second)
	}
	if first == otherModel || first == otherHost || len(first) != 64 {
		t.Fatalf("identity must change with model and host and be 64 hex chars: %s %s %s", first, otherModel, otherHost)
	}
}

func assertTranscribeError(t *testing.T, err error, expected TranscribeError) {
	t.Helper()
	var actual TranscribeError
	if !errors.As(err, &actual) {
		t.Fatalf("error = %v, want TranscribeError %#v", err, expected)
	}
	if actual != expected {
		t.Fatalf("TranscribeError = %#v, want %#v", actual, expected)
	}
}
