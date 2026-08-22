package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"github.com/SiroBaby/LearningPlatform/worker/internal/config"
	"github.com/SiroBaby/LearningPlatform/worker/internal/consumer"
	"github.com/SiroBaby/LearningPlatform/worker/internal/health"
	"github.com/SiroBaby/LearningPlatform/worker/internal/migrations"
	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
	"github.com/jackc/pgx/v5"
)

type bootstrapFailureCode string

const (
	bootstrapConfiguration bootstrapFailureCode = "configuration"
	bootstrapProvider      bootstrapFailureCode = "provider"
	bootstrapMigration     bootstrapFailureCode = "migration"
	bootstrapDatabase      bootstrapFailureCode = "database"
	bootstrapStorage       bootstrapFailureCode = "storage"
	bootstrapConsumer      bootstrapFailureCode = "consumer"
	bootstrapHealth        bootstrapFailureCode = "health"
	bootstrapUnknown       bootstrapFailureCode = "unknown"
)

type bootstrapFailure struct {
	code bootstrapFailureCode
}

func (failure bootstrapFailure) Error() string {
	return "worker bootstrap failed: " + string(safeBootstrapFailureCode(failure.code))
}

func newBootstrapFailure(code bootstrapFailureCode) error {
	return bootstrapFailure{code: safeBootstrapFailureCode(code)}
}

func bootstrapFailureCodeOf(err error) bootstrapFailureCode {
	var failure bootstrapFailure
	if errors.As(err, &failure) {
		return safeBootstrapFailureCode(failure.code)
	}
	return bootstrapUnknown
}

func safeBootstrapFailureCode(code bootstrapFailureCode) bootstrapFailureCode {
	switch code {
	case bootstrapConfiguration, bootstrapProvider, bootstrapMigration, bootstrapDatabase, bootstrapStorage, bootstrapConsumer, bootstrapHealth, bootstrapUnknown:
		return code
	default:
		return bootstrapUnknown
	}
}

func providerPreflightBootstrapCode(err error) bootstrapFailureCode {
	var failure processing.Failure
	if errors.As(err, &failure) {
		return bootstrapProvider
	}
	return bootstrapUnknown
}

func providerPreflightFailureCode(err error) string {
	var failure processing.Failure
	if errors.As(err, &failure) {
		return string(failure.Code)
	}
	return "PROVIDER_PREFLIGHT_FAILED"
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("worker.bootstrap.failed", "code", "WORKER_BOOTSTRAP_FAILED", "bootstrap_code", bootstrapFailureCodeOf(err))
		os.Exit(1)
	}
}

func run() error {
	workerConfig, err := config.Load(os.LookupEnv)
	if err != nil {
		return newBootstrapFailure(bootstrapConfiguration)
	}
	if len(os.Args) > 2 || (len(os.Args) == 2 && os.Args[1] != "preflight") {
		return newBootstrapFailure(bootstrapConfiguration)
	}
	preflightOnly := len(os.Args) == 2

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	var ready *atomic.Bool
	if !preflightOnly {
		server, readiness, err := startUnreadyHealthServer(workerConfig.HealthAddress)
		if err != nil {
			return newBootstrapFailure(bootstrapHealth)
		}
		ready = readiness
		defer func() {
			if err := server.Close(context.Background()); err != nil {
				slog.Error("worker.health.shutdown.failed", "code", "HEALTH_SHUTDOWN_FAILED")
			}
		}()
	}
	var generator processing.Generator = processing.FakeGenerator{}
	if workerConfig.LLM.Provider == "openai-compatible" {
		provider := processing.NewOpenAI(workerConfig.LLM.APIKey, workerConfig.LLM.BaseURL, workerConfig.LLM.Model, workerConfig.LLM.Profile, workerConfig.LLM.RequestTimeout)
		generator = provider
		if err := provider.Preflight(ctx); err != nil {
			slog.Error("worker.provider.preflight.failed", "event", "worker.provider.preflight.failed", "code", providerPreflightFailureCode(err))
			return newBootstrapFailure(providerPreflightBootstrapCode(err))
		}
		slog.Info("worker.provider.preflight.succeeded", "event", "worker.provider.preflight.succeeded", "capability", workerConfig.LLM.Profile.CapabilityVersion, "transport", workerConfig.LLM.Profile.Transport, "structured_output_mode", workerConfig.LLM.Profile.StructuredOutputMode)
	}
	if preflightOnly {
		return nil
	}

	migrationConnection, err := pgx.Connect(ctx, workerConfig.DatabaseURL)
	if err != nil {
		return newBootstrapFailure(bootstrapDatabase)
	}
	if err := migrations.Run(ctx, migrationConnection, workerConfig.MigrationsDir); err != nil {
		migrationConnection.Close(ctx)
		return newBootstrapFailure(bootstrapMigration)
	}
	migrationConnection.Close(ctx)
	store, err := processing.NewPostgresStore(ctx, workerConfig.DatabaseURL)
	if err != nil {
		return newBootstrapFailure(bootstrapDatabase)
	}
	defer store.Close()
	objects, err := processing.NewS3Reader(workerConfig.Storage.Endpoint, workerConfig.Storage.AccessKey, workerConfig.Storage.SecretKey, workerConfig.Storage.Bucket)
	if err != nil {
		return newBootstrapFailure(bootstrapStorage)
	}
	if err := objects.Check(ctx); err != nil {
		return newBootstrapFailure(bootstrapStorage)
	}
	bootstrap := consumer.New(store, objects, generator)
	if err := bootstrap.Start(ctx); err != nil {
		return newBootstrapFailure(bootstrapConsumer)
	}
	defer bootstrap.Close()
	ready.Store(true)

	slog.Info("worker.started", "event", "worker.started", "runtime", "go-worker")
	<-ctx.Done()
	slog.Info("worker.shutdown.completed", "event", "worker.shutdown.completed", "runtime", "go-worker")
	return nil
}

func startUnreadyHealthServer(address string) (*health.Server, *atomic.Bool, error) {
	var ready atomic.Bool
	server := health.NewServer(address, ready.Load)
	if err := server.Start(); err != nil {
		return nil, nil, err
	}
	return server, &ready, nil
}
