package problem

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteProducesProblemDetails(t *testing.T) {
	rec := httptest.NewRecorder()

	if err := Write(rec, http.StatusServiceUnavailable, "Database unavailable.", "/v1/ready"); err != nil {
		t.Fatalf("Write returned error: %v", err)
	}

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != ContentType {
		t.Fatalf("Content-Type = %q, want %q", ct, ContentType)
	}

	var p Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	want := Problem{
		Type:     TypeAboutBlank,
		Title:    "Service Unavailable",
		Status:   503,
		Detail:   "Database unavailable.",
		Instance: "/v1/ready",
	}
	if p != want {
		t.Fatalf("problem = %+v, want %+v", p, want)
	}
}

func TestWriteOmitsEmptyDetail(t *testing.T) {
	rec := httptest.NewRecorder()
	if err := Write(rec, http.StatusNotFound, "", "/x"); err != nil {
		t.Fatalf("Write returned error: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if _, ok := raw["detail"]; ok {
		t.Fatalf("empty detail should be omitted: %v", raw)
	}
}
