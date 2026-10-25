// Package logging builds the structured logger used by the API.
//
// Logs are JSON, one object per line. Attributes whose keys look sensitive are
// replaced with a fixed marker before they are written. Redaction is by key
// name, so callers should still avoid logging values they do not need.
package logging

import (
	"io"
	"log/slog"
	"strings"
)

// Redacted is written in place of any sensitive attribute value.
const Redacted = "[REDACTED]"

// sensitiveKeyParts are matched case-insensitively as substrings of an
// attribute key. A key that contains any of them is redacted.
var sensitiveKeyParts = []string{
	"password",
	"passwd",
	"secret",
	"token",
	"authorization",
	"cookie",
	"dsn",
	"database_url",
	"databaseurl",
}

// New returns a JSON logger that writes to w at the given minimum level.
func New(w io.Writer, level slog.Level) *slog.Logger {
	h := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: redact,
	})
	return slog.New(h)
}

func redact(_ []string, a slog.Attr) slog.Attr {
	if isSensitive(a.Key) {
		return slog.String(a.Key, Redacted)
	}
	return a
}

func isSensitive(key string) bool {
	k := strings.ToLower(key)
	for _, part := range sensitiveKeyParts {
		if strings.Contains(k, part) {
			return true
		}
	}
	return false
}
