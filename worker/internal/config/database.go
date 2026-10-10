package config

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	databaseSSLModeEnvironment = "DB_SSL_MODE"
	databaseSSLCAEnvironment   = "DB_SSL_CA"
	// DB_SSL_SERVER_NAME names the certificate host when DB_HOST is an in-cluster
	// TCP forwarder (ADR-0031 §5) rather than the PostgreSQL server itself.
	databaseSSLServerNameEnvironment = "DB_SSL_SERVER_NAME"
)

// databaseServerNamePattern accepts a lowercase fully qualified DNS name; an IP
// address or single-label name could never match a managed database certificate.
var databaseServerNamePattern = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$`)

// DatabaseSSLMode uses the same vocabulary as the API (`disabled`, `verify-ca`)
// so both runtimes can read the same DB_SSL_MODE parameter. Both verify modes
// check the chain against DB_SSL_CA and the DB_HOST name, matching what the API
// enforces in practice; `verify-full` is accepted as an explicit alias.
type DatabaseSSLMode string

const (
	DatabaseSSLModeDisabled   DatabaseSSLMode = "disabled"
	DatabaseSSLModeVerifyCA   DatabaseSSLMode = "verify-ca"
	DatabaseSSLModeVerifyFull DatabaseSSLMode = "verify-full"
)

var errInvalidDatabaseSettings = errors.New("database connection settings are invalid")

// Database is the validated PostgreSQL connection contract. Connections must be
// built through PoolConfig or ConnConfig so certificate verification cannot be
// bypassed by pgx's default sslmode=prefer (unverified TLS with plaintext fallback).
type Database struct {
	connectionString string
	serverName       string
	sslMode          DatabaseSSLMode
	rootCAs          *x509.CertPool
}

// SSLMode reports the validated TLS mode.
func (database Database) SSLMode() DatabaseSSLMode { return database.sslMode }

// PoolConfig returns a pgxpool configuration with the validated TLS policy applied.
func (database Database) PoolConfig() (*pgxpool.Config, error) {
	poolConfig, err := pgxpool.ParseConfig(database.connectionString)
	if err != nil {
		// The pgx error may echo connection parameters; keep it out of the result.
		return nil, errInvalidDatabaseSettings
	}
	database.applyTLS(&poolConfig.ConnConfig.Config)
	return poolConfig, nil
}

// ConnConfig returns a single-connection pgx configuration with the validated TLS policy applied.
func (database Database) ConnConfig() (*pgx.ConnConfig, error) {
	connConfig, err := pgx.ParseConfig(database.connectionString)
	if err != nil {
		return nil, errInvalidDatabaseSettings
	}
	database.applyTLS(&connConfig.Config)
	return connConfig, nil
}

func (database Database) applyTLS(connectionConfig *pgconn.Config) {
	// A single host is configured, so any fallback could only be a weaker TLS variant.
	connectionConfig.Fallbacks = nil
	connectionConfig.TLSConfig = database.tlsConfig()
}

// tlsConfig verifies both the chain and the host name in every verify mode. The
// API passes `ssl: { ca, rejectUnauthorized: true }` to node-postgres, which sets
// `servername = host` and lets Node's tls.connect run checkServerIdentity, so its
// `verify-ca` already checks the host name; the Go worker must not be weaker for
// the same DB_SSL_MODE value. DB_SSL_SERVER_NAME only moves that check to the
// real server name when DB_HOST is a forwarder; it never disables it.
func (database Database) tlsConfig() *tls.Config {
	if database.sslMode == DatabaseSSLModeDisabled {
		return nil
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: database.rootCAs, ServerName: database.serverName}
}

func loadDatabase(lookup LookupEnv) (Database, error) {
	host, err := required(lookup, databaseHostEnvironment)
	if err != nil {
		return Database{}, err
	}
	// pgx reads a comma as a multi-host list, which applyTLS would silently truncate.
	if strings.Contains(host, ",") {
		return Database{}, fmt.Errorf("%s must be a single host", databaseHostEnvironment)
	}
	port, err := required(lookup, databasePortEnvironment)
	if err != nil {
		return Database{}, err
	}
	if _, err = strconv.ParseUint(port, 10, 16); err != nil {
		return Database{}, fmt.Errorf("%s must be a valid port", databasePortEnvironment)
	}
	user, err := required(lookup, databaseUserEnvironment)
	if err != nil {
		return Database{}, err
	}
	password, err := required(lookup, databasePasswordEnvironment)
	if err != nil {
		return Database{}, err
	}
	name, err := required(lookup, databaseNameEnvironment)
	if err != nil {
		return Database{}, err
	}
	sslMode, err := loadDatabaseSSLMode(lookup)
	if err != nil {
		return Database{}, err
	}
	rootCAs, err := loadDatabaseRootCAs(lookup, sslMode)
	if err != nil {
		return Database{}, err
	}
	serverName, err := loadDatabaseServerName(lookup, sslMode, host)
	if err != nil {
		return Database{}, err
	}
	// pgx's sslmode only seeds the parse; applyTLS replaces it with the validated policy.
	pgxSSLMode := "require"
	if sslMode == DatabaseSSLModeDisabled {
		pgxSSLMode = "disable"
	}
	connectionURL := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(user, password),
		Host:     net.JoinHostPort(host, port),
		Path:     name,
		RawQuery: url.Values{"sslmode": {pgxSSLMode}}.Encode(),
	}
	return Database{connectionString: connectionURL.String(), serverName: serverName, sslMode: sslMode, rootCAs: rootCAs}, nil
}

func loadDatabaseSSLMode(lookup LookupEnv) (DatabaseSSLMode, error) {
	raw, err := required(lookup, databaseSSLModeEnvironment)
	if err != nil {
		return "", err
	}
	sslMode := DatabaseSSLMode(raw)
	switch sslMode {
	case DatabaseSSLModeVerifyCA, DatabaseSSLModeVerifyFull:
		return sslMode, nil
	case DatabaseSSLModeDisabled:
		if value(lookup, "NODE_ENV", "development") == "production" {
			return "", fmt.Errorf("%s must be verify-ca or verify-full when NODE_ENV is production", databaseSSLModeEnvironment)
		}
		return sslMode, nil
	default:
		return "", fmt.Errorf("%s must be disabled, verify-ca, or verify-full", databaseSSLModeEnvironment)
	}
}

func loadDatabaseRootCAs(lookup LookupEnv, sslMode DatabaseSSLMode) (*x509.CertPool, error) {
	if sslMode == DatabaseSSLModeDisabled {
		return nil, nil
	}
	certificateAuthority, err := required(lookup, databaseSSLCAEnvironment)
	if err != nil {
		return nil, fmt.Errorf("%s is required when %s is %s", databaseSSLCAEnvironment, databaseSSLModeEnvironment, sslMode)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM([]byte(certificateAuthority)) {
		return nil, fmt.Errorf("%s must contain at least one PEM certificate", databaseSSLCAEnvironment)
	}
	return rootCAs, nil
}

// loadDatabaseServerName returns the host name the server certificate must
// match: DB_SSL_SERVER_NAME when set, otherwise DB_HOST.
func loadDatabaseServerName(lookup LookupEnv, sslMode DatabaseSSLMode, host string) (string, error) {
	serverName, ok := lookup(databaseSSLServerNameEnvironment)
	if !ok || strings.TrimSpace(serverName) == "" {
		return host, nil
	}
	if sslMode == DatabaseSSLModeDisabled {
		return "", fmt.Errorf("%s requires %s verify-ca or verify-full", databaseSSLServerNameEnvironment, databaseSSLModeEnvironment)
	}
	if !databaseServerNamePattern.MatchString(serverName) {
		return "", fmt.Errorf("%s must be a lowercase fully qualified host name", databaseSSLServerNameEnvironment)
	}
	return serverName, nil
}
