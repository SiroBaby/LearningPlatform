package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

const (
	schemaVersion = "1"
	messageType   = "document.processing.requested"
)

var (
	uuidPattern   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	promptPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
)

type ProcessingInput struct {
	MessageID     string
	DocumentID    string
	OwnerID       string
	Job           JobFence
	CorrelationID string
	Provider      Provider
	Prompt        Prompt
	OccurredAt    time.Time
}

type JobFence struct {
	JobID          string
	Attempt        int
	IdempotencyKey string
	LeaseID        string
}

type Provider struct {
	SelectionKind    string
	ProviderIdentity string
}

type Prompt struct {
	Version     string
	Fingerprint string
}

type envelope struct {
	SchemaVersion string `json:"schemaVersion"`
	MessageType   string `json:"messageType"`
	MessageID     string `json:"messageId"`
	DocumentID    string `json:"documentId"`
	OwnerID       string `json:"ownerId"`
	Job           struct {
		JobID          string `json:"jobId"`
		JobType        string `json:"jobType"`
		Attempt        int    `json:"attempt"`
		IdempotencyKey string `json:"idempotencyKey"`
		LeaseID        string `json:"leaseId"`
	} `json:"job"`
	CorrelationID string `json:"correlationId"`
	Provider      struct {
		SelectionKind    string `json:"selectionKind"`
		ProviderIdentity string `json:"providerIdentity"`
	} `json:"provider"`
	Prompt struct {
		Version     string `json:"version"`
		Fingerprint string `json:"fingerprint"`
	} `json:"prompt"`
	OccurredAt string `json:"occurredAt"`
}

func Parse(raw []byte) (ProcessingInput, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()

	var message envelope
	if err := decoder.Decode(&message); err != nil {
		return ProcessingInput{}, fmt.Errorf("decode v1 processing message: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return ProcessingInput{}, fmt.Errorf("decode v1 processing message: multiple JSON values")
	}
	if err := validate(message); err != nil {
		return ProcessingInput{}, err
	}

	occurredAt, err := time.Parse(time.RFC3339Nano, message.OccurredAt)
	if err != nil {
		return ProcessingInput{}, fmt.Errorf("validate v1 processing message: occurredAt must be UTC RFC3339: %w", err)
	}

	return ProcessingInput{
		MessageID: message.MessageID, DocumentID: message.DocumentID, OwnerID: message.OwnerID,
		Job:           JobFence{JobID: message.Job.JobID, Attempt: message.Job.Attempt, IdempotencyKey: message.Job.IdempotencyKey, LeaseID: message.Job.LeaseID},
		CorrelationID: message.CorrelationID,
		Provider:      Provider{SelectionKind: message.Provider.SelectionKind, ProviderIdentity: message.Provider.ProviderIdentity},
		Prompt:        Prompt{Version: message.Prompt.Version, Fingerprint: message.Prompt.Fingerprint},
		OccurredAt:    occurredAt,
	}, nil
}

func validate(message envelope) error {
	if message.SchemaVersion != schemaVersion || message.MessageType != messageType {
		return fmt.Errorf("validate v1 processing message: unsupported contract")
	}
	for field, value := range map[string]string{
		"messageId": message.MessageID, "documentId": message.DocumentID, "ownerId": message.OwnerID,
		"job.jobId": message.Job.JobID, "job.leaseId": message.Job.LeaseID, "correlationId": message.CorrelationID,
	} {
		if !uuidPattern.MatchString(value) {
			return fmt.Errorf("validate v1 processing message: %s must be UUID", field)
		}
	}
	if message.Job.JobType != "FULL_PIPELINE" || message.Job.Attempt < 1 {
		return fmt.Errorf("validate v1 processing message: invalid job fence")
	}
	if !sha256Pattern.MatchString(message.Job.IdempotencyKey) || !sha256Pattern.MatchString(message.Provider.ProviderIdentity) || !sha256Pattern.MatchString(message.Prompt.Fingerprint) {
		return fmt.Errorf("validate v1 processing message: invalid SHA-256 metadata")
	}
	if message.Provider.SelectionKind != "PLAN" && message.Provider.SelectionKind != "CUSTOM" {
		return fmt.Errorf("validate v1 processing message: invalid provider selection")
	}
	if !promptPattern.MatchString(message.Prompt.Version) || !strings.HasSuffix(message.OccurredAt, "Z") {
		return fmt.Errorf("validate v1 processing message: invalid prompt or timestamp metadata")
	}
	return nil
}
