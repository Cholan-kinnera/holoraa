// Package health provides the liveness and readiness handlers.
//
// Liveness reports that the process is running and never checks dependencies.
// Readiness reports whether the database answers within a timeout. A failure
// returns 503 with Problem Details and no internal detail.
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/problem"
)

// Pinger is the part of the database pool that readiness needs.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Handler serves the health endpoints.
type Handler struct {
	db      Pinger
	timeout time.Duration
	log     *slog.Logger
}

// New returns a Handler. timeout bounds the readiness database check.
func New(db Pinger, timeout time.Duration, log *slog.Logger) *Handler {
	return &Handler{db: db, timeout: timeout, log: log}
}

type liveBody struct {
	Status string `json:"status"`
}

type readyBody struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// Live answers GET /v1/health.
func (h *Handler) Live(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, h.log, r, http.StatusOK, liveBody{Status: "ok"})
}

// Ready answers GET /v1/ready.
func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	if err := h.db.Ping(ctx); err != nil {
		// Log the error type only. Driver messages can carry connection detail.
		h.log.WarnContext(r.Context(), "readiness check failed",
			"check", "database",
			"error_type", fmt.Sprintf("%T", err),
		)
		if werr := problem.Write(w, http.StatusServiceUnavailable,
			"The database is not reachable.", r.URL.Path); werr != nil {
			h.log.ErrorContext(r.Context(), "write problem response", "error", werr.Error())
		}
		return
	}

	writeJSON(w, h.log, r, http.StatusOK, readyBody{Status: "ready", Database: "ok"})
}

func writeJSON(w http.ResponseWriter, log *slog.Logger, r *http.Request, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.ErrorContext(r.Context(), "write response", "error", err.Error())
	}
}
