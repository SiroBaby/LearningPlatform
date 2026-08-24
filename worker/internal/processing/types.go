package processing

import (
	"context"
	"encoding/json"
	"time"
)

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
}

func (failure Failure) Error() string { return string(failure.Code) }

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
