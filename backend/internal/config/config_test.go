package config

import (
	"errors"
	"log/slog"
	"strings"
	"testing"
)

// fakeEnv returns a getenv backed by a map. Tests supply configuration this
// way, so no real environment or .env file is read.
//
// Auth settings that every test needs are supplied from a base set. A test
// overrides any of them by setting the key, even to an empty string.
func fakeEnv(values map[string]string) func(string) string {
	return func(k string) string {
		if v, ok := values[k]; ok {
			return v
		}
		return baseEnv[k]
	}
}

// baseEnv holds valid values for settings that are not the subject of a test.
// The secret is a placeholder for tests only. It is never a real credential.
var baseEnv = map[string]string{
	EnvEnv:            EnvDevelopment,
	EnvAuthSecret:     "test-only-auth-secret-0123456789abcdef-placeholder",
	EnvAllowedOrigins: "http://127.0.0.1:3000",
}

const validDSN = "postgres://holoraa:test-only-placeholder@127.0.0.1:5433/holoraa_dev?sslmode=disable"

func TestLoadAppliesDefaults(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSN}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.HTTPAddr != DefaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, DefaultHTTPAddr)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want info", cfg.LogLevel)
	}
	if cfg.DatabaseURL != validDSN {
		t.Errorf("DatabaseURL not carried through")
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	_, err := Load(fakeEnv(nil))
	assertSetting(t, err, EnvDatabaseURL)
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		setting string
	}{
		{"addr without port", map[string]string{EnvDatabaseURL: validDSN, EnvHTTPAddr: "127.0.0.1"}, EnvHTTPAddr},
		{"addr port out of range", map[string]string{EnvDatabaseURL: validDSN, EnvHTTPAddr: "127.0.0.1:70000"}, EnvHTTPAddr},
		{"addr empty host", map[string]string{EnvDatabaseURL: validDSN, EnvHTTPAddr: ":8080"}, EnvHTTPAddr},
		{"unknown log level", map[string]string{EnvDatabaseURL: validDSN, EnvLogLevel: "verbose"}, EnvLogLevel},
		{"wrong scheme", map[string]string{EnvDatabaseURL: "mysql://u:p@h/db"}, EnvDatabaseURL},
		{"missing host", map[string]string{EnvDatabaseURL: "postgres:///db"}, EnvDatabaseURL},
		{"too long", map[string]string{EnvDatabaseURL: "postgres://h/" + strings.Repeat("a", maxDatabaseURLLen)}, EnvDatabaseURL},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(fakeEnv(tt.env))
			assertSetting(t, err, tt.setting)
		})
	}
}

func TestLoadErrorsNeverEchoSecretValues(t *testing.T) {
	// A malformed URL that contains a recognisable secret-looking value.
	const secret = "s3cr3t-do-not-print"
	bad := "postgres://holoraa:" + secret + "@[::1"

	_, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: bad}))
	if err == nil {
		t.Fatal("expected an error for malformed URL")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error message echoes the secret: %q", err.Error())
	}
}

func TestLoadAcceptsLogLevelsCaseInsensitively(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSN, EnvLogLevel: "DEBUG"}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("LogLevel = %v, want debug", cfg.LogLevel)
	}
}

func assertSetting(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error naming %s", want)
	}
	var cfgErr *Error
	if !errors.As(err, &cfgErr) {
		t.Fatalf("error type = %T, want *config.Error", err)
	}
	if cfgErr.Setting != want {
		t.Fatalf("Setting = %q, want %q", cfgErr.Setting, want)
	}
}
