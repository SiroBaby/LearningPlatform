package config

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/url"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	databaseSSLModeEnvironment = "DB_SSL_MODE"
	databaseSSLCAEnvironment   = "DB_SSL_CA"
)

// DatabaseSSLMode uses the same vocabulary as the API (`disabled`, `verify-ca`)
// so both runtimes can read the same DB_SSL_MODE parameter.
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
	host             string
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

func (database Database) tlsConfig() *tls.Config {
	switch database.sslMode {
	case DatabaseSSLModeVerifyFull:
		return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: database.rootCAs, ServerName: database.host}
	case DatabaseSSLModeVerifyCA:
		rootCAs := database.rootCAs
		return &tls.Config{
			MinVersion: tls.VersionTLS12,
			// Hostname checking is skipped only for verify-ca; the chain is verified below.
			InsecureSkipVerify: true,
			VerifyConnection: func(state tls.ConnectionState) error {
				return verifyCertificateChain(state.PeerCertificates, rootCAs)
			},
		}
	default:
		return nil
	}
}

func verifyCertificateChain(certificates []*x509.Certificate, rootCAs *x509.CertPool) error {
	if len(certificates) == 0 {
		return errors.New("database server presented no certificate")
	}
	intermediates := x509.NewCertPool()
	for _, certificate := range certificates[1:] {
		intermediates.AddCert(certificate)
	}
	_, err := certificates[0].Verify(x509.VerifyOptions{Roots: rootCAs, Intermediates: intermediates})
	return err
}

func loadDatabase(lookup LookupEnv) (Database, error) {
	host, err := required(lookup, databaseHostEnvironment)
	if err != nil {
		return Database{}, err
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
	// pgx's sslmode only seeds the parse; applyTLS replaces it with the validated policy.
	pgxSSLMode := "require"
	if sslMode == DatabaseSSLModeDisabled {
		pgxSSLMode = "disable"
	}
	connectionURL := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(user, password),
		Host:     host + ":" + port,
		Path:     name,
		RawQuery: url.Values{"sslmode": {pgxSSLMode}}.Encode(),
	}
	return Database{connectionString: connectionURL.String(), host: host, sslMode: sslMode, rootCAs: rootCAs}, nil
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
