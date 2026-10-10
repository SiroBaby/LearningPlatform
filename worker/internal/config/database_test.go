package config

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

const testDatabaseHost = "learning-db.example.test"

type testAuthority struct {
	certificate *x509.Certificate
	key         *ecdsa.PrivateKey
	pem         string
}

var (
	testAuthorityInstance       = newTestAuthority()
	testCertificateAuthorityPEM = testAuthorityInstance.pem
	otherCertificateAuthority   = newTestAuthority()
)

func newTestAuthority() testAuthority {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "learning-platform test database CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		panic(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	return testAuthority{certificate: certificate, key: key, pem: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))}
}

func (authority testAuthority) issueServerCertificate(t *testing.T, dnsName string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: dnsName},
		DNSNames:     []string{dnsName},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, authority.certificate, &key.PublicKey, authority.key)
	if err != nil {
		t.Fatalf("issue server certificate: %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func databaseEnvironment(overrides map[string]string) map[string]string {
	env := map[string]string{
		databaseHostEnvironment:     testDatabaseHost,
		databasePortEnvironment:     "13039",
		databaseUserEnvironment:     "learning",
		databasePasswordEnvironment: "password",
		databaseNameEnvironment:     "learning",
		databaseSSLModeEnvironment:  string(DatabaseSSLModeVerifyCA),
		databaseSSLCAEnvironment:    testCertificateAuthorityPEM,
		"NODE_ENV":                  "production",
	}
	for key, value := range overrides {
		env[key] = value
	}
	return env
}

func loadTestDatabase(env map[string]string) (Database, error) {
	return loadDatabase(func(key string) (string, bool) { value, ok := env[key]; return value, ok })
}

func TestLoadDatabaseRejectsUnsafeTLSSettings(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		overrides map[string]string
		absent    string
		wantErr   string
	}{
		{name: "missing mode has no implicit default", absent: databaseSSLModeEnvironment, wantErr: "DB_SSL_MODE is required"},
		{name: "pgx prefer is rejected", overrides: map[string]string{databaseSSLModeEnvironment: "prefer"}, wantErr: "DB_SSL_MODE must be disabled, verify-ca, or verify-full"},
		{name: "pgx require is rejected", overrides: map[string]string{databaseSSLModeEnvironment: "require"}, wantErr: "DB_SSL_MODE must be disabled, verify-ca, or verify-full"},
		{name: "pgx disable spelling is rejected", overrides: map[string]string{databaseSSLModeEnvironment: "disable", "NODE_ENV": "development"}, wantErr: "DB_SSL_MODE must be disabled, verify-ca, or verify-full"},
		{name: "disabled is rejected in production", overrides: map[string]string{databaseSSLModeEnvironment: "disabled"}, wantErr: "DB_SSL_MODE must be verify-ca or verify-full when NODE_ENV is production"},
		{name: "verify-ca requires a CA", absent: databaseSSLCAEnvironment, wantErr: "DB_SSL_CA is required when DB_SSL_MODE is verify-ca"},
		{name: "verify-full requires a CA", overrides: map[string]string{databaseSSLModeEnvironment: "verify-full", databaseSSLCAEnvironment: " "}, wantErr: "DB_SSL_CA is required when DB_SSL_MODE is verify-full"},
		{name: "CA must be PEM", overrides: map[string]string{databaseSSLCAEnvironment: "not a certificate"}, wantErr: "DB_SSL_CA must contain at least one PEM certificate"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			inputEnvironment := databaseEnvironment(test.overrides)
			delete(inputEnvironment, test.absent)
			_, actualErr := loadTestDatabase(inputEnvironment)
			if actualErr == nil || actualErr.Error() != test.wantErr {
				t.Fatalf("loadDatabase() error = %v, want %q", actualErr, test.wantErr)
			}
		})
	}
}

func TestDatabaseVerifyFullSetsServerName(t *testing.T) {
	t.Parallel()
	database, err := loadTestDatabase(databaseEnvironment(map[string]string{databaseSSLModeEnvironment: "verify-full"}))
	if err != nil {
		t.Fatalf("loadDatabase() error = %v", err)
	}
	poolConfig, err := database.PoolConfig()
	if err != nil {
		t.Fatalf("PoolConfig() error = %v", err)
	}
	actualTLS := poolConfig.ConnConfig.TLSConfig
	if actualTLS == nil || actualTLS.ServerName != testDatabaseHost || actualTLS.InsecureSkipVerify || actualTLS.RootCAs == nil {
		t.Fatalf("verify-full TLS config = %#v", actualTLS)
	}
	if len(poolConfig.ConnConfig.Fallbacks) != 0 {
		t.Fatalf("verify-full fallbacks = %d, want none", len(poolConfig.ConnConfig.Fallbacks))
	}
	if poolConfig.ConnConfig.Port != 13039 {
		t.Fatalf("port = %d, want 13039", poolConfig.ConnConfig.Port)
	}
}

func TestDatabaseVerifyCAChecksChainWithoutFallback(t *testing.T) {
	t.Parallel()
	database, err := loadTestDatabase(databaseEnvironment(nil))
	if err != nil {
		t.Fatalf("loadDatabase() error = %v", err)
	}
	connConfig, err := database.ConnConfig()
	if err != nil {
		t.Fatalf("ConnConfig() error = %v", err)
	}
	actualTLS := connConfig.TLSConfig
	if actualTLS == nil || actualTLS.VerifyConnection == nil || len(connConfig.Fallbacks) != 0 {
		t.Fatalf("verify-ca TLS config = %#v, fallbacks = %d", actualTLS, len(connConfig.Fallbacks))
	}
	trusted := testAuthorityInstance.issueServerCertificate(t, "another-host.example.test")
	if err := actualTLS.VerifyConnection(tls.ConnectionState{PeerCertificates: parseCertificates(t, trusted)}); err != nil {
		t.Fatalf("verify-ca rejected a certificate from the configured CA: %v", err)
	}
	untrusted := otherCertificateAuthority.issueServerCertificate(t, testDatabaseHost)
	if err := actualTLS.VerifyConnection(tls.ConnectionState{PeerCertificates: parseCertificates(t, untrusted)}); err == nil {
		t.Fatal("verify-ca accepted a certificate from an unknown CA")
	}
	if err := actualTLS.VerifyConnection(tls.ConnectionState{}); err == nil {
		t.Fatal("verify-ca accepted a server without a certificate")
	}
}

func TestDatabaseDisabledIsExplicitOutsideProduction(t *testing.T) {
	t.Parallel()
	database, err := loadTestDatabase(databaseEnvironment(map[string]string{databaseSSLModeEnvironment: "disabled", databaseSSLCAEnvironment: "", "NODE_ENV": "test"}))
	if err != nil {
		t.Fatalf("loadDatabase() error = %v", err)
	}
	poolConfig, err := database.PoolConfig()
	if err != nil {
		t.Fatalf("PoolConfig() error = %v", err)
	}
	if poolConfig.ConnConfig.TLSConfig != nil || len(poolConfig.ConnConfig.Fallbacks) != 0 {
		t.Fatalf("disabled mode TLS = %#v, fallbacks = %d", poolConfig.ConnConfig.TLSConfig, len(poolConfig.ConnConfig.Fallbacks))
	}
}

// TestDatabaseHandshake drives pgx against a fake server that answers the
// PostgreSQL SSLRequest, proving the TLS policy is enforced on the wire.
func TestDatabaseHandshake(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		sslMode       DatabaseSSLMode
		acceptTLS     bool
		authority     testAuthority
		dnsName       string
		wantHandshake bool
	}{
		{name: "verify-full accepts the configured CA and host", sslMode: DatabaseSSLModeVerifyFull, acceptTLS: true, authority: testAuthorityInstance, dnsName: testDatabaseHost, wantHandshake: true},
		{name: "verify-full rejects a host mismatch", sslMode: DatabaseSSLModeVerifyFull, acceptTLS: true, authority: testAuthorityInstance, dnsName: "attacker.example.test"},
		{name: "verify-ca rejects an unknown CA", sslMode: DatabaseSSLModeVerifyCA, acceptTLS: true, authority: otherCertificateAuthority, dnsName: testDatabaseHost},
		{name: "verify-ca never falls back to plaintext", sslMode: DatabaseSSLModeVerifyCA, acceptTLS: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("listen: %v", err)
			}
			var serverCertificate tls.Certificate
			if test.acceptTLS {
				serverCertificate = test.authority.issueServerCertificate(t, test.dnsName)
			}
			serverResult := make(chan fakeServerResult, 1)
			go serveSSLRequest(listener, test.acceptTLS, serverCertificate, serverResult)
			_, port, _ := net.SplitHostPort(listener.Addr().String())
			database, err := loadTestDatabase(databaseEnvironment(map[string]string{databaseSSLModeEnvironment: string(test.sslMode), databasePortEnvironment: port}))
			if err != nil {
				t.Fatalf("loadDatabase() error = %v", err)
			}
			connConfig, err := database.ConnConfig()
			if err != nil {
				t.Fatalf("ConnConfig() error = %v", err)
			}
			// Keep the certificate host name but dial the local fake server.
			connConfig.LookupFunc = func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }
			connConfig.ConnectTimeout = 5 * time.Second
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			connection, err := pgx.ConnectConfig(ctx, connConfig)
			if err == nil {
				connection.Close(ctx)
				t.Fatal("ConnectConfig() succeeded against a fake server")
			}
			listener.Close()
			actualResult := <-serverResult
			if actualResult.plaintext {
				t.Fatalf("client sent a plaintext startup message (client error: %v)", err)
			}
			if actualResult.handshake != test.wantHandshake {
				t.Fatalf("server handshake completed = %v, want %v (client error: %v)", actualResult.handshake, test.wantHandshake, err)
			}
		})
	}
}

// sslRequestCode is the PostgreSQL SSLRequest protocol code (80877103) and
// startupProtocolVersion is the plaintext StartupMessage protocol 3.0 code.
var (
	sslRequestCode         = []byte{0x04, 0xd2, 0x16, 0x2f}
	startupProtocolVersion = []byte{0x00, 0x03, 0x00, 0x00}
)

type fakeServerResult struct {
	handshake bool
	plaintext bool
}

// serveSSLRequest accepts every client connection until the listener closes so
// a plaintext retry on a new connection is observed too.
func serveSSLRequest(listener net.Listener, acceptTLS bool, certificate tls.Certificate, result chan<- fakeServerResult) {
	var observed fakeServerResult
	for {
		connection, err := listener.Accept()
		if err != nil {
			result <- observed
			return
		}
		handshake, plaintext := answerSSLRequest(connection, acceptTLS, certificate)
		observed.handshake = observed.handshake || handshake
		observed.plaintext = observed.plaintext || plaintext
	}
}

func answerSSLRequest(connection net.Conn, acceptTLS bool, certificate tls.Certificate) (handshake, plaintext bool) {
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	request := make([]byte, 8)
	if _, err := io.ReadFull(connection, request); err != nil {
		return false, false
	}
	// Other request codes (for example a CancelRequest) are not a plaintext session.
	if string(request[4:]) != string(sslRequestCode) {
		return false, string(request[4:]) == string(startupProtocolVersion)
	}
	if !acceptTLS {
		_, _ = connection.Write([]byte{'N'})
		return false, false
	}
	_, _ = connection.Write([]byte{'S'})
	server := tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	return server.Handshake() == nil, false
}

func parseCertificates(t *testing.T, certificate tls.Certificate) []*x509.Certificate {
	t.Helper()
	parsed, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return []*x509.Certificate{parsed}
}

func TestDatabaseErrorsDoNotExposeCredentials(t *testing.T) {
	t.Parallel()
	database := Database{connectionString: "postgres://user:secret-password@%zz/learning"}
	_, err := database.PoolConfig()
	if err == nil || strings.Contains(err.Error(), "secret-password") {
		t.Fatalf("PoolConfig() error = %v, want redacted failure", err)
	}
}
