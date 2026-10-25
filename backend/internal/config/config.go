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
	EnvEnv            = "HOLORAA_ENV"
	EnvHTTPAddr       = "HOLORAA_HTTP_ADDR"
	EnvLogLevel       = "HOLORAA_LOG_LEVEL"
	EnvDatabaseURL    = "HOLORAA_DATABASE_URL"
	EnvAuthSecret     = "HOLORAA_AUTH_SECRET"
	EnvAllowedOrigins = "HOLORAA_ALLOWED_ORIGINS"
	EnvCookieSecure   = "HOLORAA_COOKIE_SECURE"
	EnvMailProvider   = "HOLORAA_MAIL_PROVIDER"
	EnvMailOutboxDir  = "HOLORAA_MAIL_OUTBOX_DIR"
	EnvMailFrom       = "HOLORAA_MAIL_FROM"
	EnvResendAPIKey   = "HOLORAA_RESEND_API_KEY"
)

// Defaults and limits.
const (
	// EnvProduction is the default. A missing HOLORAA_ENV fails closed.
	EnvProduction  = "production"
	EnvDevelopment = "development"

	DefaultHTTPAddr      = "127.0.0.1:8080"
	DefaultLogLevel      = "info"
	DefaultMailProvider  = "fake"
	DefaultMailOutboxDir = ".local/mail"

	MailProviderFake   = "fake"
	MailProviderResend = "resend"

	// minAuthSecretLen is the least acceptable length for the HMAC key (32 bytes
	// of input, as characters).
	minAuthSecretLen = 32

	// maxDatabaseURLLen bounds an external input (AGENTS.md: every external
	// input has a size limit).
	maxDatabaseURLLen = 2048
	maxOriginsLen     = 1024
	maxMailFromLen    = 320
	maxResendKeyLen   = 256
	maxOutboxDirLen   = 512

	cookieNameSecure = "__Host-holoraa_session"
	cookieNameLocal  = "holoraa_session"
)

// MailConfig selects and configures the email sender.
type MailConfig struct {
	Provider     string
	OutboxDir    string
	From         string
	ResendAPIKey string
}

// Config is the validated runtime configuration.
type Config struct {
	// Env is production or development. Production refuses the fake mail
	// provider and insecure cookies.
	Env            string
	HTTPAddr       string
	LogLevel       slog.Level
	DatabaseURL    string
	AuthSecret     []byte
	AllowedOrigins []string
	CookieSecure   bool
	// CookieName follows the production rule: the __Host- prefix applies when
	// the cookie is Secure, and plain HTTP development uses the unprefixed name.
	CookieName string
	Mail       MailConfig
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

	env, err := parseEnv(valueOr(getenv(EnvEnv), EnvProduction))
	if err != nil {
		return Config{}, &Error{Setting: EnvEnv, Reason: err.Error()}
	}
	cfg.Env = env

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

	secret := strings.TrimSpace(getenv(EnvAuthSecret))
	if err := validateAuthSecret(secret); err != nil {
		return Config{}, &Error{Setting: EnvAuthSecret, Reason: err.Error()}
	}
	cfg.AuthSecret = []byte(secret)

	origins, err := parseOrigins(getenv(EnvAllowedOrigins))
	if err != nil {
		return Config{}, &Error{Setting: EnvAllowedOrigins, Reason: err.Error()}
	}
	cfg.AllowedOrigins = origins

	secure, err := parseBool(valueOr(getenv(EnvCookieSecure), "true"))
	if err != nil {
		return Config{}, &Error{Setting: EnvCookieSecure, Reason: err.Error()}
	}
	if env == EnvProduction && !secure {
		return Config{}, &Error{Setting: EnvCookieSecure, Reason: "must be true in production"}
	}
	cfg.CookieSecure = secure
	cfg.CookieName = cookieNameLocal
	if secure {
		cfg.CookieName = cookieNameSecure
	}

	mail, err := loadMail(env, getenv)
	if err != nil {
		return Config{}, err
	}
	cfg.Mail = mail

	return cfg, nil
}

// loadMail selects the email provider. In production an explicit, supported
// provider is required and the fake provider is refused: a production process
// must never silently drop sign-in codes into a local file.
func loadMail(env string, getenv func(string) string) (MailConfig, error) {
	var m MailConfig
	raw := strings.TrimSpace(getenv(EnvMailProvider))
	if raw == "" {
		if env == EnvProduction {
			return MailConfig{}, &Error{Setting: EnvMailProvider, Reason: "is required in production; set resend"}
		}
		raw = DefaultMailProvider
	}
	m.Provider = raw
	switch m.Provider {
	case MailProviderFake:
		if env == EnvProduction {
			return MailConfig{}, &Error{Setting: EnvMailProvider, Reason: "fake is for development only; set resend in production"}
		}
		dir := valueOr(getenv(EnvMailOutboxDir), DefaultMailOutboxDir)
		if len(dir) > maxOutboxDirLen {
			return MailConfig{}, &Error{Setting: EnvMailOutboxDir, Reason: fmt.Sprintf("must be at most %d characters", maxOutboxDirLen)}
		}
		m.OutboxDir = dir
	case MailProviderResend:
		from := strings.TrimSpace(getenv(EnvMailFrom))
		if from == "" || len(from) > maxMailFromLen || !strings.Contains(from, "@") {
			return MailConfig{}, &Error{Setting: EnvMailFrom, Reason: "is required when the mail provider is resend, and must be an email address"}
		}
		key := strings.TrimSpace(getenv(EnvResendAPIKey))
		if key == "" || len(key) > maxResendKeyLen || strings.ContainsAny(key, " \t\r\n") {
			return MailConfig{}, &Error{Setting: EnvResendAPIKey, Reason: "is required when the mail provider is resend, and must not contain spaces"}
		}
		m.From = from
		m.ResendAPIKey = key
	default:
		return MailConfig{}, &Error{Setting: EnvMailProvider, Reason: "must be fake (development only) or resend"}
	}
	return m, nil
}

func parseEnv(s string) (string, error) {
	switch s {
	case EnvProduction, EnvDevelopment:
		return s, nil
	default:
		return "", fmt.Errorf("must be production or development")
	}
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

func parseBool(s string) (bool, error) {
	b, err := strconv.ParseBool(s)
	if err != nil {
		return false, fmt.Errorf("must be true or false")
	}
	return b, nil
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

func validateAuthSecret(secret string) error {
	if secret == "" {
		return fmt.Errorf("is required; make dev-env generates it for development")
	}
	if len(secret) < minAuthSecretLen {
		return fmt.Errorf("must be at least %d characters", minAuthSecretLen)
	}
	return nil
}

// parseOrigins accepts a comma-separated list of origins. Each origin is a
// scheme and host, with an optional port and no path, query, fragment, or
// credentials.
func parseOrigins(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("is required")
	}
	if len(raw) > maxOriginsLen {
		return nil, fmt.Errorf("must be at most %d characters", maxOriginsLen)
	}
	var origins []string
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimSpace(part)
		u, err := url.Parse(o)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("each origin must be an http or https origin")
		}
		if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, fmt.Errorf("each origin must be scheme and host only")
		}
		origins = append(origins, u.Scheme+"://"+u.Host)
	}
	return origins, nil
}
