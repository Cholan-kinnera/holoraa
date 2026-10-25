// Package app wires configuration, the database pool, and the HTTP server together
// and runs them until the context is cancelled.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/config"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/httpapi"
	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
)

// Timeouts and limits for the HTTP server. They protect against slow clients
// and oversized headers.
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 10 * time.Second
	writeTimeout      = 10 * time.Second
	idleTimeout       = 60 * time.Second
	// The application enforces 16 KiB for headers with Problem Details (see
	// httpapi). This server limit is higher, so only headers above 64 KiB reach
	// net/http's own plain-text 431 response.
	maxHeaderBytes = 64 << 10

	readinessTimeout = 2 * time.Second
	shutdownTimeout  = 10 * time.Second
)

// Serve runs the API until ctx is cancelled, then shuts down gracefully.
// A database that is unreachable at startup does not stop the server; the
// readiness endpoint reports it instead.
func Serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	pool, err := store.Open(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database pool: %w", err)
	}
	defer pool.Close()

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Log:    log,
			Health: health.New(pool, readinessTimeout, log),
		}),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.ListenAndServe()
	}()
	log.Info("api listening", "addr", cfg.HTTPAddr)

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve http: %w", err)
	case <-ctx.Done():
		log.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown http: %w", err)
	}
	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve http: %w", err)
	}
	log.Info("stopped")
	return nil
}
