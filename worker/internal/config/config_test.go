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
		{
			name: "loads explicit PostgreSQL and health configuration",
			env: map[string]string{
				databaseURLEnvironment:   "postgresql://worker:secret@db.local:5432/learning",
				healthAddressEnvironment: "127.0.0.1:3403",
			},
		},
		{name: "rejects missing database URL", env: map[string]string{healthAddressEnvironment: "127.0.0.1:3403"}, wantErr: databaseURLEnvironment + " is required"},
		{name: "rejects non PostgreSQL URL", env: map[string]string{databaseURLEnvironment: "https://db.local", healthAddressEnvironment: "127.0.0.1:3403"}, wantErr: "must use postgres or postgresql"},
		{name: "rejects malformed health address", env: map[string]string{databaseURLEnvironment: "postgres://worker:secret@db.local/learning", healthAddressEnvironment: "3403"}, wantErr: "must be a host:port address"},
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
			if config.DatabaseURL.Host != "db.local:5432" || config.HealthAddress != "127.0.0.1:3403" {
				t.Fatalf("Load() config = %#v", config)
			}
		})
	}
}
