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
		{name: "loads explicit worker configuration", env: validEnvironment()},
		{name: "builds database URL from deployed database component settings", env: deployedEnvironment()},
		{name: "rejects insecure object storage outside explicit local override", env: map[string]string{healthAddressEnvironment: "127.0.0.1:3403", databaseURLEnvironment: "postgres://worker@localhost/learning", storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents"}, wantErr: "OBJECT_STORAGE_ENDPOINT must use HTTPS"},
		{name: "rejects local override in production", env: map[string]string{healthAddressEnvironment: "127.0.0.1:3403", databaseURLEnvironment: "postgres://worker@localhost/learning", storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents", allowInsecureEndpointsEnvironment: "true", "NODE_ENV": "production"}, wantErr: "OBJECT_STORAGE_ENDPOINT must use HTTPS"},
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

func deployedEnvironment() map[string]string {
	env := validEnvironment()
	delete(env, databaseURLEnvironment)
	env[databaseHostEnvironment] = "postgres"
	env[databasePortEnvironment] = "5432"
	env[databaseUserEnvironment] = "ai_worker"
	env[databasePasswordEnvironment] = "password"
	env[databaseNameEnvironment] = "learning"
	return env
}

func validEnvironment() map[string]string {
	return map[string]string{healthAddressEnvironment: "127.0.0.1:3403", databaseURLEnvironment: "postgres://worker@localhost/learning", storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents", allowInsecureEndpointsEnvironment: "true"}
}
