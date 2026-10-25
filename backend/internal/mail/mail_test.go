package mail

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestFakeWritesPrivateFilesWithoutTheRecipientInTheName(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file modes are not meaningful on Windows")
	}
	dir := filepath.Join(t.TempDir(), "outbox")
	f := NewFake(dir)
	if err := f.Send(context.Background(), Message{To: "private@example.test", Subject: "S", Text: "code 123456"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("outbox entries = %d, %v; want 1", len(entries), err)
	}
	name := entries[0].Name()
	if strings.Contains(name, "private") || strings.Contains(name, "@") {
		t.Fatalf("file name %q reveals the recipient", name)
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %v, want 0600", info.Mode().Perm())
	}
	body, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "code 123456") {
		t.Fatal("message body was not written")
	}
}

func TestResendPostsTheExpectedRequest(t *testing.T) {
	var gotAuth, gotType string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotType = r.Header.Get("Content-Type")
		if r.Method != http.MethodPost || r.URL.Path != "/emails" {
			t.Errorf("request = %s %s, want POST /emails", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"id":"email_123"}`)
	}))
	defer srv.Close()

	r := &Resend{APIKey: "re_placeholder_key", From: "no-reply@example.test", URL: srv.URL + "/emails", Client: srv.Client()}
	if err := r.Send(context.Background(), Message{To: "to@example.test", Subject: "Code", Text: "body"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotAuth != "Bearer re_placeholder_key" || gotType != "application/json" {
		t.Fatalf("headers: auth=%q type=%q", gotAuth, gotType)
	}
	if gotBody["from"] != "no-reply@example.test" || gotBody["subject"] != "Code" || gotBody["text"] != "body" {
		t.Fatalf("body = %v", gotBody)
	}
	to, _ := gotBody["to"].([]any)
	if len(to) != 1 || to[0] != "to@example.test" {
		t.Fatalf("to = %v", gotBody["to"])
	}
}

func TestResendErrorsNeverContainTheKeyOrProviderBody(t *testing.T) {
	const key = "re_must_not_appear"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, "provider says: bad key "+key)
	}))
	defer srv.Close()

	r := &Resend{APIKey: key, From: "no-reply@example.test", URL: srv.URL, Client: srv.Client()}
	err := r.Send(context.Background(), Message{To: "to@example.test", Subject: "s", Text: "t"})
	if err == nil {
		t.Fatal("expected an error for a 403 response")
	}
	if strings.Contains(err.Error(), key) || strings.Contains(err.Error(), "provider says") {
		t.Fatalf("error leaks secret or provider text: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "403") {
		t.Fatalf("error should carry the status: %q", err.Error())
	}
}
