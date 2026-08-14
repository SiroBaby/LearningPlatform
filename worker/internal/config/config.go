package config

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

const (
	databaseURLEnvironment   = "AI_WORKER_DATABASE_URL"
	healthAddressEnvironment = "AI_WORKER_HEALTH_ADDRESS"
)

type LookupEnv func(string) (string, bool)

type Config struct {
	DatabaseURL   *url.URL
	HealthAddress string
}

func Load(lookup LookupEnv) (Config, error) {
	databaseURL, err := requiredPostgresURL(lookup)
	if err != nil {
		return Config{}, err
	}

	healthAddress, err := requiredAddress(lookup)
	if err != nil {
		return Config{}, err
	}

	return Config{DatabaseURL: databaseURL, HealthAddress: healthAddress}, nil
}

func requiredPostgresURL(lookup LookupEnv) (*url.URL, error) {
	rawURL, ok := lookup(databaseURLEnvironment)
	if !ok || strings.TrimSpace(rawURL) == "" {
		return nil, fmt.Errorf("%s is required", databaseURLEnvironment)
	}

	databaseURL, err := url.Parse(rawURL)
	if err != nil || databaseURL == nil {
		return nil, fmt.Errorf("%s must be a valid PostgreSQL URL", databaseURLEnvironment)
	}
	if databaseURL.Scheme != "postgres" && databaseURL.Scheme != "postgresql" {
		return nil, fmt.Errorf("%s must use postgres or postgresql", databaseURLEnvironment)
	}
	if databaseURL.Host == "" {
		return nil, fmt.Errorf("%s must be a valid PostgreSQL URL", databaseURLEnvironment)
	}

	return databaseURL, nil
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
