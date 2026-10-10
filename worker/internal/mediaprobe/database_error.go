package mediaprobe

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"regexp"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5/pgconn"
)

// DatabaseStage names where a PostgreSQL connection attempt failed. It is a
// bounded log value: raw pgx errors echo the host and user, so they are never
// logged.
type DatabaseStage string

const (
	DatabaseStageConfig         DatabaseStage = "config"
	DatabaseStageDNS            DatabaseStage = "dns"
	DatabaseStageConnectRefused DatabaseStage = "connect_refused"
	DatabaseStageConnectReset   DatabaseStage = "connect_reset"
	DatabaseStageConnectTimeout DatabaseStage = "connect_timeout"
	DatabaseStageUpstreamClosed DatabaseStage = "upstream_closed"
	DatabaseStageTLSVerify      DatabaseStage = "tls_verify"
	DatabaseStageTLS            DatabaseStage = "tls"
	DatabaseStageAuth           DatabaseStage = "auth"
	DatabaseStageServer         DatabaseStage = "server"
	DatabaseStageCanceled       DatabaseStage = "canceled"
	DatabaseStageUnknown        DatabaseStage = "unknown"
)

const sqlStateAuthorizationClass = "28"

var sqlStatePattern = regexp.MustCompile(`^[0-9A-Z]{5}$`)

// DatabaseErrorClass is the log-safe classification of a connection error.
type DatabaseErrorClass struct {
	Stage     DatabaseStage
	SQLState  string
	Retryable bool
}

// ClassifyDatabaseError maps a pgx connection error to a log-safe stage. Only
// transient network failures (refused, reset, timeout, EOF from the forwarder)
// are retryable; server-reported errors such as SQLSTATE class 28/3D/42 and
// certificate verification failures need an operator and fail at once.
func ClassifyDatabaseError(err error) DatabaseErrorClass {
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		return classifyPgError(pgError)
	}
	if errors.Is(err, context.Canceled) {
		return DatabaseErrorClass{Stage: DatabaseStageCanceled}
	}
	if isTLSVerificationError(err) {
		return DatabaseErrorClass{Stage: DatabaseStageTLSVerify}
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return DatabaseErrorClass{Stage: DatabaseStageConnectRefused, Retryable: true}
	}
	if errors.Is(err, syscall.ECONNRESET) {
		return DatabaseErrorClass{Stage: DatabaseStageConnectReset, Retryable: true}
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return DatabaseErrorClass{Stage: DatabaseStageUpstreamClosed, Retryable: true}
	}
	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		return DatabaseErrorClass{Stage: DatabaseStageDNS, Retryable: dnsError.IsTimeout || dnsError.IsTemporary}
	}
	if isTimeoutError(err) {
		return DatabaseErrorClass{Stage: DatabaseStageConnectTimeout, Retryable: true}
	}
	if isTLSError(err) {
		return DatabaseErrorClass{Stage: DatabaseStageTLS}
	}
	return DatabaseErrorClass{Stage: DatabaseStageUnknown}
}

func classifyPgError(pgError *pgconn.PgError) DatabaseErrorClass {
	sqlState := ""
	if sqlStatePattern.MatchString(pgError.Code) {
		sqlState = pgError.Code
	}
	stage := DatabaseStageServer
	if strings.HasPrefix(sqlState, sqlStateAuthorizationClass) {
		stage = DatabaseStageAuth
	}
	return DatabaseErrorClass{Stage: stage, SQLState: sqlState}
}

func isTLSVerificationError(err error) bool {
	var verificationError *tls.CertificateVerificationError
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	return errors.As(err, &verificationError) || errors.As(err, &unknownAuthority) ||
		errors.As(err, &hostname) || errors.As(err, &invalid)
}

func isTLSError(err error) bool {
	var alert tls.AlertError
	var recordHeader tls.RecordHeaderError
	return errors.As(err, &alert) || errors.As(err, &recordHeader)
}

func isTimeoutError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || pgconn.Timeout(err) {
		return true
	}
	var netError net.Error
	return errors.As(err, &netError) && netError.Timeout()
}
