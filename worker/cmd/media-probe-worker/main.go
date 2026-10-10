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
	"github.com/SiroBaby/LearningPlatform/worker/internal/health"
	"github.com/SiroBaby/LearningPlatform/worker/internal/mediaprobe"
)

type bootstrapFailureCode string

const (
	bootstrapConfiguration bootstrapFailureCode = "configuration"
	bootstrapProbe         bootstrapFailureCode = "probe"
	bootstrapDatabase      bootstrapFailureCode = "database"
	bootstrapStorage       bootstrapFailureCode = "storage"
	bootstrapWorker        bootstrapFailureCode = "worker"
	bootstrapHealth        bootstrapFailureCode = "health"
	bootstrapUnknown       bootstrapFailureCode = "unknown"
)

type bootstrapFailure struct{ code bootstrapFailureCode }

func (failure bootstrapFailure) Error() string {
	return "media probe worker bootstrap failed: " + string(failure.code)
}

func newBootstrapFailure(code bootstrapFailureCode) error {
	return bootstrapFailure{code: safeBootstrapFailureCode(code)}
}

func safeBootstrapFailureCode(code bootstrapFailureCode) bootstrapFailureCode {
	switch code {
	case bootstrapConfiguration, bootstrapProbe, bootstrapDatabase, bootstrapStorage, bootstrapWorker, bootstrapHealth, bootstrapUnknown:
		return code
	default:
		return bootstrapUnknown
	}
}

func bootstrapFailureCodeOf(err error) bootstrapFailureCode {
	var failure bootstrapFailure
	if errors.As(err, &failure) {
		return safeBootstrapFailureCode(failure.code)
	}
	return bootstrapUnknown
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("media_probe_worker.bootstrap.failed", "code", "MEDIA_PROBE_WORKER_BOOTSTRAP_FAILED", "bootstrap_code", bootstrapFailureCodeOf(err))
		os.Exit(1)
	}
}

func run() error {
	workerConfig, err := config.LoadMediaProbe(os.LookupEnv)
	if err != nil {
		return newBootstrapFailure(bootstrapConfiguration)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	server, ready, err := startUnreadyHealthServer(workerConfig.HealthAddress)
	if err != nil {
		return newBootstrapFailure(bootstrapHealth)
	}
	defer func() {
		if err := server.Close(context.Background()); err != nil {
			slog.Error("media_probe_worker.health.shutdown.failed", "code", "HEALTH_SHUTDOWN_FAILED")
		}
	}()

	probeRunner := mediaprobe.FFProbeRunner{
		BinaryPath:      workerConfig.Probe.BinaryPath,
		ExpectedVersion: workerConfig.Probe.ExpectedVersion,
		OutputMaxBytes:  workerConfig.Probe.OutputMaxBytes,
	}
	probeContext, probeCancel := context.WithTimeout(ctx, workerConfig.Probe.Timeout)
	err = probeRunner.CheckVersion(probeContext)
	probeCancel()
	if err != nil {
		return newBootstrapFailure(bootstrapProbe)
	}

	store, err := mediaprobe.NewPostgresStore(ctx, workerConfig.DatabaseURL)
	if err != nil {
		return newBootstrapFailure(bootstrapDatabase)
	}
	defer store.Close()
	objects, err := mediaprobe.NewS3Store(
		workerConfig.Storage.Endpoint,
		workerConfig.Storage.AccessKey,
		workerConfig.Storage.SecretKey,
		workerConfig.ObjectStorageProxyURL,
	)
	if err != nil {
		return newBootstrapFailure(bootstrapStorage)
	}
	probeWorker := mediaprobe.NewWorker(store, objects, probeRunner, slog.Default(), mediaprobe.Options{
		Concurrency:     workerConfig.Concurrency,
		PollInterval:    workerConfig.PollInterval,
		JobTimeout:      workerConfig.JobTimeout,
		ShutdownTimeout: workerConfig.ShutdownTimeout,
		TempDir:         workerConfig.Probe.TempDir,
		MaxDownloadSize: workerConfig.Probe.MaxDownloadSize,
	})
	if err := probeWorker.Start(ctx); err != nil {
		return newBootstrapFailure(bootstrapWorker)
	}
	defer probeWorker.Close()
	ready.Store(true)

	slog.Info("media_probe_worker.started", "event", "media_probe_worker.started", "runtime", "media-probe-worker")
	<-signals
	ready.Store(false)
	cancel()
	probeWorker.Close()
	slog.Info("media_probe_worker.shutdown.completed", "event", "media_probe_worker.shutdown.completed", "runtime", "media-probe-worker")
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
