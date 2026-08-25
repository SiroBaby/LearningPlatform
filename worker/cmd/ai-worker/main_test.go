package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
)

func TestBootstrapFailureCodeOfUsesOnlyKnownCodes(t *testing.T) {
	for _, code := range []bootstrapFailureCode{
		bootstrapConfiguration,
		bootstrapProvider,
		bootstrapMigration,
		bootstrapDatabase,
		bootstrapStorage,
		bootstrapConsumer,
		bootstrapHealth,
		bootstrapUnknown,
	} {
		if actual := bootstrapFailureCodeOf(newBootstrapFailure(code)); actual != code {
			t.Errorf("bootstrapFailureCodeOf(%q) = %q, want %q", code, actual, code)
		}
	}

	if actual := bootstrapFailureCodeOf(errors.New("provider response: secret payload")); actual != bootstrapUnknown {
		t.Errorf("bootstrapFailureCodeOf(raw error) = %q, want %q", actual, bootstrapUnknown)
	}
	if actual := bootstrapFailureCodeOf(newBootstrapFailure("secret payload")); actual != bootstrapUnknown {
		t.Errorf("bootstrapFailureCodeOf(unknown code) = %q, want %q", actual, bootstrapUnknown)
	}
}

func TestRunClassifiesConfigurationFailure(t *testing.T) {
	t.Setenv("AI_WORKER_HEALTH_ADDRESS", "")

	if actual := bootstrapFailureCodeOf(run()); actual != bootstrapConfiguration {
		t.Fatalf("run() bootstrap code = %q, want %q", actual, bootstrapConfiguration)
	}
}

func TestStartUnreadyHealthServerKeepsLivenessAvailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release address: %v", err)
	}

	server, _, err := startUnreadyHealthServer(address)
	if err != nil {
		t.Fatalf("startUnreadyHealthServer() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })

	for path, wantStatus := range map[string]int{"/healthz": http.StatusOK, "/readyz": http.StatusServiceUnavailable} {
		response, err := http.Get("http://" + address + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if response.StatusCode != wantStatus {
			t.Fatalf("GET %s status = %d, want %d", path, response.StatusCode, wantStatus)
		}
		_ = response.Body.Close()
	}

}

func TestShutdownWorkerMarksReadinessBeforeCancellationAndClose(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	var observedReadyDuringCancel, observedReadyDuringClose bool
	shutdownWorker(&ready, func() {
		observedReadyDuringCancel = ready.Load()
		cancel()
	}, func() {
		observedReadyDuringClose = ready.Load()
	})
	if observedReadyDuringCancel || observedReadyDuringClose || ready.Load() {
		t.Fatalf("shutdown ordering = cancel:%t close:%t final:%t", observedReadyDuringCancel, observedReadyDuringClose, ready.Load())
	}
}

func TestRunKeepsReadinessFalseUntilQuizPreflightCompletes(t *testing.T) {
	probeStarted := make(chan struct{})
	releaseProbe := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		close(probeStarted)
		<-releaseProbe
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"content":"{\"ready\":true}"}}]}`))
	}))
	defer provider.Close()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve health address: %v", err)
	}
	healthAddress := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release health address: %v", err)
	}

	for key, value := range map[string]string{
		"AI_WORKER_HEALTH_ADDRESS":  healthAddress,
		"DB_HOST":                   "postgres",
		"DB_PORT":                   "5432",
		"DB_USER":                   "learning",
		"DB_PASSWORD":               "password",
		"DB_NAME":                   "learning",
		"OBJECT_STORAGE_ENDPOINT":   "http://localhost:9000",
		"OBJECT_STORAGE_ACCESS_KEY": "access",
		"OBJECT_STORAGE_SECRET_KEY": "secret",
		"OBJECT_STORAGE_BUCKET":     "documents",
		"AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS": "true",
		"NODE_ENV":                      "development",
		"AI_LLM_PROVIDER":               "openai-compatible",
		"OPENAI_API_KEY":                "test-key",
		"OPENAI_BASE_URL":               provider.URL,
		"OPENAI_MODEL":                  "test-model",
		"OPENAI_CAPABILITY_VERSION":     "chat-completions-json-v1",
		"OPENAI_STRUCTURED_OUTPUT_MODE": "json-object",
		"OPENAI_TRANSPORT":              "chat-completions",
		"OPENAI_REQUEST_TIMEOUT_MS":     "1000",
	} {
		t.Setenv(key, value)
	}
	originalArgs := os.Args
	os.Args = []string{"ai-worker"}
	t.Cleanup(func() { os.Args = originalArgs })

	completed := make(chan error, 1)
	go func() { completed <- run() }()
	<-probeStarted

	response, err := http.Get("http://" + healthAddress + "/readyz")
	if err != nil {
		t.Fatalf("GET /readyz: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("GET /readyz status = %d, want %d", response.StatusCode, http.StatusServiceUnavailable)
	}
	_ = response.Body.Close()

	close(releaseProbe)
	if actual := bootstrapFailureCodeOf(<-completed); actual != bootstrapProvider {
		t.Fatalf("run() bootstrap code = %q, want %q", actual, bootstrapProvider)
	}
}
