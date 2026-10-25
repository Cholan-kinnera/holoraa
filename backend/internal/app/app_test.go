package app

import (
	"testing"

	"github.com/Cholan-kinnera/holoraa/backend/internal/config"
	"github.com/Cholan-kinnera/holoraa/backend/internal/mail"
)

func TestNewSenderRefusesFakeMailInProduction(t *testing.T) {
	_, err := newSender(config.Config{
		Env:  config.EnvProduction,
		Mail: config.MailConfig{Provider: config.MailProviderFake, OutboxDir: t.TempDir()},
	})
	if err == nil {
		t.Fatal("production accepted the fake mail provider")
	}
}

func TestNewSenderAllowsFakeMailInDevelopment(t *testing.T) {
	s, err := newSender(config.Config{
		Env:  config.EnvDevelopment,
		Mail: config.MailConfig{Provider: config.MailProviderFake, OutboxDir: t.TempDir()},
	})
	if err != nil {
		t.Fatalf("development refused fake mail: %v", err)
	}
	if _, ok := s.(*mail.Fake); !ok {
		t.Fatalf("sender = %T, want *mail.Fake", s)
	}
}

func TestNewSenderUsesResendWhenConfigured(t *testing.T) {
	s, err := newSender(config.Config{
		Env:  config.EnvProduction,
		Mail: config.MailConfig{Provider: config.MailProviderResend, From: "no-reply@example.test", ResendAPIKey: "re_placeholder"},
	})
	if err != nil {
		t.Fatalf("newSender: %v", err)
	}
	if _, ok := s.(*mail.Resend); !ok {
		t.Fatalf("sender = %T, want *mail.Resend", s)
	}
}
