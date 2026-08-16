package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/SiroBaby/LearningPlatform/worker/internal/config"
	"github.com/SiroBaby/LearningPlatform/worker/internal/consumer"
	"github.com/SiroBaby/LearningPlatform/worker/internal/health"
	"github.com/SiroBaby/LearningPlatform/worker/internal/migrations"
	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
	"github.com/jackc/pgx/v5"
)

func main() {
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

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	migrationConnection, err := pgx.Connect(ctx, workerConfig.MigrationDatabaseURL)
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
	var generator processing.Generator = processing.FakeGenerator{}
	if workerConfig.LLM.Provider == "openai-compatible" {
		generator = processing.NewOpenAI(workerConfig.LLM.APIKey, workerConfig.LLM.BaseURL, workerConfig.LLM.Model)
	}
	bootstrap := consumer.New(store, objects, generator)
	if err := bootstrap.Start(ctx); err != nil {
		return fmt.Errorf("start consumer bootstrap: %w", err)
	}
	defer bootstrap.Close()

	server := health.NewServer(workerConfig.HealthAddress, bootstrap.Ready)
	if err := server.Start(); err != nil {
		return err
	}
	defer func() {
		if err := server.Close(context.Background()); err != nil {
			slog.Error("worker.health.shutdown.failed", "code", "HEALTH_SHUTDOWN_FAILED")
		}
	}()

	slog.Info("worker.started", "event", "worker.started", "runtime", "go-worker")
	<-ctx.Done()
	slog.Info("worker.shutdown.completed", "event", "worker.shutdown.completed", "runtime", "go-worker")
	return nil
}
