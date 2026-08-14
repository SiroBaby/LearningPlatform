package contract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	t.Parallel()

	input, err := Parse(readFixture(t, "document.processing.requested.v1.valid.json"))
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if input.Job.Attempt != 1 || input.CorrelationID != "66666666-6666-4666-8666-666666666666" {
		t.Fatalf("Parse() input = %#v", input)
	}
}

func TestParseRejectsInvalidOrUnsupportedContract(t *testing.T) {
	t.Parallel()
	validMessage := string(readFixture(t, "document.processing.requested.v1.valid.json"))

	tests := []struct{ name, raw string }{
		{"serialized invalid fixture", string(readFixture(t, "document.processing.requested.v1.invalid.json"))},
		{"unsupported version", strings.Replace(validMessage, `"schemaVersion":"1"`, `"schemaVersion":"2"`, 1)},
		{"invalid attempt", strings.Replace(validMessage, `"attempt":1`, `"attempt":0`, 1)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := Parse([]byte(test.raw)); err == nil {
				t.Fatal("Parse() error = nil")
			}
		})
	}
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "contracts", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return raw
}
