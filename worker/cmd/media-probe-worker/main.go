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

type bootstrapFailure struct {
	code     bootstrapFailureCode
	database *mediaprobe.DatabaseConnectError
}

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

// newDatabaseBootstrapFailure keeps only the classified stage of a database
// error; the raw pgx message echoes host and user and must never be logged.
func newDatabaseBootstrapFailure(err error) error {
	var databaseError mediaprobe.DatabaseConnectError
	if !errors.As(err, &databaseError) {
		// Only PoolConfig returns another error type: the settings are invalid.
		databaseError.Stage = mediaprobe.DatabaseStageConfig
	}
	return bootstrapFailure{code: bootstrapDatabase, database: &databaseError}
}

// databaseBootstrapResult returns nil when SIGTERM canceled ctx while the
// database was still retrying: that is a clean shutdown, not a bootstrap failure.
func databaseBootstrapResult(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return nil
	}
	return newDatabaseBootstrapFailure(err)
}

func bootstrapFailureCodeOf(err error) bootstrapFailureCode {
	var failure bootstrapFailure
	if errors.As(err, &failure) {
		return safeBootstrapFailureCode(failure.code)
	}
	return bootstrapUnknown
}

// logBootstrapFailure emits the allowlisted bootstrap fields only.
func logBootstrapFailure(logger *slog.Logger, err error) {
	attributes := []any{"code", "MEDIA_PROBE_WORKER_BOOTSTRAP_FAILED", "bootstrap_code", bootstrapFailureCodeOf(err)}
	var failure bootstrapFailure
	if errors.As(err, &failure) && failure.database != nil {
		attributes = append(attributes,
			"database_stage", string(failure.database.Stage),
			"sqlstate", failure.database.SQLState,
			"attempts", failure.database.Attempts,
		)
	}
	logger.Error("media_probe_worker.bootstrap.failed", attributes...)
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		logBootstrapFailure(slog.Default(), err)
		os.Exit(1)
	}
}

func run() error {
	workerConfig, err := config.LoadMediaProbe(os.LookupEnv)
	if err != nil {
		return newBootstrapFailure(bootstrapConfiguration)
	}

	// SIGTERM cancels ctx during bootstrap too, so a database retry stops at once.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
		Timeout:         workerConfig.Probe.Timeout,
	}
	probeContext, probeCancel := context.WithTimeout(ctx, workerConfig.Probe.Timeout)
	err = probeRunner.CheckVersion(probeContext)
	probeCancel()
	if err != nil {
		return newBootstrapFailure(bootstrapProbe)
	}

	poolConfig, err := workerConfig.Database.PoolConfig()
	if err != nil {
		return newDatabaseBootstrapFailure(err)
	}
	store, err := mediaprobe.NewPostgresStore(ctx, poolConfig)
	if err != nil {
		bootstrapError := databaseBootstrapResult(ctx, err)
		if bootstrapError == nil {
			slog.Info("media_probe_worker.shutdown.completed", "event", "media_probe_worker.shutdown.completed", "runtime", "media-probe-worker")
		}
		return bootstrapError
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
	<-ctx.Done()
	ready.Store(false)
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
