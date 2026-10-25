// Package httpapi builds the HTTP router and its request-level middleware.
//
// Middleware in this package:
//   - assigns or accepts a request ID (validated, length-limited),
//   - writes one access-log record per request without query strings, headers,
//     or bodies,
//   - recovers from panics with a generic 500 and logs only the panic's type,
//   - answers unknown routes and methods with Problem Details.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/problem"
)

// RequestIDHeader carries the request ID in and out of the API.
const RequestIDHeader = "X-Request-Id"

// maxRequestIDLen bounds an external input (AGENTS.md: size limits).
const maxRequestIDLen = 64

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

type ctxKey struct{}

// Deps are the collaborators the router needs.
type Deps struct {
	Log    *slog.Logger
	Health *health.Handler
}

// NewRouter returns the API handler.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(securityHeaders)
	r.Use(requestLimits(d.Log))
	r.Use(requestID)
	r.Use(accessLog(d.Log))
	r.Use(recoverPanic(d.Log))

	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		writeProblem(w, req, d.Log, http.StatusNotFound, "No route matches this request.")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		writeProblem(w, req, d.Log, http.StatusMethodNotAllowed, "This method is not allowed for this route.")
	})

	r.Route("/v1", func(v1 chi.Router) {
		v1.Get("/health", d.Health.Live)
		v1.Get("/ready", d.Health.Ready)
	})
	return r
}

// Request size limits enforced by the application, so that the rejection is
// Problem Details. The server's own limit (internal/app) is set higher, so
// this middleware answers first for requests between the two limits.
const (
	maxRequestTargetLen   = 2048
	maxRequestHeaderBytes = 16 << 10
)

// requestLimits rejects oversized request targets (414) and oversized header
// sections (431) with Problem Details. Header size is measured as the sum of
// names and values plus a small per-field overhead, which approximates the
// bytes on the wire.
func requestLimits(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(r.RequestURI) > maxRequestTargetLen {
				writeProblem(w, r, log, http.StatusRequestURITooLong, "The request target is too long.")
				return
			}
			if headerBytes(r.Header) > maxRequestHeaderBytes {
				writeProblem(w, r, log, http.StatusRequestHeaderFieldsTooLarge, "The request headers are too large.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func headerBytes(h http.Header) int {
	n := 0
	for name, values := range h {
		for _, v := range values {
			n += len(name) + len(v) + 4
		}
	}
	return n
}

// securityHeaders sets defensive headers on every response, including errors.
// HSTS is not set here: it belongs to the TLS terminator, not the plain-HTTP
// listener that runs in development.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// requestID keeps a valid client-supplied ID or generates a new one. Invalid
// or oversized client values are replaced, never echoed.
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if !validRequestID.MatchString(id) || len(id) > maxRequestIDLen {
			id = newID()
		}
		w.Header().Set(RequestIDHeader, id)
		ctx := context.WithValue(r.Context(), ctxKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing is not recoverable for an ID; fall back to a
		// fixed marker rather than a weak ID.
		return "unavailable"
	}
	return hex.EncodeToString(b)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func accessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			log.InfoContext(r.Context(), "request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", requestIDFrom(r),
			)
		})
	}
}

func recoverPanic(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					// Log the type only. Panic values can contain request data.
					log.ErrorContext(r.Context(), "panic recovered",
						"path", r.URL.Path,
						"panic_type", fmt.Sprintf("%T", v),
						"request_id", requestIDFrom(r),
					)
					writeProblem(w, r, log, http.StatusInternalServerError, "An internal error occurred.")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func writeProblem(w http.ResponseWriter, r *http.Request, log *slog.Logger, status int, detail string) {
	if err := problem.Write(w, status, detail, r.URL.Path); err != nil {
		log.ErrorContext(r.Context(), "write problem response", "error", err.Error())
	}
}

func requestIDFrom(r *http.Request) string {
	if id, ok := r.Context().Value(ctxKey{}).(string); ok {
		return id
	}
	return ""
}
