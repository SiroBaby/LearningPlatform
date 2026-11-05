package processing

import (
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

func TestOpenAIGenerateTreatsProviderRejectionAsUnspentAndTransportLossAsUncertain(t *testing.T) {
	rejecting := usageTestServer(t, http.StatusServiceUnavailable, `{}`)
	defer rejecting.Close()
	rejectedTracker := NewUsageTracker()
	_, _ = NewOpenAI("key", rejecting.URL, "model-a", chatCompletionsJSONProfile(), time.Second).Generate(WithUsageTracker(context.Background(), rejectedTracker), "source")
	if actual := rejectedTracker.Snapshot(); actual.UncertainDispatches != 0 || len(actual.LLM) != 0 {
		t.Fatalf("rejected usage = %#v, want nothing spent and nothing uncertain", actual)
	}

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

	tracked, err := marshalResult(WithUsageTracker(context.Background(), tracker), base())
	if err != nil {
		t.Fatal(err)
	}
	untracked, err := marshalResult(context.Background(), base())
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
