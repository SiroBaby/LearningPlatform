package consumer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

func TestBootstrapIsReadyOnlyWhileItsLifecycleIsStarted(t *testing.T) {
	t.Parallel()

	bootstrap := NewBootstrap()
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should not be ready before Start")
	}
	if err := bootstrap.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !bootstrap.Ready() {
		t.Fatal("Bootstrap should be ready after Start")
	}
	bootstrap.Close()
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should not be ready after Close")
	}
}

func TestProcessOnePersistsChunksGeneratesAndCompletes(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}, source: processing.Source{StorageRef: "document.txt", Type: "TEXT"}}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{})
	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.replaced || !store.completed {
		t.Fatalf("store state = %#v", store)
	}
}

func TestProcessOneDoesNotRetryWhenJobFenceIsLost(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source:      processing.Source{StorageRef: "document.txt", Type: "TEXT"},
		persistErr:  processing.ErrJobFenceLost,
		retryResult: processing.RetryResult{Scheduled: true},
	}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{})
	if err := worker.processOne(context.Background()); !errors.Is(err, processing.ErrJobFenceLost) {
		t.Fatalf("processOne() error = %v, want ErrJobFenceLost", err)
	}
	if store.retried {
		t.Fatal("fenced result must not be retried")
	}
}

func TestProcessOneTreatsFalseNilPersistenceAsFenceLoss(t *testing.T) {
	t.Parallel()
	persisted := false
	store := &storeMock{
		job:           &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source:        processing.Source{StorageRef: "document.txt", Type: "TEXT"},
		persistResult: &persisted,
		retryResult:   processing.RetryResult{Scheduled: true},
	}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{})
	if err := worker.processOne(context.Background()); !errors.Is(err, processing.ErrJobFenceLost) {
		t.Fatalf("processOne() error = %v, want ErrJobFenceLost", err)
	}
	if store.retried {
		t.Fatal("fenced result must not be retried")
	}
}

func TestDispatchLogsFencedInsteadOfCompleted(t *testing.T) {
	output := make(chan []byte, 8)
	store := &storeMock{
		job:        &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source:     processing.Source{StorageRef: "document.txt", Type: "TEXT"},
		persistErr: processing.ErrJobFenceLost,
	}
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
	worker.slots = make(chan struct{}, 1)
	worked, err := worker.dispatch(context.Background())
	if err != nil || !worked {
		t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
	}
	var logs strings.Builder
	deadline := time.After(time.Second)
	for !strings.Contains(logs.String(), "worker.processing.fenced") {
		select {
		case entry := <-output:
			logs.Write(entry)
		case <-deadline:
			t.Fatalf("fenced log not emitted: %s", logs.String())
		}
	}
	if strings.Contains(logs.String(), "worker.processing.completed") {
		t.Fatalf("fenced job was logged as completed: %s", logs.String())
	}
}

func TestDispatchDoesNotLogCompletedAfterDurableRetryOutcome(t *testing.T) {
	for name, test := range map[string]struct {
		retryResult processing.RetryResult
		event       string
	}{
		"scheduled": {retryResult: processing.RetryResult{Scheduled: true}, event: "worker.processing.retry.scheduled"},
		"finalized": {retryResult: processing.RetryResult{Finalized: true}, event: "worker.processing.failed"},
	} {
		t.Run(name, func(t *testing.T) {
			output := make(chan []byte, 8)
			store := &storeMock{
				job:         &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
				source:      processing.Source{StorageRef: "document.txt", Type: "TEXT"},
				retryResult: test.retryResult,
			}
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
			worker.slots = make(chan struct{}, 1)
			worked, err := worker.dispatch(context.Background())
			if err != nil || !worked {
				t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
			}

			var logs strings.Builder
			deadline := time.After(time.Second)
			for !strings.Contains(logs.String(), test.event) {
				select {
				case entry := <-output:
					logs.Write(entry)
				case <-deadline:
					t.Fatalf("retry log not emitted: %s", logs.String())
				}
			}
			worker.workers.Wait()
			for {
				select {
				case entry := <-output:
					logs.Write(entry)
				default:
					if strings.Contains(logs.String(), "worker.processing.completed") {
						t.Fatalf("retrying job was logged as completed: %s", logs.String())
					}
					return
				}
			}
		})
	}
}

func TestDispatchDoesNotLogCompletedAfterPersistenceRetryOutcome(t *testing.T) {
	for name, test := range map[string]struct {
		retryResult processing.RetryResult
		event       string
	}{
		"scheduled": {retryResult: processing.RetryResult{Scheduled: true}, event: "worker.processing.retry.scheduled"},
		"finalized": {retryResult: processing.RetryResult{Finalized: true}, event: "worker.processing.failed"},
	} {
		t.Run(name, func(t *testing.T) {
			output := make(chan []byte, 8)
			store := &storeMock{
				job:         &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
				source:      processing.Source{StorageRef: "document.txt", Type: "TEXT"},
				persistErr:  errors.New("persistence failed after generation"),
				retryResult: test.retryResult,
			}
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
			worker.slots = make(chan struct{}, 1)
			worked, err := worker.dispatch(context.Background())
			if err != nil || !worked {
				t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
			}

			var logs strings.Builder
			deadline := time.After(time.Second)
			for !strings.Contains(logs.String(), test.event) {
				select {
				case entry := <-output:
					logs.Write(entry)
				case <-deadline:
					t.Fatalf("retry log not emitted: %s", logs.String())
				}
			}
			worker.workers.Wait()
			for {
				select {
				case entry := <-output:
					logs.Write(entry)
				default:
					if strings.Contains(logs.String(), "worker.processing.completed") {
						t.Fatalf("post-generation retry was logged as completed: %s", logs.String())
					}
					return
				}
			}
		})
	}
}

func TestDispatchLogsCompletedAfterPersistedResult(t *testing.T) {
	output := make(chan []byte, 8)
	store := &storeMock{
		job:    &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source: processing.Source{StorageRef: "document.txt", Type: "TEXT"},
	}
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
	worker.slots = make(chan struct{}, 1)
	worked, err := worker.dispatch(context.Background())
	if err != nil || !worked {
		t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
	}

	var logs strings.Builder
	deadline := time.After(time.Second)
	for !strings.Contains(logs.String(), "worker.processing.completed") {
		select {
		case entry := <-output:
			logs.Write(entry)
		case <-deadline:
			t.Fatalf("completed log not emitted: %s", logs.String())
		}
	}
	worker.workers.Wait()
	if !store.completed {
		t.Fatal("completed lifecycle event was emitted without durable completion")
	}
}

func TestDispatchLogsFailureWhenFinalizationPersistenceFails(t *testing.T) {
	output := make(chan []byte, 8)
	store := &storeMock{
		job:        &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source:     processing.Source{StorageRef: "document.txt", Type: "TEXT"},
		failErr:    errors.New("finalization persistence failed"),
		failResult: boolPtr(false),
	}
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid}}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
	worker.slots = make(chan struct{}, 1)
	worked, err := worker.dispatch(context.Background())
	if err != nil || !worked {
		t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
	}

	var logs strings.Builder
	deadline := time.After(time.Second)
	for !strings.Contains(logs.String(), `"event":"worker.processing.failed"`) {
		select {
		case entry := <-output:
			logs.Write(entry)
		case <-deadline:
			t.Fatalf("failed lifecycle log not emitted: %s", logs.String())
		}
	}
	worker.workers.Wait()
	if !store.failed {
		t.Fatal("finalization was not attempted")
	}
	if strings.Contains(logs.String(), "worker.processing.completed") {
		t.Fatalf("failed finalization was logged as completed: %s", logs.String())
	}
}

func TestProcessOneTreatsFalseNilFinalizationAsFenceLoss(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:        &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
		source:     processing.Source{StorageRef: "document.txt", Type: "TEXT"},
		failResult: boolPtr(false),
	}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid}})
	if err := worker.processOne(context.Background()); !errors.Is(err, processing.ErrJobFenceLost) {
		t.Fatalf("processOne() error = %v, want ErrJobFenceLost", err)
	}
}

func TestDispatchTreatsMalformedRetryResultAsFailure(t *testing.T) {
	for name, retryResult := range map[string]processing.RetryResult{
		"neither": {},
		"both":    {Scheduled: true, Finalized: true},
	} {
		t.Run(name, func(t *testing.T) {
			output := make(chan []byte, 8)
			store := &storeMock{
				job:         &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1},
				source:      processing.Source{StorageRef: "document.txt", Type: "TEXT"},
				persistErr:  errors.New("persistence failed after generation"),
				retryResult: retryResult,
			}
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(logChannelWriter{output: output}, nil)))
			worker.slots = make(chan struct{}, 1)
			worked, err := worker.dispatch(context.Background())
			if err != nil || !worked {
				t.Fatalf("dispatch() = (%t, %v), want (true, nil)", worked, err)
			}

			var logs strings.Builder
			deadline := time.After(time.Second)
			for !strings.Contains(logs.String(), `"event":"worker.processing.failed"`) {
				select {
				case entry := <-output:
					logs.Write(entry)
				case <-deadline:
					t.Fatalf("failed lifecycle log not emitted: %s", logs.String())
				}
			}
			worker.workers.Wait()
			if !strings.Contains(logs.String(), `"event":"worker.processing.retry.contract_violation"`) {
				t.Fatalf("contract violation event not emitted: %s", logs.String())
			}
			if strings.Contains(logs.String(), "worker.processing.completed") {
				t.Fatalf("malformed retry result was logged as completed: %s", logs.String())
			}
		})
	}
}

func TestProcessOneRequeuesTechnicalFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{job: &processing.Job{ID: "job", DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}, source: processing.Source{StorageRef: "document.txt", Type: "TEXT"}, retryResult: processing.RetryResult{Scheduled: true}}
	worker := New(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}})
	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.retried || store.completed {
		t.Fatalf("store state = %#v", store)
	}
}

func TestProcessOneHandlesPersistenceFailureWithSafeRetryLog(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		persistErr:  errors.New("raw provider/database failure"),
		retryResult: processing.RetryResult{Scheduled: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}
	if !store.retried || store.completed {
		t.Fatalf("store state = %#v", store)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "WARN" || entry["event"] != "worker.processing.retry.scheduled" || entry["phase"] != "retry" || entry["attempt"] != float64(2) || entry["category"] != string(processing.ProcessingFailed) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "raw provider/database failure") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneDoesNotRetryAmbiguousPersistenceFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:        &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 3},
		source:     processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		persisted:  true,
		persistErr: errors.New("commit outcome unavailable"),
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err == nil {
		t.Fatal("processOne() error = nil, want persistence error")
	}
	if store.retried {
		t.Fatal("ambiguous persistence failure must not be retried")
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.persistence_ambiguous" || entry["phase"] != "persist" || entry["attempt"] != float64(3) || entry["category"] != string(processing.ProcessingFailed) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "commit outcome unavailable") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneLogsAmbiguousRetryFinalization(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 4},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Finalized: true},
		retryErr:    errors.New("commit outcome unavailable"),
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err == nil {
		t.Fatal("processOne() error = nil, want persistence error")
	}
	if !store.retried {
		t.Fatal("technical failure was not sent to retry persistence")
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.persistence_ambiguous" || entry["phase"] != "retry" || entry["attempt"] != float64(4) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "commit outcome unavailable") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneLogsAmbiguousScheduledRetryCommit(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 1},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Scheduled: true},
		retryErr:    errors.New("commit outcome unavailable"),
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err == nil {
		t.Fatal("processOne() error = nil, want persistence error")
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.persistence_ambiguous" || entry["phase"] != "retry" || entry["attempt"] != float64(1) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "commit outcome unavailable") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneLogsAmbiguousFinalization(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:        &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source:     processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		failErr:    errors.New("commit outcome unavailable"),
		failResult: boolPtr(true),
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err == nil {
		t.Fatal("processOne() error = nil, want persistence error")
	}
	if !store.failed {
		t.Fatal("non-technical failure was not sent to finalization persistence")
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.persistence_ambiguous" || entry["phase"] != "finalize" || entry["attempt"] != float64(2) || entry["category"] != string(processing.OutputInvalid) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
	if strings.Contains(output.String(), "commit outcome unavailable") {
		t.Fatalf("log exposed persistence error: %s", output.String())
	}
}

func TestProcessOneLogsMalformedRetryResultMetadata(t *testing.T) {
	for name, retryResult := range map[string]processing.RetryResult{
		"neither": {},
		"both":    {Scheduled: true, Finalized: true},
	} {
		t.Run(name, func(t *testing.T) {
			store := &storeMock{
				job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
				source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
				retryResult: retryResult,
			}
			var output bytes.Buffer
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

			if err := worker.processOne(context.Background()); err == nil {
				t.Fatal("processOne() error = nil, want malformed retry result error")
			}

			entry := decodeLogEntry(t, output.String())
			if entry["level"] != "ERROR" || entry["event"] != "worker.processing.retry.contract_violation" || entry["phase"] != "retry" || entry["attempt"] != float64(2) || entry["category"] != string(processing.ProviderUnavailable) {
				t.Fatalf("log entry = %#v", entry)
			}
			assertLogDoesNotExposeJobData(t, output.String())
		})
	}
}

func TestProcessOneLogsSafeProviderRetry(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Scheduled: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Reason: processing.EmptyStem, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "WARN" || entry["event"] != "worker.processing.retry.scheduled" || entry["phase"] != "retry" || entry["attempt"] != float64(2) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	if _, present := entry["reason"]; present {
		t.Fatalf("log entry has misleading parser reason: %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func TestProcessOneLogsSafeParserReason(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:    &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
		source: processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid, Reason: processing.EmptyStem}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.failed" || entry["phase"] != "finalize" || entry["attempt"] != float64(2) || entry["category"] != string(processing.OutputInvalid) || entry["reason"] != string(processing.EmptyStem) {
		t.Fatalf("log entry = %#v", entry)
	}
	if _, present := entry["choice_count"]; present {
		t.Fatalf("log entry has irrelevant choice count: %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func TestProcessOneLogsChoiceCountOnlyForChoiceCountFailures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		choiceCount int
	}{
		{name: "zero choices", choiceCount: 0},
		{name: "multiple choices", choiceCount: 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &storeMock{
				job:    &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 2},
				source: processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
			}
			var output bytes.Buffer
			worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.OutputInvalid, Reason: processing.ChoiceCount, ChoiceCount: test.choiceCount}}, slog.New(slog.NewJSONHandler(&output, nil)))

			if err := worker.processOne(context.Background()); err != nil {
				t.Fatalf("processOne() error = %v", err)
			}

			entry := decodeLogEntry(t, output.String())
			if entry["reason"] != string(processing.ChoiceCount) || entry["choice_count"] != float64(test.choiceCount) {
				t.Fatalf("log entry = %#v", entry)
			}
			assertLogDoesNotExposeJobData(t, output.String())
		})
	}
}

func TestProcessOneLogsSafeDLQFailure(t *testing.T) {
	t.Parallel()
	store := &storeMock{
		job:         &processing.Job{ID: "job-secret", DocumentID: "document-secret", OwnerID: "owner-secret", LeaseID: "lease-secret", Attempt: 4},
		source:      processing.Source{StorageRef: "owners/secret-document.txt", Type: "TEXT"},
		retryResult: processing.RetryResult{Finalized: true},
	}
	var output bytes.Buffer
	worker := newWithLogger(store, objectMock{bytes: []byte("document text")}, generatorMock{err: processing.Failure{Code: processing.ProviderUnavailable, Technical: true}}, slog.New(slog.NewJSONHandler(&output, nil)))

	if err := worker.processOne(context.Background()); err != nil {
		t.Fatalf("processOne() error = %v", err)
	}

	entry := decodeLogEntry(t, output.String())
	if entry["level"] != "ERROR" || entry["event"] != "worker.processing.failed" || entry["phase"] != "dlq" || entry["attempt"] != float64(4) || entry["category"] != string(processing.ProviderUnavailable) {
		t.Fatalf("log entry = %#v", entry)
	}
	assertLogDoesNotExposeJobData(t, output.String())
}

func TestLifecycleLogIncludesQueueAgeAndProcessingLatency(t *testing.T) {
	var output bytes.Buffer
	worker := &Bootstrap{
		logger:  slog.New(slog.NewJSONHandler(&output, nil)),
		options: normalizeOptions(Options{Concurrency: 2}),
	}
	worker.logLifecycle("worker.processing.completed", processing.Job{ID: "job", Attempt: 1, CreatedAt: time.Now().Add(-time.Second)}, 1, 25*time.Millisecond)
	entry := decodeLogEntry(t, output.String())
	if _, ok := entry["queue_age_ms"]; !ok {
		t.Fatalf("lifecycle log missing queue age: %#v", entry)
	}
	if got := entry["duration_ms"]; got != float64(25) {
		t.Fatalf("lifecycle duration = %#v, want 25", got)
	}
}

func decodeLogEntry(t *testing.T, output string) map[string]any {
	t.Helper()
	var entry map[string]any
	if err := json.Unmarshal([]byte(output), &entry); err != nil {
		t.Fatalf("decode structured log %q: %v", output, err)
	}
	return entry
}

func assertLogDoesNotExposeJobData(t *testing.T, output string) {
	t.Helper()
	for _, forbidden := range []string{"job-secret", "document-secret", "owner-secret", "lease-secret", "owners/secret-document.txt", "document text"} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("log leaked %q: %s", forbidden, output)
		}
	}
}

type storeMock struct {
	job                                  *processing.Job
	source                               processing.Source
	retryResult                          processing.RetryResult
	retryErr                             error
	persistErr                           error
	persistResult                        *bool
	persisted                            bool
	failErr                              error
	failResult                           *bool
	replaced, completed, failed, retried bool
}

func (store *storeMock) Claim(context.Context) (*processing.Job, error) { return store.job, nil }
func (store *storeMock) Source(context.Context, processing.Job) (processing.Source, error) {
	return store.source, nil
}
func (store *storeMock) PersistAndComplete(_ context.Context, _ processing.Job, chunks []processing.Chunk, _ []processing.Question) (bool, error) {
	store.replaced = len(chunks) > 0
	persisted := store.persisted || store.persistErr == nil
	if store.persistResult != nil {
		persisted = *store.persistResult
	}
	store.completed = persisted && store.persistErr == nil
	return persisted, store.persistErr
}
func (store *storeMock) Fail(context.Context, processing.Job, processing.Failure) (bool, error) {
	store.failed = true
	finalized := true
	if store.failResult != nil {
		finalized = *store.failResult
	}
	return finalized, store.failErr
}
func (store *storeMock) Retry(context.Context, processing.Job, processing.FailureCode) (processing.RetryResult, error) {
	store.retried = true
	return store.retryResult, store.retryErr
}

func boolPtr(value bool) *bool { return &value }

type objectMock struct{ bytes []byte }

type logChannelWriter struct{ output chan<- []byte }

func (writer logChannelWriter) Write(value []byte) (int, error) {
	writer.output <- append([]byte(nil), value...)
	return len(value), nil
}

func (object objectMock) Read(context.Context, string, int64) ([]byte, error) {
	return object.bytes, nil
}

type generatorMock struct{ err error }

func (generator generatorMock) Generate(context.Context, string) (processing.Question, error) {
	return processing.Question{}, generator.err
}

type poolStore struct {
	job                  atomic.Int64
	claims               atomic.Int64
	retries              atomic.Int64
	retryContextCanceled atomic.Bool
	persists             atomic.Int64
	fails                atomic.Int64
	maxJobs              int64
	retryResult          processing.RetryResult
}

func (store *poolStore) Claim(context.Context) (*processing.Job, error) {
	claim := store.claims.Add(1)
	if claim > store.maxJobs {
		return nil, nil
	}
	jobID := store.job.Add(1)
	return &processing.Job{ID: "job-" + strconv.FormatInt(jobID, 10), DocumentID: "doc", OwnerID: "owner", LeaseID: "lease", Attempt: 1}, nil
}

func (store *poolStore) Source(context.Context, processing.Job) (processing.Source, error) {
	return processing.Source{StorageRef: "document.txt", Type: "TEXT"}, nil
}

func (store *poolStore) PersistAndComplete(context.Context, processing.Job, []processing.Chunk, []processing.Question) (bool, error) {
	store.persists.Add(1)
	return true, nil
}

func (store *poolStore) Fail(context.Context, processing.Job, processing.Failure) (bool, error) {
	store.fails.Add(1)
	return true, nil
}

func (store *poolStore) Retry(ctx context.Context, _ processing.Job, _ processing.FailureCode) (processing.RetryResult, error) {
	store.retries.Add(1)
	store.retryContextCanceled.Store(ctx.Err() != nil)
	return store.retryResult, nil
}

type blockingGenerator struct {
	release     chan struct{}
	started     atomic.Int64
	active      atomic.Int64
	maxActive   atomic.Int64
	cancelled   atomic.Bool
	maxActiveMu sync.Mutex
}

func (generator *blockingGenerator) Generate(ctx context.Context, _ string) (processing.Question, error) {
	generator.started.Add(1)
	active := generator.active.Add(1)
	generator.maxActiveMu.Lock()
	if active > generator.maxActive.Load() {
		generator.maxActive.Store(active)
	}
	generator.maxActiveMu.Unlock()
	defer generator.active.Add(-1)
	select {
	case <-generator.release:
		return validQuestion(), nil
	case <-ctx.Done():
		generator.cancelled.Store(true)
		return processing.Question{}, ctx.Err()
	}
}

type deadlineGenerator struct{ sawDeadline atomic.Bool }

func (generator *deadlineGenerator) Generate(ctx context.Context, _ string) (processing.Question, error) {
	if _, ok := ctx.Deadline(); ok {
		generator.sawDeadline.Store(true)
	}
	<-ctx.Done()
	return processing.Question{}, ctx.Err()
}

func validQuestion() processing.Question {
	return processing.Question{Stem: "stem", Explanation: "explanation", Options: []processing.Option{{Content: "a", IsCorrect: true}, {Content: "b"}, {Content: "c"}, {Content: "d"}}}
}

func TestBootstrapDoesNotStartWithCanceledContext(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	bootstrap := NewBootstrap()
	if err := bootstrap.Start(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Start() error = %v, want context.Canceled", err)
	}
	if bootstrap.Ready() {
		t.Fatal("Bootstrap should remain not ready after failed Start")
	}
}

func TestNewWithOptionsClampsLifecycleBounds(t *testing.T) {
	worker := NewWithOptions(nil, nil, nil, Options{
		Concurrency:     100,
		JobTimeout:      time.Nanosecond,
		PollInterval:    time.Nanosecond,
		ShutdownTimeout: time.Nanosecond,
	})
	if worker.options.Concurrency != maxConcurrency {
		t.Fatalf("concurrency = %d, want %d", worker.options.Concurrency, maxConcurrency)
	}
	if worker.options.JobTimeout != minJobTimeout {
		t.Fatalf("job timeout = %s, want %s", worker.options.JobTimeout, minJobTimeout)
	}
	if worker.options.PollInterval != minPollInterval {
		t.Fatalf("poll interval = %s, want %s", worker.options.PollInterval, minPollInterval)
	}
	if worker.options.ShutdownTimeout != minShutdownTimeout {
		t.Fatalf("shutdown timeout = %s, want %s", worker.options.ShutdownTimeout, minShutdownTimeout)
	}
}

func TestBootstrapCanRestartAfterClosedNilStore(t *testing.T) {
	bootstrap := NewBootstrap()
	if err := bootstrap.Start(context.Background()); err != nil {
		t.Fatalf("first Start() error = %v", err)
	}
	bootstrap.Close()
	if err := bootstrap.Start(context.Background()); err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	bootstrap.Close()
}

func TestWorkerPoolNeverExceedsConfiguredConcurrency(t *testing.T) {
	store := &poolStore{maxJobs: 6}
	generator := &blockingGenerator{release: make(chan struct{})}
	worker := NewWithOptions(store, objectMock{bytes: []byte("document text")}, generator, Options{
		Concurrency:     2,
		PollInterval:    5 * time.Millisecond,
		JobTimeout:      time.Second,
		ShutdownTimeout: time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := worker.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !waitUntil(time.Second, func() bool { return generator.started.Load() == 2 }) {
		t.Fatalf("worker did not start two jobs: started=%d", generator.started.Load())
	}
	if got := generator.maxActive.Load(); got > 2 {
		t.Fatalf("max concurrent generators = %d, want <= 2", got)
	}
	if got := store.claims.Load(); got != 2 {
		t.Fatalf("claims while both slots are occupied = %d, want 2", got)
	}
	close(generator.release)
	worker.Close()
}

func TestWorkerJobTimeoutCancelsPipelineAndRetriesWithFreshContext(t *testing.T) {
	store := &poolStore{maxJobs: 1, retryResult: processing.RetryResult{Scheduled: true}}
	generator := &deadlineGenerator{}
	worker := NewWithOptions(store, objectMock{bytes: []byte("document text")}, generator, Options{
		Concurrency:     1,
		PollInterval:    5 * time.Millisecond,
		JobTimeout:      25 * time.Millisecond,
		PersistTimeout:  time.Second,
		ShutdownTimeout: time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := worker.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !waitUntil(time.Second, func() bool { return store.retries.Load() == 1 }) {
		t.Fatalf("timeout was not retried: retries=%d", store.retries.Load())
	}
	if !generator.sawDeadline.Load() {
		t.Fatal("generator context did not carry the per-job deadline")
	}
	if store.retryContextCanceled.Load() {
		t.Fatal("timeout retry used the canceled job context")
	}
	worker.Close()
}

func TestWorkerCloseCancelsInFlightJobsBeforeReturning(t *testing.T) {
	store := &poolStore{maxJobs: 1}
	generator := &blockingGenerator{release: make(chan struct{})}
	worker := NewWithOptions(store, objectMock{bytes: []byte("document text")}, generator, Options{
		Concurrency:     1,
		PollInterval:    5 * time.Millisecond,
		JobTimeout:      time.Minute,
		ShutdownTimeout: time.Second,
	})
	if err := worker.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !waitUntil(time.Second, func() bool { return generator.started.Load() == 1 }) {
		t.Fatal("worker did not start an in-flight job")
	}
	worker.Close()
	if worker.Ready() {
		t.Fatal("worker remained ready after Close")
	}
	if !generator.cancelled.Load() {
		t.Fatal("Close() did not cancel the in-flight job")
	}
	if store.persists.Load() != 0 || store.fails.Load() != 0 || store.retries.Load() != 0 {
		t.Fatalf("shutdown mutated durable job state: persists=%d fails=%d retries=%d", store.persists.Load(), store.fails.Load(), store.retries.Load())
	}
}

func waitUntil(timeout time.Duration, condition func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return true
		}
		time.Sleep(time.Millisecond)
	}
	return condition()
}
