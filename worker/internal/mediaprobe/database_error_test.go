package mediaprobe

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
)

const fakeServerSecret = "s3cret-user-and-host"

func TestClassifyDatabaseErrorMapsConstructedErrors(t *testing.T) {
	cases := []struct {
		name     string
		input    error
		expected DatabaseErrorClass
	}{
		{"auth password", &pgconn.PgError{Code: "28P01", Message: fakeServerSecret}, DatabaseErrorClass{Stage: DatabaseStageAuth, SQLState: "28P01"}},
		{"auth no login", &pgconn.PgError{Code: "28000"}, DatabaseErrorClass{Stage: DatabaseStageAuth, SQLState: "28000"}},
		{"unknown database", &pgconn.PgError{Code: "3D000"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "3D000"}},
		{"missing connect privilege", &pgconn.PgError{Code: "42501"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "42501"}},
		{"too many connections", &pgconn.PgError{Code: "53300"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "53300", Retryable: true}},
		{"cannot connect now", &pgconn.PgError{Code: "57P03"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "57P03", Retryable: true}},
		{"admin shutdown", &pgconn.PgError{Code: "57P01"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "57P01", Retryable: true}},
		{"malformed sqlstate dropped", &pgconn.PgError{Code: "28P01 " + fakeServerSecret}, DatabaseErrorClass{Stage: DatabaseStageServer}},
		{"unknown authority", fmt.Errorf("tls error: %w", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}), DatabaseErrorClass{Stage: DatabaseStageTLSVerify}},
		{"hostname mismatch", fmt.Errorf("tls error: %w", x509.HostnameError{Host: fakeServerSecret}), DatabaseErrorClass{Stage: DatabaseStageTLSVerify}},
		{"tls alert", fmt.Errorf("tls error: %w", tls.AlertError(40)), DatabaseErrorClass{Stage: DatabaseStageTLS}},
		{"refused", &net.OpError{Op: "dial", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}, DatabaseErrorClass{Stage: DatabaseStageConnectRefused, Retryable: true}},
		{"reset", fmt.Errorf("read: %w", syscall.ECONNRESET), DatabaseErrorClass{Stage: DatabaseStageConnectReset, Retryable: true}},
		{"eof", fmt.Errorf("receive message: %w", io.ErrUnexpectedEOF), DatabaseErrorClass{Stage: DatabaseStageUpstreamClosed, Retryable: true}},
		{"dns not found", &net.DNSError{Name: fakeServerSecret, IsNotFound: true}, DatabaseErrorClass{Stage: DatabaseStageDNS}},
		{"dns timeout", &net.DNSError{Name: fakeServerSecret, IsTimeout: true}, DatabaseErrorClass{Stage: DatabaseStageDNS, Retryable: true}},
		{"deadline", fmt.Errorf("dial: %w", context.DeadlineExceeded), DatabaseErrorClass{Stage: DatabaseStageConnectTimeout, Retryable: true}},
		{"canceled", fmt.Errorf("dial: %w", context.Canceled), DatabaseErrorClass{Stage: DatabaseStageCanceled}},
		{"unknown", errors.New(fakeServerSecret), DatabaseErrorClass{Stage: DatabaseStageUnknown}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			actual := ClassifyDatabaseError(testCase.input)
			if actual != testCase.expected {
				t.Fatalf("ClassifyDatabaseError() = %+v, want %+v", actual, testCase.expected)
			}
		})
	}
}

func TestClassifyDatabaseErrorMapsRealPgconnErrors(t *testing.T) {
	cases := []struct {
		name     string
		address  func(t *testing.T) string
		expected DatabaseErrorClass
	}{
		{"closed port is refused", closedAddress, DatabaseErrorClass{Stage: DatabaseStageConnectRefused, Retryable: true}},
		{"forwarder closing upstream is EOF", func(t *testing.T) string { return startFakeServer(t, closeAfterStartup) }, DatabaseErrorClass{Stage: DatabaseStageUpstreamClosed, Retryable: true}},
		{"silent server times out", func(t *testing.T) string { return startFakeServer(t, holdConnection) }, DatabaseErrorClass{Stage: DatabaseStageConnectTimeout, Retryable: true}},
		{"wrong password is auth", func(t *testing.T) string { return startFakeServer(t, rejectStartup("28P01")) }, DatabaseErrorClass{Stage: DatabaseStageAuth, SQLState: "28P01"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			config := fakeServerConfig(t, testCase.address(t))
			_, err := pgconn.ConnectConfig(ctx, config)
			if err == nil {
				t.Fatal("ConnectConfig() succeeded, want error")
			}
			actual := ClassifyDatabaseError(err)
			if actual != testCase.expected {
				t.Fatalf("ClassifyDatabaseError(%T) = %+v, want %+v", err, actual, testCase.expected)
			}
		})
	}
}

func TestClassifyDatabaseErrorMapsRealTLSPhaseErrors(t *testing.T) {
	cases := []struct {
		name     string
		handle   func(net.Conn)
		expected DatabaseErrorClass
	}{
		{"forwarder closing before the SSLRequest reply is EOF", closeAfterSSLRequest, DatabaseErrorClass{Stage: DatabaseStageUpstreamClosed, Retryable: true}},
		{"server refusing TLS is tls", refuseSSLRequest, DatabaseErrorClass{Stage: DatabaseStageTLS}},
		{"server resetting mid-handshake is tls", acceptSSLThenClose(resetConnection), DatabaseErrorClass{Stage: DatabaseStageTLS}},
		{"server closing after the ClientHello is tls", acceptSSLThenClose(readClientHello), DatabaseErrorClass{Stage: DatabaseStageTLS}},
		{"server hanging mid-handshake is tls", acceptSSLThenClose(holdConnection), DatabaseErrorClass{Stage: DatabaseStageTLS}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			config := fakeServerConfig(t, startFakeServer(t, testCase.handle))
			config.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: x509.NewCertPool(), ServerName: "database.invalid"}
			_, err := pgconn.ConnectConfig(ctx, config)
			if err == nil {
				t.Fatal("ConnectConfig() succeeded, want error")
			}
			actual := ClassifyDatabaseError(err)
			if actual != testCase.expected {
				t.Fatalf("ClassifyDatabaseError(%v) = %+v, want %+v", err, actual, testCase.expected)
			}
		})
	}
}

// A startup write failure on a plaintext connection is not a TLS handshake, so
// it keeps its network stage.
func TestClassifyDatabaseErrorKeepsPlaintextStartupWriteAsNetwork(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	config := fakeServerConfig(t, startFakeServer(t, holdConnection))
	dial := config.DialFunc
	config.DialFunc = func(ctx context.Context, network, address string) (net.Conn, error) {
		connection, err := dial(ctx, network, address)
		return resetOnWriteConn{Conn: connection}, err
	}
	_, err := pgconn.ConnectConfig(ctx, config)
	expected := DatabaseErrorClass{Stage: DatabaseStageConnectReset, Retryable: true}
	if actual := ClassifyDatabaseError(err); actual != expected {
		t.Fatalf("ClassifyDatabaseError(%v) = %+v, want %+v", err, actual, expected)
	}
}

type resetOnWriteConn struct{ net.Conn }

func (resetOnWriteConn) Write([]byte) (int, error) {
	return 0, &net.OpError{Op: "write", Net: "tcp", Err: os.NewSyscallError("write", syscall.ECONNRESET)}
}

func fakeServerConfig(t *testing.T, address string) *pgconn.Config {
	t.Helper()
	config, err := pgconn.ParseConfig("postgres://" + fakeServerSecret + ":" + fakeServerSecret + "@" + address + "/media?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	config.ConnectTimeout = 200 * time.Millisecond
	return config
}

func closedAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func startFakeServer(t *testing.T, handle func(net.Conn)) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	t.Cleanup(func() {
		close(done)
		_ = listener.Close()
	})
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				handle(connection)
				<-done
			}()
		}
	}()
	return listener.Addr().String()
}

// closeAfterStartup mimics HAProxy closing the client once the upstream is unreachable.
func closeAfterStartup(connection net.Conn) {
	_, _ = pgproto3.NewBackend(connection, connection).ReceiveStartupMessage()
	_ = connection.Close()
}

func holdConnection(net.Conn) {}

func rejectStartup(code string) func(net.Conn) {
	return func(connection net.Conn) {
		backend := pgproto3.NewBackend(connection, connection)
		if _, err := backend.ReceiveStartupMessage(); err != nil {
			return
		}
		backend.Send(&pgproto3.ErrorResponse{
			Severity: "FATAL",
			Code:     code,
			Message:  `password authentication failed for user "` + fakeServerSecret + `"`,
		})
		_ = backend.Flush()
	}
}

// sslRequestLength is the fixed size of a PostgreSQL SSLRequest packet.
const sslRequestLength = 8

func readSSLRequest(connection net.Conn) bool {
	_, err := io.ReadFull(connection, make([]byte, sslRequestLength))
	return err == nil
}

// closeAfterSSLRequest mimics HAProxy closing the client before the upstream answered.
func closeAfterSSLRequest(connection net.Conn) {
	readSSLRequest(connection)
	_ = connection.Close()
}

func refuseSSLRequest(connection net.Conn) {
	if readSSLRequest(connection) {
		_, _ = connection.Write([]byte{'N'})
	}
}

// acceptSSLThenClose answers 'S' like PostgreSQL, then ends the TLS handshake with close.
func acceptSSLThenClose(close func(net.Conn)) func(net.Conn) {
	return func(connection net.Conn) {
		if !readSSLRequest(connection) {
			return
		}
		if _, err := connection.Write([]byte{'S'}); err != nil {
			return
		}
		close(connection)
	}
}

// resetConnection closes with linger 0 so the client receives a RST mid-handshake.
func resetConnection(connection net.Conn) {
	if tcpConnection, isTCP := connection.(*net.TCPConn); isTCP {
		_ = tcpConnection.SetLinger(0)
	}
	_ = connection.Close()
}

// tlsRecordHeaderLength is the size of a TLS record header (type, version, length).
const tlsRecordHeaderLength = 5

// readClientHello consumes the whole ClientHello record, then closes cleanly (EOF).
func readClientHello(connection net.Conn) {
	header := make([]byte, tlsRecordHeaderLength)
	if _, err := io.ReadFull(connection, header); err == nil {
		recordLength := int(header[3])<<8 | int(header[4])
		_, _ = io.ReadFull(connection, make([]byte, recordLength))
	}
	_ = connection.Close()
}
