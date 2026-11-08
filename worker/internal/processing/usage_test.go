package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

const usageTestQuiz = `{\"questions\":[{\"stem\":\"s\",\"explanation\":\"e\",\"options\":[{\"content\":\"A\",\"isCorrect\":true},{\"content\":\"B\",\"isCorrect\":false},{\"content\":\"C\",\"isCorrect\":false},{\"content\":\"D\",\"isCorrect\":false}]}]}`

func usageTestServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(status)
		_, _ = writer.Write([]byte(body))
	}))
}

func TestOpenAIGenerateReportsChatCompletionsUsage(t *testing.T) {
	server := usageTestServer(t, http.StatusOK, `{"choices":[{"finish_reason":"stop","message":{"content":"`+usageTestQuiz+`"}}],"usage":{"prompt_tokens":120,"completion_tokens":30}}`)
	defer server.Close()
	tracker := NewUsageTracker()

	_, err := NewOpenAI("key", server.URL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), tracker), "source")
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	expected := Usage{LLM: []ModelUsage{{Model: "model-a", InputTokens: 120, OutputTokens: 30}}}
	if actual := tracker.Snapshot(); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("usage = %#v, want %#v", actual, expected)
	}
}

func TestOpenAIGenerateReportsResponsesUsage(t *testing.T) {
	server := usageTestServer(t, http.StatusOK, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"`+usageTestQuiz+`"}]}],"usage":{"input_tokens":77,"output_tokens":11}}`)
	defer server.Close()
	profile := ProviderProfile{CapabilityVersion: ResponsesJSONV1, StructuredOutputMode: JSONObject, Transport: Responses}
	tracker := NewUsageTracker()

	_, err := NewOpenAI("key", server.URL, "model-b", profile, time.Second).Generate(WithUsageTracker(context.Background(), tracker), "source")
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	expected := Usage{LLM: []ModelUsage{{Model: "model-b", InputTokens: 77, OutputTokens: 11}}}
	if actual := tracker.Snapshot(); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("usage = %#v, want %#v", actual, expected)
	}
}

func TestOpenAIGenerateKeepsUsageOfAnInvalidButBilledResponse(t *testing.T) {
	server := usageTestServer(t, http.StatusOK, `{"choices":[{"finish_reason":"stop","message":{"content":"not json"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`)
	defer server.Close()
	tracker := NewUsageTracker()

	_, err := NewOpenAI("key", server.URL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), tracker), "source")
	if err == nil {
		t.Fatal("Generate() error = nil, want invalid output")
	}

	expected := Usage{LLM: []ModelUsage{{Model: "model-a", InputTokens: 10, OutputTokens: 5}}}
	if actual := tracker.Snapshot(); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("usage = %#v, want %#v", actual, expected)
	}
}

func TestOpenAIGenerateMarksSuccessWithoutUsageAsUncertain(t *testing.T) {
	server := usageTestServer(t, http.StatusOK, `{"choices":[{"finish_reason":"stop","message":{"content":"`+usageTestQuiz+`"}}]}`)
	defer server.Close()
	tracker := NewUsageTracker()

	if _, err := NewOpenAI("key", server.URL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), tracker), "source"); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	expected := Usage{LLM: []ModelUsage{}, UncertainDispatches: 1}
	if actual := tracker.Snapshot(); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("usage = %#v, want %#v", actual, expected)
	}
}

func TestOpenAIGenerateClassifiesHTTPErrorStatusesByWhetherSpendIsKnown(t *testing.T) {
	tests := map[int]int{
		http.StatusBadRequest:          0,
		http.StatusUnauthorized:        0,
		http.StatusTooManyRequests:     0,
		http.StatusRequestTimeout:      1,
		http.StatusInternalServerError: 1,
		http.StatusBadGateway:          1,
		http.StatusServiceUnavailable:  1,
		http.StatusGatewayTimeout:      1,
	}
	for status, expectedUncertain := range tests {
		server := usageTestServer(t, status, `{}`)
		tracker := NewUsageTracker()
		_, _ = NewOpenAI("key", server.URL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), tracker), "source")
		server.Close()
		if actual := tracker.Snapshot(); actual.UncertainDispatches != expectedUncertain || len(actual.LLM) != 0 {
			t.Fatalf("status %d usage = %#v, want %d uncertain dispatches and nothing spent", status, actual, expectedUncertain)
		}
	}
}

func TestOpenAIGenerateTreatsTransportLossAsUncertain(t *testing.T) {

	closed := usageTestServer(t, http.StatusOK, `{}`)
	closedURL := closed.URL
	closed.Close()
	lostTracker := NewUsageTracker()
	_, _ = NewOpenAI("key", closedURL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), lostTracker), "source")
	if actual := lostTracker.Snapshot(); actual.UncertainDispatches != 1 {
		t.Fatalf("lost-connection usage = %#v, want one uncertain dispatch", actual)
	}
}

func TestMarshalResultAddsUsageBlockOnlyWhenTracked(t *testing.T) {
	tracker := NewUsageTracker()
	tracker.Dispatched()
	tracker.Reported("model-a", 5, 2)
	tracker.Dispatched()
	tracker.Reported("model-a", 1, 1)
	tracker.Dispatched()
	base := func() map[string]any { return map[string]any{"version": 1, "settledCredits": nil} }

	tracked, err := marshalResult(WithUsageTracker(context.Background(), tracker), nil, Job{}, nil, base())
	if err != nil {
		t.Fatal(err)
	}
	untracked, err := marshalResult(context.Background(), nil, Job{}, nil, base())
	if err != nil {
		t.Fatal(err)
	}

	var trackedPayload, untrackedPayload map[string]any
	if err := json.Unmarshal(tracked, &trackedPayload); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(untracked, &untrackedPayload); err != nil {
		t.Fatal(err)
	}
	expectedUsage := map[string]any{"llm": []any{map[string]any{"model": "model-a", "inputTokens": float64(6), "outputTokens": float64(3)}}, "uncertainDispatches": float64(1)}
	if !reflect.DeepEqual(trackedPayload["usage"], expectedUsage) {
		t.Fatalf("tracked usage = %#v, want %#v", trackedPayload["usage"], expectedUsage)
	}
	if _, present := untrackedPayload["usage"]; present {
		t.Fatalf("untracked payload carries usage: %#v", untrackedPayload)
	}
	if _, present := untrackedPayload["settledCredits"]; !present {
		t.Fatalf("existing keys must stay on the wire: %#v", untrackedPayload)
	}
}

func TestMarshalResultKeepsZeroSTTSecondsOnTheWire(t *testing.T) {
	tracker := NewUsageTracker()
	zero := &sttTotals{}
	raw, err := marshalResult(WithUsageTracker(context.Background(), tracker), nil, Job{}, zero, map[string]any{"version": 1})
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if billed, ok := payload.Usage["sttBilledSeconds"]; !ok || billed != float64(0) {
		t.Fatalf("sttBilledSeconds = %#v (present=%t), want explicit 0", billed, ok)
	}
	if uncertain, ok := payload.Usage["sttUncertainSeconds"]; !ok || uncertain != float64(0) {
		t.Fatalf("sttUncertainSeconds = %#v (present=%t), want explicit 0", uncertain, ok)
	}

	untracked, err := marshalResult(context.Background(), nil, Job{}, &sttTotals{billedSeconds: 7, uncertainSeconds: 3}, map[string]any{"version": 1})
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(untracked) || !bytes.Contains(untracked, []byte(`"sttBilledSeconds":7`)) || !bytes.Contains(untracked, []byte(`"sttUncertainSeconds":3`)) || !bytes.Contains(untracked, []byte(`"llm":[]`)) {
		t.Fatalf("STT usage without a tracker must still be reported with an empty llm list: %s", untracked)
	}
}
