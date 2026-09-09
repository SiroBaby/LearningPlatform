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
	mediaBucketEnvironment                = "OBJECT_STORAGE_MEDIA_BUCKET"
	mediaProbeAccessKeyEnvironment        = "OBJECT_STORAGE_MEDIA_PROBE_ACCESS_KEY"
	mediaProbeSecretKeyEnvironment        = "OBJECT_STORAGE_MEDIA_PROBE_SECRET_KEY"
	fullPipelineMediaAccessKeyEnvironment = "OBJECT_STORAGE_FULL_PIPELINE_MEDIA_ACCESS_KEY"
	fullPipelineMediaSecretKeyEnvironment = "OBJECT_STORAGE_FULL_PIPELINE_MEDIA_SECRET_KEY"
	objectStorageEgressProxyEnvironment   = "OBJECT_STORAGE_EGRESS_PROXY_URL"
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
	concurrencyEnvironment                = "AI_WORKER_CONCURRENCY"
	jobTimeoutEnvironment                 = "AI_WORKER_JOB_TIMEOUT_MS"
	pollIntervalEnvironment               = "AI_WORKER_POLL_INTERVAL_MS"
	shutdownTimeoutEnvironment            = "AI_WORKER_SHUTDOWN_TIMEOUT_MS"
	probeBinaryPathEnvironment            = "MEDIA_PROBE_FFPROBE_PATH"
	probeVersionEnvironment               = "MEDIA_PROBE_FFPROBE_VERSION"
	probeTimeoutEnvironment               = "MEDIA_PROBE_TIMEOUT_MS"
	probeOutputBytesEnvironment           = "MEDIA_PROBE_OUTPUT_MAX_BYTES"
	probeTempDirEnvironment               = "MEDIA_PROBE_TEMP_DIR"
	probeMaxDownloadBytesEnvironment      = "MEDIA_PROBE_MAX_DOWNLOAD_BYTES"
)

type LookupEnv func(string) (string, bool)

type Config struct {
	HealthAddress         string
	DatabaseURL           string
	MigrationsDir         string
	Concurrency           int
	JobTimeout            time.Duration
	PollInterval          time.Duration
	ShutdownTimeout       time.Duration
	Storage               Storage
	MediaStorage          Storage
	ObjectStorageProxyURL string
	LLM                   LLM
	Probe                 Probe
}

type Storage struct{ Endpoint, AccessKey, SecretKey, Bucket string }
type LLM struct {
	Provider, APIKey, BaseURL, Model string
	Profile                          processing.ProviderProfile
	RequestTimeout                   time.Duration
}

type Probe struct {
	BinaryPath      string
	ExpectedVersion string
	Timeout         time.Duration
	OutputMaxBytes  int64
	TempDir         string
	MaxDownloadSize int64
}

// LoadMediaProbe loads the shared database/storage contract without loading
// any AI-provider credential. Probe credentials and ffprobe bounds are kept
// separate from the full-pipeline worker configuration.
func LoadMediaProbe(lookup LookupEnv) (Config, error) {
	for _, key := range []string{mediaBucketEnvironment, mediaProbeAccessKeyEnvironment, mediaProbeSecretKeyEnvironment} {
		if _, err := required(lookup, key); err != nil {
			return Config{}, err
		}
	}
	loaded, err := Load(func(key string) (string, bool) {
		if key == llmProviderEnvironment {
			return "fake", true
		}
		switch key {
		case storageBucketEnvironment:
			return lookup(mediaBucketEnvironment)
		case storageAccessKeyEnvironment:
			return lookup(mediaProbeAccessKeyEnvironment)
		case storageSecretKeyEnvironment:
			return lookup(mediaProbeSecretKeyEnvironment)
		case mediaBucketEnvironment, mediaProbeAccessKeyEnvironment, mediaProbeSecretKeyEnvironment:
			return "", false
		}
		return lookup(key)
	})
	if err != nil {
		return Config{}, err
	}
	proxyURL, err := loadObjectStorageProxyURL(lookup, true)
	if err != nil {
		return Config{}, err
	}
	timeout, err := boundedDuration(lookup, probeTimeoutEnvironment, 10*time.Minute, time.Millisecond, 15*time.Minute)
	if err != nil {
		return Config{}, err
	}
	outputBytes, err := boundedInt64(lookup, probeOutputBytesEnvironment, 1024*1024, 1024, 16*1024*1024)
	if err != nil {
		return Config{}, err
	}
	maxDownloadBytes, err := boundedInt64(lookup, probeMaxDownloadBytesEnvironment, 500*1024*1024, 1, 500*1024*1024)
	if err != nil {
		return Config{}, err
	}
	return Config{
		HealthAddress:         loaded.HealthAddress,
		DatabaseURL:           loaded.DatabaseURL,
		MigrationsDir:         loaded.MigrationsDir,
		Concurrency:           loaded.Concurrency,
		JobTimeout:            loaded.JobTimeout,
		PollInterval:          loaded.PollInterval,
		ShutdownTimeout:       loaded.ShutdownTimeout,
		Storage:               loaded.Storage,
		MediaStorage:          loaded.MediaStorage,
		ObjectStorageProxyURL: proxyURL,
		LLM:                   loaded.LLM,
		Probe: Probe{
			BinaryPath:      value(lookup, probeBinaryPathEnvironment, "/usr/local/bin/ffprobe"),
			ExpectedVersion: value(lookup, probeVersionEnvironment, "6.1.2"),
			Timeout:         timeout,
			OutputMaxBytes:  outputBytes,
			TempDir:         value(lookup, probeTempDirEnvironment, "/tmp/media-probe"),
			MaxDownloadSize: maxDownloadBytes,
		},
	}, nil
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
	endpoint, err = normalizeStorageEndpoint(lookup, endpoint)
	if err != nil {
		return Config{}, err
	}
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
	mediaStorage, err := optionalMediaStorage(lookup, endpoint)
	if err != nil {
		return Config{}, err
	}
	if mediaStorage.Bucket != "" && mediaStorage.Bucket == bucket {
		return Config{}, fmt.Errorf("%s must differ from %s", mediaBucketEnvironment, storageBucketEnvironment)
	}
	objectStorageProxyURL, err := loadObjectStorageProxyURL(lookup, mediaStorage.Bucket != "")
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
	concurrency, err := boundedInt(lookup, concurrencyEnvironment, 2, 1, 32)
	if err != nil {
		return Config{}, err
	}
	jobTimeout, err := boundedDuration(lookup, jobTimeoutEnvironment, 10*time.Minute, time.Millisecond, 14*time.Minute)
	if err != nil {
		return Config{}, err
	}
	pollInterval, err := boundedDuration(lookup, pollIntervalEnvironment, time.Second, 100*time.Millisecond, time.Minute)
	if err != nil {
		return Config{}, err
	}
	shutdownTimeout, err := boundedDuration(lookup, shutdownTimeoutEnvironment, 30*time.Second, time.Second, 2*time.Minute)
	if err != nil {
		return Config{}, err
	}
	return Config{HealthAddress: healthAddress, DatabaseURL: databaseURL, MigrationsDir: migrationsDir, Concurrency: concurrency, JobTimeout: jobTimeout, PollInterval: pollInterval, ShutdownTimeout: shutdownTimeout, Storage: Storage{endpoint, accessKey, secretKey, bucket}, MediaStorage: mediaStorage, ObjectStorageProxyURL: objectStorageProxyURL, LLM: llm}, nil
}

func optionalMediaStorage(lookup LookupEnv, endpoint string) (Storage, error) {
	keys := []string{mediaBucketEnvironment, fullPipelineMediaAccessKeyEnvironment, fullPipelineMediaSecretKeyEnvironment}
	present := 0
	for _, key := range keys {
		if raw, ok := lookup(key); ok && strings.TrimSpace(raw) != "" {
			present++
		}
	}
	if present == 0 {
		return Storage{}, nil
	}
	if present != len(keys) {
		return Storage{}, fmt.Errorf("%s, %s, and %s must be configured together", keys[0], keys[1], keys[2])
	}
	mediaBucket, _ := required(lookup, mediaBucketEnvironment)
	mediaAccessKey, _ := required(lookup, fullPipelineMediaAccessKeyEnvironment)
	mediaSecretKey, _ := required(lookup, fullPipelineMediaSecretKeyEnvironment)
	return Storage{Endpoint: endpoint, AccessKey: mediaAccessKey, SecretKey: mediaSecretKey, Bucket: mediaBucket}, nil
}

func loadObjectStorageProxyURL(lookup LookupEnv, requireForMedia bool) (string, error) {
	proxyURL := value(lookup, objectStorageEgressProxyEnvironment, "")
	if requireForMedia && value(lookup, "NODE_ENV", "development") == "production" {
		if proxyURL == "" {
			return "", fmt.Errorf("%s is required", objectStorageEgressProxyEnvironment)
		}
	}
	if proxyURL != "" {
		if err := validateProxyURL(objectStorageEgressProxyEnvironment, proxyURL); err != nil {
			return "", err
		}
	}
	return proxyURL, nil
}

func boundedInt(lookup LookupEnv, key string, fallback, minimum, maximum int) (int, error) {
	raw := value(lookup, key, strconv.Itoa(fallback))
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
}

func boundedDuration(lookup LookupEnv, key string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw := value(lookup, key, strconv.FormatInt(fallback.Milliseconds(), 10))
	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a positive integer duration in milliseconds", key)
	}
	duration := time.Duration(milliseconds) * time.Millisecond
	if duration < minimum || duration > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d milliseconds", key, minimum.Milliseconds(), maximum.Milliseconds())
	}
	return duration, nil
}

func boundedInt64(lookup LookupEnv, key string, fallback, minimum, maximum int64) (int64, error) {
	raw := value(lookup, key, strconv.FormatInt(fallback, 10))
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
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

func normalizeStorageEndpoint(lookup LookupEnv, endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if strings.ContainsAny(endpoint, ":/?#") {
		return "", fmt.Errorf("%s must be a host name or IP address without scheme, port, path, query, or fragment", storageEndpointEnvironment)
	}
	scheme := "http"
	if value(lookup, storageUseSSLEnvironment, "false") == "true" {
		scheme = "https"
	}
	port, err := required(lookup, storagePortEnvironment)
	if err != nil {
		return "", err
	}
	if _, err := strconv.ParseUint(port, 10, 16); err != nil {
		return "", fmt.Errorf("%s must be a valid port", storagePortEnvironment)
	}
	return scheme + "://" + endpoint + ":" + port, nil
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

func validateProxyURL(key, raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("%s must be an absolute HTTP or HTTPS URL", key)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("%s must not contain credentials, a path, query parameters, or a fragment", key)
	}
	return nil
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
