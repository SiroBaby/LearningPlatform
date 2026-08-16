package processing

import "context"

type Job struct {
	ID, DocumentID, OwnerID, CorrelationID, LeaseID string
	Attempt                                         int
}
type Source struct{ StorageRef, Type string }
type Locator struct {
	Kind  string `json:"kind"`
	Page  int    `json:"page,omitempty"`
	Start int    `json:"start,omitempty"`
	End   int    `json:"end,omitempty"`
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

const (
	ObjectNotFound      FailureCode = "EXTRACTION_OBJECT_NOT_FOUND"
	ObjectTooLarge      FailureCode = "EXTRACTION_OBJECT_TOO_LARGE"
	PDFInvalid          FailureCode = "PDF_INVALID"
	PDFTextNotFound     FailureCode = "PDF_TEXT_NOT_FOUND"
	ChunkLimit          FailureCode = "CHUNK_RESOURCE_LIMIT_EXCEEDED"
	OutputInvalid       FailureCode = "GENERATION_OUTPUT_INVALID"
	OutputTruncated     FailureCode = "GENERATION_OUTPUT_TRUNCATED"
	ProviderUnavailable FailureCode = "PROVIDER_UNAVAILABLE"
	ProcessingFailed    FailureCode = "PROCESSING_FAILED"
)

type Failure struct {
	Code      FailureCode
	Technical bool
}

func (failure Failure) Error() string { return string(failure.Code) }

type Store interface {
	Claim(context.Context) (*Job, error)
	Source(context.Context, Job) (Source, error)
	PersistAndComplete(context.Context, Job, []Chunk, []Question) (bool, error)
	Fail(context.Context, Job, Failure) (bool, error)
	Retry(context.Context, Job, FailureCode) (bool, error)
}
type ObjectReader interface {
	Read(context.Context, string, int64) ([]byte, error)
}
type Generator interface {
	Generate(context.Context, string) (Question, error)
}
