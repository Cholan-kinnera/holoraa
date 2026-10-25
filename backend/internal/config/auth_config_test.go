package config

import (
	"strings"
	"testing"
)

const validDSNForAuth = "postgres://holoraa:test-only-placeholder@127.0.0.1:5433/holoraa_dev?sslmode=disable"

func TestAuthSecretIsRequiredAndMinimumLength(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{"missing", ""},
		{"too short", "short-secret"},
		{"whitespace only", "                                  "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth, EnvAuthSecret: tt.value}))
			assertSetting(t, err, EnvAuthSecret)
		})
	}
}

func TestAuthSecretErrorNeverEchoesValue(t *testing.T) {
	const secret = "too-short-but-secret-0123"
	_, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth, EnvAuthSecret: secret}))
	if err == nil {
		t.Fatal("expected an error for a short secret")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error echoes the secret: %q", err.Error())
	}
}

func TestAllowedOriginsAreRequiredAndStrict(t *testing.T) {
	bad := []string{
		"",
		"ftp://example.com",
		"http://",
		"http://127.0.0.1:3000/app",
		"http://127.0.0.1:3000?x=1",
		"http://user:pass@127.0.0.1:3000",
		"not a url",
	}
	for _, origins := range bad {
		_, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth, EnvAllowedOrigins: origins}))
		assertSetting(t, err, EnvAllowedOrigins)
	}
}

func TestAllowedOriginsParseAndNormalise(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{
		EnvDatabaseURL:    validDSNForAuth,
		EnvAllowedOrigins: " http://127.0.0.1:3000 , https://app.example.test/ ",
	}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	want := []string{"http://127.0.0.1:3000", "https://app.example.test"}
	if len(cfg.AllowedOrigins) != len(want) {
		t.Fatalf("AllowedOrigins = %v, want %v", cfg.AllowedOrigins, want)
	}
	for i := range want {
		if cfg.AllowedOrigins[i] != want[i] {
			t.Fatalf("AllowedOrigins[%d] = %q, want %q", i, cfg.AllowedOrigins[i], want[i])
		}
	}
}

func TestCookieNameFollowsSecureSetting(t *testing.T) {
	secure, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !secure.CookieSecure || secure.CookieName != "__Host-holoraa_session" {
		t.Fatalf("default = (secure %v, name %q), want (true, __Host- name)", secure.CookieSecure, secure.CookieName)
	}

	local, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth, EnvCookieSecure: "false"}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if local.CookieSecure || local.CookieName != "holoraa_session" {
		t.Fatalf("local = (secure %v, name %q), want (false, unprefixed name)", local.CookieSecure, local.CookieName)
	}
}

func TestCookieSecureRejectsOtherValues(t *testing.T) {
	_, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth, EnvCookieSecure: "maybe"}))
	assertSetting(t, err, EnvCookieSecure)
}

func TestMailDefaultsToFakeProvider(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{EnvDatabaseURL: validDSNForAuth}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Mail.Provider != MailProviderFake || cfg.Mail.OutboxDir != DefaultMailOutboxDir {
		t.Fatalf("Mail = %+v, want fake provider with default outbox", cfg.Mail)
	}
	if cfg.Mail.ResendAPIKey != "" {
		t.Fatal("fake provider must not load a Resend key")
	}
}

func TestMailProviderRules(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		setting string
	}{
		{"unknown provider", map[string]string{EnvMailProvider: "smtp"}, EnvMailProvider},
		{"resend without from", map[string]string{EnvMailProvider: "resend", EnvResendAPIKey: "re_placeholder"}, EnvMailFrom},
		{"resend from is not an address", map[string]string{EnvMailProvider: "resend", EnvMailFrom: "nobody", EnvResendAPIKey: "re_placeholder"}, EnvMailFrom},
		{"resend without key", map[string]string{EnvMailProvider: "resend", EnvMailFrom: "no-reply@example.test"}, EnvResendAPIKey},
		{"resend key with spaces", map[string]string{EnvMailProvider: "resend", EnvMailFrom: "no-reply@example.test", EnvResendAPIKey: "re with space"}, EnvResendAPIKey},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := map[string]string{EnvDatabaseURL: validDSNForAuth}
			for k, v := range tt.env {
				env[k] = v
			}
			_, err := Load(fakeEnv(env))
			assertSetting(t, err, tt.setting)
		})
	}
}

func TestResendErrorsNeverEchoTheKey(t *testing.T) {
	const key = "re_do_not_print_this_key"
	_, err := Load(fakeEnv(map[string]string{
		EnvDatabaseURL:  validDSNForAuth,
		EnvMailProvider: "resend",
		EnvResendAPIKey: key + " with space",
	}))
	if err == nil {
		t.Fatal("expected an error for a key with spaces")
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("error echoes the key: %q", err.Error())
	}
}

func TestResendAcceptedWhenFullyConfigured(t *testing.T) {
	cfg, err := Load(fakeEnv(map[string]string{
		EnvDatabaseURL:  validDSNForAuth,
		EnvMailProvider: "resend",
		EnvMailFrom:     "Holoraa <no-reply@example.test>",
		EnvResendAPIKey: "re_placeholder",
	}))
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Mail.Provider != MailProviderResend || cfg.Mail.ResendAPIKey != "re_placeholder" {
		t.Fatalf("Mail = %+v, want resend with the configured key", cfg.Mail)
	}
}
