package config

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

const (
	healthAddressEnvironment              = "AI_WORKER_HEALTH_ADDRESS"
	databaseHostEnvironment               = "DB_HOST"
	databasePortEnvironment               = "DB_PORT"
	databaseUserEnvironment               = "DB_USER"
	databasePasswordEnvironment           = "DB_PASSWORD"
	databaseNameEnvironment               = "DB_NAME"
	storageEndpointEnvironment            = "OBJECT_STORAGE_ENDPOINT"
	storageAccessKeyEnvironment           = "OBJECT_STORAGE_ACCESS_KEY"
	storageSecretKeyEnvironment           = "OBJECT_STORAGE_SECRET_KEY"
	storageBucketEnvironment              = "OBJECT_STORAGE_BUCKET"
	storagePortEnvironment                = "OBJECT_STORAGE_PORT"
	storageUseSSLEnvironment              = "OBJECT_STORAGE_USE_SSL"
	llmProviderEnvironment                = "AI_LLM_PROVIDER"
	openAIKeyEnvironment                  = "OPENAI_API_KEY"
	openAIBaseURLEnvironment              = "OPENAI_BASE_URL"
	openAIModelEnvironment                = "OPENAI_MODEL"
	openAICapabilityVersionEnvironment    = "OPENAI_CAPABILITY_VERSION"
	openAIStructuredOutputModeEnvironment = "OPENAI_STRUCTURED_OUTPUT_MODE"
	openAITransportEnvironment            = "OPENAI_TRANSPORT"
	openAIRequestTimeoutEnvironment       = "OPENAI_REQUEST_TIMEOUT_MS"
	allowInsecureEndpointsEnvironment     = "AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS"
	migrationsDirectoryEnvironment        = "AI_WORKER_MIGRATIONS_DIR"
)

type LookupEnv func(string) (string, bool)

type Config struct {
	HealthAddress string
	DatabaseURL   string
	MigrationsDir string
	Storage       Storage
	LLM           LLM
}

type Storage struct{ Endpoint, AccessKey, SecretKey, Bucket string }
type LLM struct {
	Provider, APIKey, BaseURL, Model string
	Profile                          processing.ProviderProfile
	RequestTimeout                   time.Duration
}

func Load(lookup LookupEnv) (Config, error) {
	healthAddress, err := requiredAddress(lookup)
	if err != nil {
		return Config{}, err
	}

	databaseURL, err := buildDatabaseURL(lookup)
	if err != nil {
		return Config{}, err
	}
	endpoint, err := required(lookup, storageEndpointEnvironment)
	if err != nil {
		return Config{}, err
	}
	endpoint = normalizeStorageEndpoint(lookup, endpoint)
	if err := requireSecureExternalURL(lookup, storageEndpointEnvironment, endpoint); err != nil {
		return Config{}, err
	}
	accessKey, err := required(lookup, storageAccessKeyEnvironment)
	if err != nil {
		return Config{}, err
	}
	secretKey, err := required(lookup, storageSecretKeyEnvironment)
	if err != nil {
		return Config{}, err
	}
	bucket, err := required(lookup, storageBucketEnvironment)
	if err != nil {
		return Config{}, err
	}
	provider := value(lookup, llmProviderEnvironment, "fake")
	if provider != "fake" && provider != "openai-compatible" {
		return Config{}, fmt.Errorf("%s must be fake or openai-compatible", llmProviderEnvironment)
	}
	llm := LLM{Provider: provider}
	if provider == "openai-compatible" {
		llm.APIKey, err = required(lookup, openAIKeyEnvironment)
		if err != nil {
			return Config{}, err
		}
		llm.BaseURL, err = required(lookup, openAIBaseURLEnvironment)
		if err != nil {
			return Config{}, err
		}
		if err := requireSecureExternalURL(lookup, openAIBaseURLEnvironment, llm.BaseURL); err != nil {
			return Config{}, err
		}
		llm.Model, err = required(lookup, openAIModelEnvironment)
		if err != nil {
			return Config{}, err
		}
		capabilityVersion, err := required(lookup, openAICapabilityVersionEnvironment)
		if err != nil {
			return Config{}, err
		}
		structuredOutputMode, err := required(lookup, openAIStructuredOutputModeEnvironment)
		if err != nil {
			return Config{}, err
		}
		transport, err := required(lookup, openAITransportEnvironment)
		if err != nil {
			return Config{}, err
		}
		llm.Profile, err = processing.NewProviderProfile(capabilityVersion, transport, structuredOutputMode)
		if err != nil {
			return Config{}, err
		}
		llm.RequestTimeout, err = requiredProviderTimeout(lookup)
		if err != nil {
			return Config{}, err
		}
	}
	migrationsDir := value(lookup, migrationsDirectoryEnvironment, "/app/migrations")
	return Config{HealthAddress: healthAddress, DatabaseURL: databaseURL, MigrationsDir: migrationsDir, Storage: Storage{endpoint, accessKey, secretKey, bucket}, LLM: llm}, nil
}

func requiredProviderTimeout(lookup LookupEnv) (time.Duration, error) {
	raw, err := required(lookup, openAIRequestTimeoutEnvironment)
	if err != nil {
		return 0, err
	}
	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || milliseconds < 1 || milliseconds > 120_000 {
		return 0, fmt.Errorf("%s must be a positive integer no greater than 120000", openAIRequestTimeoutEnvironment)
	}
	return time.Duration(milliseconds) * time.Millisecond, nil
}

func normalizeStorageEndpoint(lookup LookupEnv, endpoint string) string {
	if strings.Contains(endpoint, "://") {
		return endpoint
	}
	scheme := "http"
	if value(lookup, storageUseSSLEnvironment, "false") == "true" {
		scheme = "https"
	}
	if port := value(lookup, storagePortEnvironment, ""); port != "" {
		endpoint += ":" + port
	}
	return scheme + "://" + endpoint
}

func buildDatabaseURL(lookup LookupEnv) (string, error) {
	host, err := required(lookup, databaseHostEnvironment)
	if err != nil {
		return "", err
	}
	port, err := required(lookup, databasePortEnvironment)
	if err != nil {
		return "", err
	}
	if _, err = strconv.ParseUint(port, 10, 16); err != nil {
		return "", fmt.Errorf("%s must be a valid port", databasePortEnvironment)
	}
	user, err := required(lookup, databaseUserEnvironment)
	if err != nil {
		return "", err
	}
	password, err := required(lookup, databasePasswordEnvironment)
	if err != nil {
		return "", err
	}
	database, err := required(lookup, databaseNameEnvironment)
	if err != nil {
		return "", err
	}
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(user, password), Host: host + ":" + port, Path: database}).String(), nil
}

func requireSecureExternalURL(lookup LookupEnv, key, raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("%s must be an absolute HTTP or HTTPS URL", key)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%s must not contain credentials, query parameters, or a fragment", key)
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if value(lookup, allowInsecureEndpointsEnvironment, "false") == "true" && value(lookup, "NODE_ENV", "development") != "production" {
		return nil
	}
	return fmt.Errorf("%s must use HTTPS unless %s=true outside production", key, allowInsecureEndpointsEnvironment)
}

func required(lookup LookupEnv, key string) (string, error) {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}
func value(lookup LookupEnv, key, fallback string) string {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func requiredAddress(lookup LookupEnv) (string, error) {
	address, ok := lookup(healthAddressEnvironment)
	if !ok || strings.TrimSpace(address) == "" {
		return "", fmt.Errorf("%s is required", healthAddressEnvironment)
	}
	if _, _, err := net.SplitHostPort(address); err != nil {
		return "", fmt.Errorf("%s must be a host:port address", healthAddressEnvironment)
	}

	return address, nil
}
