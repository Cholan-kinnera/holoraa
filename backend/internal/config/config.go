// Package config loads and validates runtime configuration from the environment.
//
// Validation fails closed: any invalid or missing required value stops the
// process before it listens. Error messages name the setting but never
// include its value, because some values are secrets.
package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Environment variable names.
const (
	EnvHTTPAddr    = "HOLORAA_HTTP_ADDR"
	EnvLogLevel    = "HOLORAA_LOG_LEVEL"
	EnvDatabaseURL = "HOLORAA_DATABASE_URL"
)

// Defaults and limits.
const (
	DefaultHTTPAddr = "127.0.0.1:8080"
	DefaultLogLevel = "info"

	// maxDatabaseURLLen bounds an external input (AGENTS.md: every external
	// input has a size limit).
	maxDatabaseURLLen = 2048
)

// Config is the validated runtime configuration.
type Config struct {
	HTTPAddr    string
	LogLevel    slog.Level
	DatabaseURL string
}

// Error reports one invalid setting. It deliberately has no value field.
type Error struct {
	Setting string
	Reason  string
}

func (e *Error) Error() string {
	return fmt.Sprintf("invalid configuration: %s: %s", e.Setting, e.Reason)
}

// Load reads configuration through getenv, which is os.Getenv in production
// and a fake in tests.
func Load(getenv func(string) string) (Config, error) {
	var cfg Config

	addr := valueOr(getenv(EnvHTTPAddr), DefaultHTTPAddr)
	if err := validateAddr(addr); err != nil {
		return Config{}, &Error{Setting: EnvHTTPAddr, Reason: err.Error()}
	}
	cfg.HTTPAddr = addr

	level, err := parseLevel(valueOr(getenv(EnvLogLevel), DefaultLogLevel))
	if err != nil {
		return Config{}, &Error{Setting: EnvLogLevel, Reason: err.Error()}
	}
	cfg.LogLevel = level

	dsn := getenv(EnvDatabaseURL)
	if err := validateDatabaseURL(dsn); err != nil {
		return Config{}, &Error{Setting: EnvDatabaseURL, Reason: err.Error()}
	}
	cfg.DatabaseURL = dsn

	return cfg, nil
}

func valueOr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

func validateAddr(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("must be host:port")
	}
	if host == "" {
		return fmt.Errorf("host must not be empty")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("port must be a number from 1 to 65535")
	}
	return nil
}

func parseLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("must be one of debug, info, warn, error")
	}
}

func validateDatabaseURL(dsn string) error {
	if dsn == "" {
		return fmt.Errorf("is required")
	}
	if len(dsn) > maxDatabaseURLLen {
		return fmt.Errorf("must be at most %d characters", maxDatabaseURLLen)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		// url.Parse errors can echo the input, so the message is not reused.
		return fmt.Errorf("must be a valid postgres:// URL")
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return fmt.Errorf("must start with postgres://")
	}
	if u.Host == "" {
		return fmt.Errorf("must include a host")
	}
	return nil
}
