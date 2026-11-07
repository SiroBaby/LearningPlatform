package processing

import (
	"context"
	"sort"
	"sync"
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
