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
		{"too many connections", &pgconn.PgError{Code: "53300"}, DatabaseErrorClass{Stage: DatabaseStageServer, SQLState: "53300"}},
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
