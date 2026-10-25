package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
)

type stubPinger struct{ err error }

func (s stubPinger) Ping(context.Context) error { return s.err }

func newTestRouter(t *testing.T, pinger health.Pinger, logBuf *bytes.Buffer) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(logBuf, nil))
	return NewRouter(Deps{
		Log:    log,
		Health: health.New(pinger, time.Second, log),
	})
}

func serve(h http.Handler, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLivenessRoute(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{err: errors.New("down")}, &logs)

	rec := serve(h, http.MethodGet, "/v1/health", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/health = %d, want 200", rec.Code)
	}
}

func TestReadinessRouteReturns503WhenDatabaseDown(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{err: errors.New("down")}, &logs)

	rec := serve(h, http.MethodGet, "/v1/ready", nil)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /v1/ready = %d, want 503", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
}

func TestUnknownRouteReturnsProblemDetails(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	rec := serve(h, http.MethodGet, "/v1/nope", nil)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	assertProblem(t, rec, 404, "/v1/nope")
}

func TestWrongMethodReturnsProblemDetails(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	rec := serve(h, http.MethodPost, "/v1/health", nil)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	assertProblem(t, rec, 405, "/v1/health")
}

func TestRequestIDIsGeneratedWhenAbsent(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	rec := serve(h, http.MethodGet, "/v1/health", nil)

	id := rec.Header().Get(RequestIDHeader)
	if len(id) != 32 {
		t.Fatalf("generated request ID %q has length %d, want 32", id, len(id))
	}
}

func TestValidRequestIDIsEchoed(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	rec := serve(h, http.MethodGet, "/v1/health", map[string]string{RequestIDHeader: "abc-123.XYZ_9"})

	if got := rec.Header().Get(RequestIDHeader); got != "abc-123.XYZ_9" {
		t.Fatalf("request ID = %q, want the client value echoed", got)
	}
}

func TestInvalidRequestIDIsReplaced(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	bad := []string{
		"has space",
		"new\nline",
		"<script>",
		strings.Repeat("a", maxRequestIDLen+1),
	}
	for _, value := range bad {
		rec := serve(h, http.MethodGet, "/v1/health", map[string]string{RequestIDHeader: value})
		got := rec.Header().Get(RequestIDHeader)
		if got == value {
			t.Fatalf("invalid request ID %q was echoed", value)
		}
		if len(got) != 32 {
			t.Fatalf("replacement for %q = %q, want a generated 32-char ID", value, got)
		}
	}
}

func TestAccessLogOmitsQueryStringAndHeaders(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(t, stubPinger{}, &logs)

	serve(h, http.MethodGet, "/v1/health?token=query-secret-value", map[string]string{
		"Cookie": "session=cookie-secret-value",
	})

	out := logs.String()
	if strings.Contains(out, "query-secret-value") || strings.Contains(out, "cookie-secret-value") {
		t.Fatalf("access log contains query or header data: %s", out)
	}
	if !strings.Contains(out, `"path":"/v1/health"`) {
		t.Fatalf("access log lacks the path: %s", out)
	}
}

func TestPanicIsRecoveredWithGenericProblem(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))

	panicking := recoverPanic(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("internal detail: user=alice password=hunter2")
	}))
	rec := httptest.NewRecorder()
	panicking.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "hunter2") || strings.Contains(rec.Body.String(), "alice") {
		t.Fatalf("panic detail leaked to the client: %s", rec.Body.String())
	}
	if strings.Contains(logs.String(), "hunter2") {
		t.Fatalf("panic value leaked into logs: %s", logs.String())
	}
}

// TestIntegrationReadyWithRealDatabase runs the real router against the real
// test database. It skips when the test URL is not set (see make test-db).
func TestIntegrationReadyWithRealDatabase(t *testing.T) {
	adminURL := os.Getenv("HOLORAA_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("HOLORAA_TEST_DATABASE_URL is not set; run make test-db")
	}
	pool, err := pgxpool.New(context.Background(), adminURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	h := NewRouter(Deps{Log: log, Health: health.New(pool, 5*time.Second, log)})

	rec := serve(h, http.MethodGet, "/v1/ready", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/ready against the real database = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if body["database"] != "ok" {
		t.Fatalf("database = %q, want ok", body["database"])
	}
}

func assertProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, instance string) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	var p map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if int(p["status"].(float64)) != status {
		t.Fatalf("problem status = %v, want %d", p["status"], status)
	}
	if p["instance"] != instance {
		t.Fatalf("problem instance = %v, want %q", p["instance"], instance)
	}
}
