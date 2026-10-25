package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestSensitiveAttributesAreRedacted(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, slog.LevelDebug)

	const value = "value-that-must-not-appear"
	logger.Info("login",
		"db_password", value,
		"authorization_header", value,
		"session_token", value,
		"cookie", value,
		"DATABASE_URL", value,
	)

	out := buf.String()
	if strings.Contains(out, value) {
		t.Fatalf("log output contains a sensitive value: %s", out)
	}
	if got := strings.Count(out, Redacted); got != 5 {
		t.Fatalf("redacted count = %d, want 5; output: %s", got, out)
	}
}

func TestOrdinaryAttributesAreKept(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, slog.LevelInfo)

	logger.Info("request", "method", "GET", "status", 200, "request_id", "abc123")

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("log line is not JSON: %v", err)
	}
	if rec["method"] != "GET" || rec["request_id"] != "abc123" {
		t.Fatalf("ordinary attributes were altered: %v", rec)
	}
}

func TestLevelFiltersLowerSeverity(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, slog.LevelWarn)

	logger.Info("quiet")
	if buf.Len() != 0 {
		t.Fatalf("info record written at warn level: %s", buf.String())
	}
}
