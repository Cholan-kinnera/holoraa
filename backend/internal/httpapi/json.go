package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strconv"
)

// maxJSONBodyBytes bounds every JSON request body (AGENTS.md: size limits).
const maxJSONBodyBytes = 4 << 10

var (
	errUnsupportedMedia = errors.New("content type must be application/json")
	errBadBody          = errors.New("request body is not valid JSON for this endpoint")
)

// decodeJSON reads one JSON object from the request. It rejects other content
// types, unknown fields, oversized bodies, and trailing data.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errUnsupportedMedia
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errBadBody
	}
	if _, err := dec.Token(); err != io.EOF {
		return errBadBody
	}
	return nil
}

// writeJSON sends a JSON body. An encoding failure is logged, not returned,
// because the status line has already been sent.
func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// clientIP returns the connection's host address. Forwarded headers are not
// trusted (see AUTH_AND_PROFILES.md, trusted-proxy item D11).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host == "" {
		return "unknown"
	}
	return host
}

// setRetryAfter writes the Retry-After header in whole seconds, at least 1.
func setRetryAfter(w http.ResponseWriter, seconds int64) {
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
}
