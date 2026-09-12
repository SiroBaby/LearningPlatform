package processing

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// ErrJobFenceLost means the claimed attempt is no longer allowed to mutate
// durable state. Callers must discard the result and must not retry it.
var ErrJobFenceLost = errors.New("job fence lost")

type Job struct {
	ID, DocumentID, OwnerID, CorrelationID, LeaseID string
	Attempt                                         int
	CreatedAt                                       time.Time
}
type Source struct{ StorageRef, Type string }
type Locator struct {
	Kind  string `json:"kind"`
	Page  int    `json:"page,omitempty"`
	Start int    `json:"start,omitempty"`
	End   int    `json:"end,omitempty"`
}

func (locator Locator) MarshalJSON() ([]byte, error) {
	switch locator.Kind {
	case "page":
		return json.Marshal(struct {
			Kind string `json:"kind"`
			Page int    `json:"page"`
		}{
			Kind: locator.Kind,
			Page: locator.Page,
		})
	case "text-range":
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Start int    `json:"start"`
			End   int    `json:"end"`
		}{
			Kind:  locator.Kind,
			Start: locator.Start,
			End:   locator.End,
		})
	default:
		type locatorJSON Locator
		return json.Marshal(locatorJSON(locator))
	}
}

type Chunk struct {
	ID, Text, ContentHash string
	Index                 int
	Locator               Locator
}
type Option struct {
	Content   string `json:"content"`
	IsCorrect bool   `json:"isCorrect"`
}
type Question struct {
	ChunkID     string   `json:"chunkId"`
	ChunkIndex  int      `json:"chunkIndex"`
	Ordinal     int      `json:"ordinal"`
	Stem        string   `json:"stem"`
	Explanation string   `json:"explanation"`
	Options     []Option `json:"options"`
	Citation    Citation `json:"citation"`
}
type Citation struct {
	ChunkID string  `json:"chunkId"`
	Locator Locator `json:"locator"`
	Snippet string  `json:"snippet"`
}
type FailureCode string

type FailureOperation string

const (
	FailureOperationUnknown                  FailureOperation = "unknown"
	FailureOperationClaim                    FailureOperation = "claim"
	FailureOperationSourceDescriptorRead     FailureOperation = "source_descriptor_read"
	FailureOperationChunkReplacement         FailureOperation = "chunk_replacement"
	FailureOperationChunkDelete              FailureOperation = "chunk_delete"
	FailureOperationChunkInsert              FailureOperation = "chunk_insert"
	FailureOperationDocumentCompletionUpdate FailureOperation = "document_completion_update"
	FailureOperationOutboxInsert             FailureOperation = "outbox_insert"
	FailureOperationTransactionCommit        FailureOperation = "transaction_commit"
	FailureOperationRetrySchedule            FailureOperation = "retry_schedule"
	FailureOperationDLQInsert                FailureOperation = "dlq_insert"
)

func (operation FailureOperation) Valid() bool {
	switch operation {
	case FailureOperationUnknown, FailureOperationClaim, FailureOperationSourceDescriptorRead, FailureOperationChunkReplacement, FailureOperationChunkDelete, FailureOperationChunkInsert, FailureOperationDocumentCompletionUpdate, FailureOperationOutboxInsert, FailureOperationTransactionCommit, FailureOperationRetrySchedule, FailureOperationDLQInsert:
		return true
	default:
		return false
	}
}

// ParserReason is a bounded, in-memory diagnostic for invalid generated output.
type ParserReason string

const (
	ObjectNotFound       FailureCode = "EXTRACTION_OBJECT_NOT_FOUND"
	ObjectTooLarge       FailureCode = "EXTRACTION_OBJECT_TOO_LARGE"
	PDFInvalid           FailureCode = "PDF_INVALID"
	PDFTextNotFound      FailureCode = "PDF_TEXT_NOT_FOUND"
	ChunkLimit           FailureCode = "CHUNK_RESOURCE_LIMIT_EXCEEDED"
	OutputInvalid        FailureCode = "GENERATION_OUTPUT_INVALID"
	OutputTruncated      FailureCode = "GENERATION_OUTPUT_TRUNCATED"
	ProviderIncompatible FailureCode = "PROVIDER_INCOMPATIBLE"
	ProviderUnavailable  FailureCode = "PROVIDER_UNAVAILABLE"
	ProcessingFailed     FailureCode = "PROCESSING_FAILED"
)

const (
	InvalidEnvelope  ParserReason = "invalid_envelope"
	ChoiceCount      ParserReason = "choice_count"
	InvalidJSON      ParserReason = "invalid_json"
	QuestionCount    ParserReason = "question_count"
	EmptyStem        ParserReason = "empty_stem"
	EmptyExplanation ParserReason = "empty_explanation"
	OptionCount      ParserReason = "option_count"
	EmptyOption      ParserReason = "empty_option"
	AnswerCount      ParserReason = "answer_count"
	DuplicateOption  ParserReason = "duplicate_option"
)

func (reason ParserReason) Valid() bool {
	switch reason {
	case InvalidEnvelope, ChoiceCount, InvalidJSON, QuestionCount, EmptyStem, EmptyExplanation, OptionCount, EmptyOption, AnswerCount, DuplicateOption:
		return true
	default:
		return false
	}
}

type Failure struct {
	Code        FailureCode
	Reason      ParserReason
	ChoiceCount int
	Technical   bool
	Operation   FailureOperation
}

func (failure Failure) Error() string { return string(failure.Code) }

// PersistenceError keeps the original error for control flow while exposing
// only bounded failure metadata through errors.As.
type PersistenceError struct {
	Failure Failure
	Err     error
}

func NewPersistenceError(operation FailureOperation, err error) error {
	if err == nil {
		return nil
	}
	if !operation.Valid() {
		operation = FailureOperationUnknown
	}
	return PersistenceError{
		Failure: Failure{Code: ProcessingFailed, Technical: true, Operation: operation},
		Err:     err,
	}
}

func (failure PersistenceError) Error() string {
	return string(ProcessingFailed)
}

func (failure PersistenceError) Unwrap() error { return failure.Err }

func (failure PersistenceError) As(target any) bool {
	value, ok := target.(*Failure)
	if !ok {
		return false
	}
	*value = failure.Failure
	return true
}

func FailureOperationOf(err error) FailureOperation {
	if err == nil {
		return FailureOperationUnknown
	}
	var failure Failure
	if errors.As(err, &failure) && failure.Operation.Valid() {
		return failure.Operation
	}
	return FailureOperationUnknown
}

type RetryResult struct {
	Scheduled bool
	Finalized bool
}

type Store interface {
	Claim(context.Context) (*Job, error)
	Source(context.Context, Job) (Source, error)
	PersistAndComplete(context.Context, Job, []Chunk, []Question) (bool, error)
	Fail(context.Context, Job, Failure) (bool, error)
	Retry(context.Context, Job, FailureCode) (RetryResult, error)
}
type ObjectReader interface {
	Read(context.Context, string, int64) ([]byte, error)
}
type Generator interface {
	Generate(context.Context, string) (Question, error)
}
