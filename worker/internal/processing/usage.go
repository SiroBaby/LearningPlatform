package processing

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ModelUsage is the token usage the provider reported for one model.
type ModelUsage struct {
	Model        string `json:"model"`
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
}

// Usage is the actual-usage block of the DocumentProcessingResult payload (additive; version stays 1).
// UncertainDispatches counts provider calls whose spend is unknown: they were sent but no answer or token count
// came back (timeout, connection loss, or a 2xx body without usage). Node holds the matching credits (ADR-0022).
// STTBilledSeconds and STTUncertainSeconds are present only for media Documents that dispatched speech-to-text: whole
// seconds of audio sent with a known (2xx) outcome, and sent without a known outcome (Node holds those credits).
// A pointer keeps a legitimate zero on the wire while non-media payloads omit the fields.
type Usage struct {
	LLM                 []ModelUsage `json:"llm"`
	UncertainDispatches int          `json:"uncertainDispatches"`
	STTBilledSeconds    *int64       `json:"sttBilledSeconds,omitempty"`
	STTUncertainSeconds *int64       `json:"sttUncertainSeconds,omitempty"`
}

// UsageTracker accumulates provider usage of one claimed attempt. It is safe for concurrent use.
type UsageTracker struct {
	mutex     sync.Mutex
	byModel   map[string]ModelUsage
	dispatch  int
	completed int
	unsaved   []STTOutcome
}

func NewUsageTracker() *UsageTracker {
	return &UsageTracker{byModel: map[string]ModelUsage{}}
}

// Dispatched records a provider call that is about to be sent.
func (tracker *UsageTracker) Dispatched() {
	if tracker == nil {
		return
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.dispatch++
}

// Rejected resolves a dispatched call the provider answered with a non-2xx status: nothing was billed.
func (tracker *UsageTracker) Rejected() {
	if tracker == nil {
		return
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.completed++
}

// Reported resolves a dispatched call whose response carried token usage.
func (tracker *UsageTracker) Reported(model string, inputTokens, outputTokens int64) {
	if tracker == nil {
		return
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.completed++
	entry := tracker.byModel[model]
	entry.Model = model
	entry.InputTokens += inputTokens
	entry.OutputTokens += outputTokens
	tracker.byModel[model] = entry
}

// AddUnsavedSTT keeps a speech-to-text outcome whose checkpoint write kept failing. The next transaction that holds the
// job lock (retry schedule or terminal result) writes it, so paid or uncertain spend is never lost.
func (tracker *UsageTracker) AddUnsavedSTT(outcome STTOutcome) {
	if tracker == nil {
		return
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.unsaved = append(tracker.unsaved, outcome)
}

// UnsavedSTT returns a copy of the outcomes still waiting for a durable write.
func (tracker *UsageTracker) UnsavedSTT() []STTOutcome {
	if tracker == nil {
		return nil
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	return append([]STTOutcome(nil), tracker.unsaved...)
}

// ClearUnsavedSTT drops the outcomes after their transaction committed.
func (tracker *UsageTracker) ClearUnsavedSTT() {
	if tracker == nil {
		return
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	tracker.unsaved = nil
}

// Snapshot returns a stable (model-sorted) copy of the usage so far.
func (tracker *UsageTracker) Snapshot() Usage {
	if tracker == nil {
		return Usage{LLM: []ModelUsage{}}
	}
	tracker.mutex.Lock()
	defer tracker.mutex.Unlock()
	models := make([]ModelUsage, 0, len(tracker.byModel))
	for _, entry := range tracker.byModel {
		models = append(models, entry)
	}
	sort.Slice(models, func(left, right int) bool { return models[left].Model < models[right].Model })
	return Usage{LLM: models, UncertainDispatches: tracker.dispatch - tracker.completed}
}

type usageTrackerKey struct{}

// WithUsageTracker attaches the tracker so provider adapters and the store can reach it without widening the
// Generator and Store interfaces.
func WithUsageTracker(ctx context.Context, tracker *UsageTracker) context.Context {
	return context.WithValue(ctx, usageTrackerKey{}, tracker)
}

// UsageTrackerFrom returns the attached tracker, or nil (all methods are nil-safe).
func UsageTrackerFrom(ctx context.Context) *UsageTracker {
	tracker, _ := ctx.Value(usageTrackerKey{}).(*UsageTracker)
	return tracker
}

// UsageStatus is the provider_usage_records.usage_status of one LLM dispatch.
type UsageStatus string

const (
	// UsageUnavailable: the call was (or may have been) sent and its spend is unknown.
	UsageUnavailable UsageStatus = "UNAVAILABLE"
	// UsageAvailable: the spend is known (tokens reported, or a definitive rejection with zero tokens).
	UsageAvailable UsageStatus = "AVAILABLE"
)

// UsageRecorder persists every LLM dispatch durably (#275), so the spend survives technical retries and lease
// reclaim that drop the in-memory UsageTracker. PostgresStore implements it.
type UsageRecorder interface {
	// RecordDispatch writes an UNAVAILABLE row before the provider request leaves, guarded by the job fence.
	RecordDispatch(ctx context.Context, job Job, requestKey, model string) error
	// RecordOutcome resolves the row by request key; it carries no fence because the money is spent either way.
	RecordOutcome(ctx context.Context, requestKey string, inputTokens, outputTokens int64, status UsageStatus) error
}

// LLMRequestKeyPrefix marks the request_key of every Go LLM dispatch record; the Node reconciler filters on it.
const LLMRequestKeyPrefix = "go-llm:"

// llmRequestKey is unique per job, Document processing attempt, claim and dispatch sequence.
func llmRequestKey(job Job, sequence int64) string {
	return fmt.Sprintf("%s%s:%d:%d:%d", LLMRequestKeyPrefix, job.ID, *job.ProcessingAttempt, job.Attempt, sequence)
}

// usageSession is the per-claim recorder, job and dispatch counter carried in the context.
type usageSession struct {
	recorder UsageRecorder
	job      Job
	sequence atomic.Int64
}

type usageSessionKey struct{}

// WithUsageRecorder attaches the durable recorder for one claimed attempt. Jobs without a ProcessingAttempt (older
// Node runtime) record nothing and rely on the UsageTracker.
func WithUsageRecorder(ctx context.Context, recorder UsageRecorder, job Job) context.Context {
	if recorder == nil || job.ProcessingAttempt == nil {
		return ctx
	}
	return context.WithValue(ctx, usageSessionKey{}, &usageSession{recorder: recorder, job: job})
}

// llmDispatch is one durable dispatch record being resolved.
type llmDispatch struct {
	session *usageSession
	key     string
}

// beginLLMDispatch records the dispatch before the request is sent. A nil dispatch means durable recording is off.
func beginLLMDispatch(ctx context.Context, model string) (*llmDispatch, error) {
	session, _ := ctx.Value(usageSessionKey{}).(*usageSession)
	if session == nil {
		return nil, nil
	}
	key := llmRequestKey(session.job, session.sequence.Add(1))
	if err := session.recorder.RecordDispatch(ctx, session.job, key, model); err != nil {
		return nil, err
	}
	return &llmDispatch{session: session, key: key}, nil
}

const usageOutcomeTimeout = 5 * time.Second

// resolve stores the known outcome. It runs detached from request cancellation (a timed-out request context must not
// lose a reported usage) and a failed write is safe: the row stays UNAVAILABLE, which Node holds.
func (dispatch *llmDispatch) resolve(ctx context.Context, inputTokens, outputTokens int64) {
	if dispatch == nil {
		return
	}
	outcomeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), usageOutcomeTimeout)
	defer cancel()
	if err := dispatch.session.recorder.RecordOutcome(outcomeCtx, dispatch.key, inputTokens, outputTokens, UsageAvailable); err != nil {
		// No request key or error text: the row stays UNAVAILABLE and Node holds it; this only makes the gap visible.
		slog.Warn("worker.usage.outcome_record_failed", "event", "worker.usage.outcome_record_failed", "job_id", dispatch.session.job.ID)
	}
}

func (usage Usage) isEmpty() bool { return len(usage.LLM) == 0 && usage.UncertainDispatches == 0 }
