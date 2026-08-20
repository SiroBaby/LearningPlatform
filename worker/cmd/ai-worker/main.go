package main

import (
	"context"
	"errors"
	"fmt"
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

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("worker.bootstrap.failed", "code", "WORKER_BOOTSTRAP_FAILED")
		os.Exit(1)
	}
}

func run() error {
	workerConfig, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	if len(os.Args) > 2 || (len(os.Args) == 2 && os.Args[1] != "preflight") {
		return fmt.Errorf("usage: ai-worker [preflight]")
	}
	preflightOnly := len(os.Args) == 2

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	var ready *atomic.Bool
	if !preflightOnly {
		server, readiness, err := startUnreadyHealthServer(workerConfig.HealthAddress)
		if err != nil {
			return err
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
			var failure processing.Failure
			code := "PROVIDER_PREFLIGHT_FAILED"
			if errors.As(err, &failure) {
				code = string(failure.Code)
			}
			slog.Error("worker.provider.preflight.failed", "event", "worker.provider.preflight.failed", "code", code)
			return fmt.Errorf("provider preflight: %w", err)
		}
		slog.Info("worker.provider.preflight.succeeded", "event", "worker.provider.preflight.succeeded", "capability", workerConfig.LLM.Profile.CapabilityVersion, "transport", workerConfig.LLM.Profile.Transport, "structured_output_mode", workerConfig.LLM.Profile.StructuredOutputMode)
	}
	if preflightOnly {
		return nil
	}

	migrationConnection, err := pgx.Connect(ctx, workerConfig.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect migration runner: %w", err)
	}
	if err := migrations.Run(ctx, migrationConnection, workerConfig.MigrationsDir); err != nil {
		migrationConnection.Close(ctx)
		return fmt.Errorf("run startup migrations: %w", err)
	}
	migrationConnection.Close(ctx)
	store, err := processing.NewPostgresStore(ctx, workerConfig.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	objects, err := processing.NewS3Reader(workerConfig.Storage.Endpoint, workerConfig.Storage.AccessKey, workerConfig.Storage.SecretKey, workerConfig.Storage.Bucket)
	if err != nil {
		return err
	}
	if err := objects.Check(ctx); err != nil {
		return err
	}
	bootstrap := consumer.New(store, objects, generator)
	if err := bootstrap.Start(ctx); err != nil {
		return fmt.Errorf("start consumer bootstrap: %w", err)
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
