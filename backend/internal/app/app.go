// Package app wires configuration, the database pool, and the HTTP server together
// and runs them until the context is cancelled.
package app

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/config"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/httpapi"
	"github.com/Cholan-kinnera/holoraa/backend/internal/mail"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
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

	sender, err := newSender(cfg)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Log:      log,
			Health:   health.New(pool, readinessTimeout, log),
			Auth:     auth.New(pool, cfg.AuthSecret, sender, rand.Reader),
			Profiles: profile.NewRepo(pool),
			Security: httpapi.Security{
				CookieName:     cfg.CookieName,
				CookieSecure:   cfg.CookieSecure,
				AllowedOrigins: cfg.AllowedOrigins,
			},
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

// newSender returns the configured email sender. It refuses the fake provider
// in production even when the configuration asks for it, so a production
// process cannot silently drop sign-in codes into a local file.
func newSender(cfg config.Config) (mail.Sender, error) {
	switch cfg.Mail.Provider {
	case config.MailProviderFake:
		if cfg.Env == config.EnvProduction {
			return nil, fmt.Errorf("the fake mail provider is not allowed in production")
		}
		return mail.NewFake(cfg.Mail.OutboxDir), nil
	case config.MailProviderResend:
		return mail.NewResend(cfg.Mail.ResendAPIKey, cfg.Mail.From), nil
	default:
		return nil, fmt.Errorf("unknown mail provider")
	}
}
