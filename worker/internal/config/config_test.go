package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{name: "loads explicit health configuration", env: map[string]string{healthAddressEnvironment: "127.0.0.1:3403"}},
		{name: "rejects missing health address", env: map[string]string{}, wantErr: healthAddressEnvironment + " is required"},
		{name: "rejects malformed health address", env: map[string]string{healthAddressEnvironment: "3403"}, wantErr: "must be a host:port address"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			config, err := Load(func(key string) (string, bool) { value, ok := test.env[key]; return value, ok })
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("Load() error = %v, want %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if config.HealthAddress != "127.0.0.1:3403" {
				t.Fatalf("Load() config = %#v", config)
			}
		})
	}
}
