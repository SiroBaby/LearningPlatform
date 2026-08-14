package config

import (
	"fmt"
	"net"
	"strings"
)

const (
	healthAddressEnvironment = "AI_WORKER_HEALTH_ADDRESS"
)

type LookupEnv func(string) (string, bool)

type Config struct {
	HealthAddress string
}

func Load(lookup LookupEnv) (Config, error) {
	healthAddress, err := requiredAddress(lookup)
	if err != nil {
		return Config{}, err
	}

	return Config{HealthAddress: healthAddress}, nil
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
