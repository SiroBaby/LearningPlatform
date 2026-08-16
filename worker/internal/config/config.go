package config

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const (
	healthAddressEnvironment          = "AI_WORKER_HEALTH_ADDRESS"
	databaseURLEnvironment            = "AI_WORKER_DATABASE_URL"
	migrationDatabaseURLEnvironment   = "AI_WORKER_MIGRATION_DATABASE_URL"
	databaseHostEnvironment           = "DB_HOST"
	databasePortEnvironment           = "DB_PORT"
	databaseUserEnvironment           = "DB_USER"
	databasePasswordEnvironment       = "DB_PASSWORD"
	databaseNameEnvironment           = "DB_NAME"
	storageEndpointEnvironment        = "OBJECT_STORAGE_ENDPOINT"
	storageAccessKeyEnvironment       = "OBJECT_STORAGE_ACCESS_KEY"
	storageSecretKeyEnvironment       = "OBJECT_STORAGE_SECRET_KEY"
	storageBucketEnvironment          = "OBJECT_STORAGE_BUCKET"
	storagePortEnvironment            = "OBJECT_STORAGE_PORT"
	storageUseSSLEnvironment          = "OBJECT_STORAGE_USE_SSL"
	llmProviderEnvironment            = "AI_LLM_PROVIDER"
	openAIKeyEnvironment              = "OPENAI_API_KEY"
	openAIBaseURLEnvironment          = "OPENAI_BASE_URL"
	openAIModelEnvironment            = "OPENAI_MODEL"
	allowInsecureEndpointsEnvironment = "AI_WORKER_ALLOW_INSECURE_LOCAL_ENDPOINTS"
	migrationsDirectoryEnvironment    = "AI_WORKER_MIGRATIONS_DIR"
)

type LookupEnv func(string) (string, bool)

type Config struct {
	HealthAddress        string
	DatabaseURL          string
	MigrationDatabaseURL string
	MigrationsDir        string
	Storage              Storage
	LLM                  LLM
}

type Storage struct{ Endpoint, AccessKey, SecretKey, Bucket string }
type LLM struct{ Provider, APIKey, BaseURL, Model string }

func Load(lookup LookupEnv) (Config, error) {
	healthAddress, err := requiredAddress(lookup)
	if err != nil {
		return Config{}, err
	}

	databaseURL, err := buildDatabaseURL(lookup)
	if err != nil {
		return Config{}, err
	}
	migrationDatabaseURL := value(lookup, migrationDatabaseURLEnvironment, databaseURL)
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
	}
	migrationsDir := value(lookup, migrationsDirectoryEnvironment, "/app/migrations")
	return Config{HealthAddress: healthAddress, DatabaseURL: databaseURL, MigrationDatabaseURL: migrationDatabaseURL, MigrationsDir: migrationsDir, Storage: Storage{endpoint, accessKey, secretKey, bucket}, LLM: llm}, nil
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
	if raw := value(lookup, databaseURLEnvironment, ""); raw != "" {
		return raw, nil
	}
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
