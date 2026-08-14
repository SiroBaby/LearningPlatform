package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/SiroBaby/LearningPlatform/worker/internal/config"
	"github.com/SiroBaby/LearningPlatform/worker/internal/health"
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

	server := health.NewServer(workerConfig.HealthAddress)
	if err := server.Start(); err != nil {
		return err
	}
	defer func() {
		if err := server.Close(context.Background()); err != nil {
			slog.Error("worker.health.shutdown.failed", "code", "HEALTH_SHUTDOWN_FAILED")
		}
	}()

	slog.Info("worker.started", "event", "worker.started", "runtime", "go-worker")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	<-signals
	slog.Info("worker.shutdown.completed", "event", "worker.shutdown.completed", "runtime", "go-worker")
	return nil
}
