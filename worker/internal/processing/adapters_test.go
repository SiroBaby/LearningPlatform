package processing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

func TestExtractTextNormalizesMalformedUTF8PreservingWordBoundaries(t *testing.T) {
	input := string([]byte("valid \xe2\x82\xac invalid\xffbytes"))
	want := "valid \u20ac invalid bytes"

	segments, err := Extract(Source{Type: "TEXT"}, []byte(input))
	if err != nil {
		t.Fatalf("Extract(TEXT) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != want {
		t.Fatalf("Extract(TEXT) = %#v, want one segment with %q", segments, want)
	}
	if !utf8.ValidString(segments[0].Text) {
		t.Fatal("Extract(TEXT) returned invalid UTF-8")
	}
}

func TestExtractTextPreservesValidReplacementCharacter(t *testing.T) {
	input := "before \uFFFD after"

	segments, err := Extract(Source{Type: "TEXT"}, []byte(input))
	if err != nil {
		t.Fatalf("Extract(TEXT) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != input {
		t.Fatalf("Extract(TEXT) = %#v, want one segment with %q", segments, input)
	}
	if !utf8.ValidString(segments[0].Text) {
		t.Fatal("Extract(TEXT) returned invalid UTF-8")
	}
}

func TestExtractPDFPreservesDecodedReplacementCharacter(t *testing.T) {
	segments, err := Extract(Source{Type: "PDF"}, syntheticPDF([]byte{0xff, ' ', 'v', 'a', 'l', 'i', 'd'}))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != "\uFFFD valid" {
		t.Fatalf("Extract(PDF) = %#v, want one segment preserving replacement character", segments)
	}
}

func TestExtractPDFKeepsLiteralSpacesInContentStreamOrder(t *testing.T) {
	stream := []byte("BT\n1 0 0 1 500 100 Tm\n[(First ) 40 (content-stream ) -10 (phrase )] TJ\n1 0 0 1 100 700 Tm\n[(comes ) 40 (before)] TJ\nET\n")

	segments, err := Extract(Source{Type: "PDF"}, syntheticPDFStream(stream))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("Extract(PDF) returned %d segments, want one", len(segments))
	}
	if got, want := segments[0].Text, "First content-stream phrase comes before"; got != want {
		t.Fatalf("Extract(PDF) text = %q, want %q", got, want)
	}
}

func TestExtractPDFPreservesPageLocatorsAndSkipsEmptyPages(t *testing.T) {
	pageOne := []byte("BT\n1 0 0 1 72 700 Tm\n[(Page one)] TJ\nET\n")
	pageThree := []byte("BT\n1 0 0 1 72 700 Tm\n[(Page three)] TJ\nET\n")

	segments, err := Extract(Source{Type: "PDF"}, syntheticPDFPages(pageOne, nil, pageThree))
	if err != nil {
		t.Fatalf("Extract(PDF) error = %v", err)
	}
	if len(segments) != 2 {
		t.Fatalf("Extract(PDF) returned %d segments, want two", len(segments))
	}
	if got, want := segments[0].Text, "Page one"; got != want {
		t.Fatalf("first page text = %q, want %q", got, want)
	}
	if got, want := segments[0].Locator.Page, 1; got != want {
		t.Fatalf("first page locator = %d, want %d", got, want)
	}
	if got, want := segments[1].Text, "Page three"; got != want {
		t.Fatalf("third page text = %q, want %q", got, want)
	}
	if got, want := segments[1].Locator.Page, 3; got != want {
		t.Fatalf("third page locator = %d, want %d", got, want)
	}
}

func syntheticPDF(content []byte) []byte {
	stream := append([]byte("BT\n1 0 0 1 10 10 Tm\n("), content...)
	stream = append(stream, []byte(") Tj\nET\n")...)
	return syntheticPDFStream(stream)
}

func syntheticPDFStream(stream []byte) []byte {
	return syntheticPDFPages(stream)
}

func syntheticPDFPages(streams ...[]byte) []byte {
	if len(streams) == 0 {
		streams = [][]byte{nil}
	}

	pageObjects := make([][]byte, 0, len(streams))
	contentObjects := make([][]byte, 0, len(streams))
	for index, stream := range streams {
		contentNumber := 3 + len(streams) + index
		pageObjects = append(pageObjects, []byte(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents %d 0 R >>", contentNumber)))
		contentObjects = append(contentObjects, []byte(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream)))
	}

	kids := make([]string, 0, len(pageObjects))
	for index := range pageObjects {
		kids = append(kids, fmt.Sprintf("%d 0 R", 3+index))
	}
	objects := [][]byte{
		[]byte("<< /Type /Catalog /Pages 2 0 R >>"),
		[]byte(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pageObjects))),
	}
	objects = append(objects, pageObjects...)
	objects = append(objects, contentObjects...)

	var document bytes.Buffer
	document.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects)+1)
	for index, object := range objects {
		number := index + 1
		offsets[number] = document.Len()
		fmt.Fprintf(&document, "%d 0 obj\n", number)
		document.Write(object)
		document.WriteString("\nendobj\n")
	}
	xrefOffset := document.Len()
	fmt.Fprintf(&document, "xref\n0 %d\n", len(offsets))
	document.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&document, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&document, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xrefOffset)
	return document.Bytes()
}

type recordedOutcome struct {
	inputTokens, outputTokens int64
	status                    UsageStatus
}

// memoryRecorder is an in-memory UsageRecorder that keeps what the adapter wrote and when.
type memoryRecorder struct {
	mutex       sync.Mutex
	dispatchErr error
	keys        []string
	models      []string
	outcomes    map[string]recordedOutcome
}

func (recorder *memoryRecorder) RecordDispatch(_ context.Context, _ Job, key, model string) error {
	recorder.mutex.Lock()
	defer recorder.mutex.Unlock()
	if recorder.dispatchErr != nil {
		return recorder.dispatchErr
	}
	recorder.keys = append(recorder.keys, key)
	recorder.models = append(recorder.models, model)
	return nil
}

func (recorder *memoryRecorder) RecordOutcome(_ context.Context, key string, input, output int64, status UsageStatus) error {
	recorder.mutex.Lock()
	defer recorder.mutex.Unlock()
	if recorder.outcomes == nil {
		recorder.outcomes = map[string]recordedOutcome{}
	}
	recorder.outcomes[key] = recordedOutcome{inputTokens: input, outputTokens: output, status: status}
	return nil
}

func usageContext(recorder UsageRecorder) context.Context {
	attempt := 2
	job := Job{ID: "job-1", Attempt: 3, ProcessingAttempt: &attempt}
	return WithUsageRecorder(context.Background(), recorder, job)
}

func TestOpenAIDoesNotDispatchWhenTheDispatchRecordCannotBeStored(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	recorder := &memoryRecorder{dispatchErr: errors.New("database down")}

	_, err := NewOpenAI("key", server.URL, "model", chatCompletionsJSONProfile(), time.Second).Generate(usageContext(recorder), "source")

	assertFailure(t, err, ProviderUnavailable, true)
	if calls.Load() != 0 {
		t.Fatalf("provider calls = %d, want none without a dispatch record", calls.Load())
	}
}

func TestOpenAIResolvesOrKeepsUncertainTheDispatchRecord(t *testing.T) {
	const quiz = `{"choices":[{"finish_reason":"stop","message":{"content":"{\"questions\":[]}"}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}`
	cases := []struct {
		name            string
		status          int
		body            string
		sleep           time.Duration
		expectedOutcome *recordedOutcome
	}{
		{name: "usage reported", status: 200, body: quiz, expectedOutcome: &recordedOutcome{11, 7, UsageAvailable}},
		{name: "2xx without usage", status: 200, body: `{"choices":[]}`},
		{name: "definitive 400", status: 400, body: `{}`, expectedOutcome: &recordedOutcome{0, 0, UsageAvailable}},
		{name: "definitive 429", status: 429, body: `{}`, expectedOutcome: &recordedOutcome{0, 0, UsageAvailable}},
		{name: "408 stays uncertain", status: 408, body: `{}`},
		{name: "500 stays uncertain", status: 500, body: `{}`},
		{name: "timeout stays uncertain", status: 200, body: quiz, sleep: 300 * time.Millisecond},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				time.Sleep(testCase.sleep)
				writer.WriteHeader(testCase.status)
				_, _ = writer.Write([]byte(testCase.body))
			}))
			defer server.Close()
			recorder := &memoryRecorder{}

			_, _ = NewOpenAI("key", server.URL, "model-x", chatCompletionsJSONProfile(), 100*time.Millisecond).Generate(usageContext(recorder), "source")

			if len(recorder.keys) != 1 || recorder.keys[0] != "go-llm:job-1:2:3:1" || recorder.models[0] != "model-x" {
				t.Fatalf("dispatch records = %v models %v", recorder.keys, recorder.models)
			}
			actual, resolved := recorder.outcomes[recorder.keys[0]]
			if testCase.expectedOutcome == nil && resolved {
				t.Fatalf("outcome = %#v, want the record to stay UNAVAILABLE", actual)
			}
			if testCase.expectedOutcome != nil && actual != *testCase.expectedOutcome {
				t.Fatalf("outcome = %#v (resolved=%t), want %#v", actual, resolved, *testCase.expectedOutcome)
			}
		})
	}
}

func TestUsageRecorderIsOffWithoutAProcessingAttempt(t *testing.T) {
	recorder := &memoryRecorder{}
	ctx := WithUsageRecorder(context.Background(), recorder, Job{ID: "job-1", Attempt: 1})

	dispatch, err := beginLLMDispatch(ctx, "model")

	if dispatch != nil || err != nil || len(recorder.keys) != 0 {
		t.Fatalf("dispatch = %#v, err = %v, keys = %v, want no durable record", dispatch, err, recorder.keys)
	}
}

func TestLLMRequestKeysAreUniquePerClaimAndSequence(t *testing.T) {
	recorder := &memoryRecorder{}
	attempt := 4
	for claim := 1; claim <= 2; claim++ {
		ctx := WithUsageRecorder(context.Background(), recorder, Job{ID: "job-1", Attempt: claim, ProcessingAttempt: &attempt})
		for range 2 {
			if _, err := beginLLMDispatch(ctx, "model"); err != nil {
				t.Fatal(err)
			}
		}
	}

	expected := []string{"go-llm:job-1:4:1:1", "go-llm:job-1:4:1:2", "go-llm:job-1:4:2:1", "go-llm:job-1:4:2:2"}
	if !reflect.DeepEqual(recorder.keys, expected) {
		t.Fatalf("keys = %v, want %v", recorder.keys, expected)
	}
}
