package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/SiroBaby/LearningPlatform/worker/internal/mediaprobe"
)

const (
	secretUser     = "probe-secret-user"
	secretPassword = "probe-secret-password"
	secretHost     = "probe-secret-host.invalid"
)

func TestLogBootstrapFailureEmitsOnlyAllowlistedDatabaseFields(t *testing.T) {
	inputError := newDatabaseBootstrapFailure(mediaprobe.DatabaseConnectError{
		DatabaseErrorClass: mediaprobe.DatabaseErrorClass{Stage: mediaprobe.DatabaseStageAuth, SQLState: "28P01"},
		Attempts:           1,
	})
	actual := captureBootstrapLog(t, inputError)
	expected := map[string]any{
		"level": "ERROR", "msg": "media_probe_worker.bootstrap.failed", "code": "MEDIA_PROBE_WORKER_BOOTSTRAP_FAILED",
		"bootstrap_code": "database", "database_stage": "auth", "sqlstate": "28P01", "attempts": float64(1),
	}
	for key, value := range expected {
		if actual[key] != value {
			t.Fatalf("log[%q] = %v, want %v (log %v)", key, actual[key], value, actual)
		}
	}
	if len(actual) != len(expected) {
		t.Fatalf("log has fields %v, want only %v", actual, expected)
	}
}

func TestLogBootstrapFailureMarksPoolConfigErrorsAsConfig(t *testing.T) {
	actual := captureBootstrapLog(t, newDatabaseBootstrapFailure(errors.New("parse "+secretHost)))
	if actual["database_stage"] != "config" || actual["attempts"] != float64(0) {
		t.Fatalf("log = %v, want database_stage=config attempts=0", actual)
	}
}

func TestLogBootstrapFailureOmitsDatabaseFieldsForOtherStages(t *testing.T) {
	actual := captureBootstrapLog(t, newBootstrapFailure(bootstrapProbe))
	if _, hasStage := actual["database_stage"]; hasStage || actual["bootstrap_code"] != "probe" {
		t.Fatalf("log = %v, want probe failure without database fields", actual)
	}
}

func TestLogBootstrapFailureDoesNotLeakRealConnectionSettings(t *testing.T) {
	poolConfig, err := pgxpool.ParseConfig("postgres://" + secretUser + ":" + secretPassword + "@" + secretHost + ":5432/media?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	store, err := mediaprobe.NewPostgresStore(ctx, poolConfig)
	if store != nil {
		store.Close()
		t.Fatal("NewPostgresStore() succeeded against an invalid host")
	}
	var buffer bytes.Buffer
	logBootstrapFailure(slog.New(slog.NewJSONHandler(&buffer, nil)), newDatabaseBootstrapFailure(err))
	for _, secret := range []string{secretUser, secretPassword, secretHost} {
		if strings.Contains(buffer.String(), secret) {
			t.Fatalf("bootstrap log leaks %q: %s", secret, buffer.String())
		}
	}
	if !strings.Contains(buffer.String(), `"database_stage":`) {
		t.Fatalf("bootstrap log lacks database_stage: %s", buffer.String())
	}
}

func captureBootstrapLog(t *testing.T, err error) map[string]any {
	t.Helper()
	var buffer bytes.Buffer
	logBootstrapFailure(slog.New(slog.NewJSONHandler(&buffer, nil)), err)
	var record map[string]any
	if err := json.Unmarshal(buffer.Bytes(), &record); err != nil {
		t.Fatalf("decode log %q: %v", buffer.String(), err)
	}
	delete(record, "time")
	return record
}
