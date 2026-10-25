package health

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// stubPinger is a unit-test double for the handler logic only. Database
// behaviour is covered by real-database tests in internal/store and by the
// unreachable-DSN test below.
type stubPinger struct {
	err error
}

func (s stubPinger) Ping(context.Context) error { return s.err }

func discard() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestLiveAlwaysReturnsOK(t *testing.T) {
	h := New(stubPinger{err: errors.New("db down")}, time.Second, discard())
	rec := httptest.NewRecorder()

	h.Live(rec, httptest.NewRequest(http.MethodGet, "/v1/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("liveness status = %d, want 200 even when the database is down", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("body = %v, want status ok", body)
	}
}

func TestReadyReturnsOKWhenDatabaseAnswers(t *testing.T) {
	h := New(stubPinger{}, time.Second, discard())
	rec := httptest.NewRecorder()

	h.Ready(rec, httptest.NewRequest(http.MethodGet, "/v1/ready", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("readiness status = %d, want 200", rec.Code)
	}
}

func TestReadyReturns503ProblemWhenDatabaseFails(t *testing.T) {
	h := New(stubPinger{err: errors.New("connection refused: 10.0.0.5:5432 user=secret")}, time.Second, discard())
	rec := httptest.NewRecorder()

	h.Ready(rec, httptest.NewRequest(http.MethodGet, "/v1/ready", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness status = %d, want 503", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	if strings.Contains(rec.Body.String(), "connection refused") || strings.Contains(rec.Body.String(), "10.0.0.5") {
		t.Fatalf("internal error detail leaked to the client: %s", rec.Body.String())
	}
}

// TestIntegrationReadyWithUnreachableDatabase uses a real pgx pool pointed at
// a closed port. It needs no running database, so it always runs.
func TestIntegrationReadyWithUnreachableDatabase(t *testing.T) {
	pool, err := pgxpool.New(context.Background(),
		"postgres://holoraa:unused@127.0.0.1:1/holoraa?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	h := New(pool, 2*time.Second, discard())
	rec := httptest.NewRecorder()
	h.Ready(rec, httptest.NewRequest(http.MethodGet, "/v1/ready", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness against an unreachable database = %d, want 503", rec.Code)
	}
}

func TestReadyLogsErrorTypeNotMessage(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	h := New(stubPinger{err: errors.New("password=hunter2")}, time.Second, log)

	h.Ready(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/ready", nil))

	if strings.Contains(buf.String(), "hunter2") {
		t.Fatalf("log output contains the driver message: %s", buf.String())
	}
	if !strings.Contains(buf.String(), "error_type") {
		t.Fatalf("log output lacks error_type: %s", buf.String())
	}
}
