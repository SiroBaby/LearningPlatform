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
		{name: "loads shared backend database configuration", env: validEnvironment()},
		{name: "rejects insecure object storage outside explicit local override", env: environmentWithDatabase(map[string]string{storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents"}), wantErr: "OBJECT_STORAGE_ENDPOINT must use HTTPS"},
		{name: "rejects local override in production", env: environmentWithDatabase(map[string]string{storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents", allowInsecureEndpointsEnvironment: "true", "NODE_ENV": "production"}), wantErr: "OBJECT_STORAGE_ENDPOINT must use HTTPS"},
		{name: "rejects missing health address", env: map[string]string{}, wantErr: healthAddressEnvironment + " is required"},
		{name: "rejects malformed health address", env: map[string]string{healthAddressEnvironment: "3403"}, wantErr: "must be a host:port address"},
		{name: "requires shared backend database configuration", env: map[string]string{healthAddressEnvironment: "127.0.0.1:3403"}, wantErr: databaseHostEnvironment + " is required"},
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

func TestLoadRequiresCoherentOpenAIProviderProfile(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{name: "loads chat completions JSON profile", env: openAIEnvironment(map[string]string{})},
		{name: "rejects mismatched capability transport", env: openAIEnvironment(map[string]string{openAITransportEnvironment: "responses"}), wantErr: "OPENAI_CAPABILITY_VERSION must match OPENAI_TRANSPORT"},
		{name: "requires structured output mode", env: openAIEnvironment(map[string]string{openAIStructuredOutputModeEnvironment: ""}), wantErr: openAIStructuredOutputModeEnvironment + " is required"},
		{name: "rejects unbounded provider timeout", env: openAIEnvironment(map[string]string{openAIRequestTimeoutEnvironment: "120001"}), wantErr: openAIRequestTimeoutEnvironment + " must be a positive integer no greater than 120000"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
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
			if config.LLM.Profile.CapabilityVersion != "chat-completions-json-v1" || config.LLM.Profile.Transport != "chat-completions" || config.LLM.Profile.StructuredOutputMode != "json-object" {
				t.Fatalf("Load() profile = %#v", config.LLM.Profile)
			}
		})
	}
}

func environmentWithDatabase(env map[string]string) map[string]string {
	env[healthAddressEnvironment] = "127.0.0.1:3403"
	env[databaseHostEnvironment] = "postgres"
	env[databasePortEnvironment] = "5432"
	env[databaseUserEnvironment] = "learning"
	env[databasePasswordEnvironment] = "password"
	env[databaseNameEnvironment] = "learning"
	return env
}

func validEnvironment() map[string]string {
	return environmentWithDatabase(map[string]string{storageEndpointEnvironment: "http://localhost:9000", storageAccessKeyEnvironment: "access", storageSecretKeyEnvironment: "secret", storageBucketEnvironment: "documents", allowInsecureEndpointsEnvironment: "true"})
}

func openAIEnvironment(overrides map[string]string) map[string]string {
	env := validEnvironment()
	for key, value := range map[string]string{
		llmProviderEnvironment:                "openai-compatible",
		openAIKeyEnvironment:                  "key",
		openAIBaseURLEnvironment:              "http://localhost:8080",
		openAIModelEnvironment:                "gateway-alias",
		openAICapabilityVersionEnvironment:    "chat-completions-json-v1",
		openAIStructuredOutputModeEnvironment: "json-object",
		openAITransportEnvironment:            "chat-completions",
		openAIRequestTimeoutEnvironment:       "60000",
	} {
		env[key] = value
	}
	for key, value := range overrides {
		env[key] = value
	}
	return env
}
