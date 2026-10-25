// Package problem writes RFC 9457 Problem Details responses.
//
// Only the status, a fixed title, and a caller-supplied detail reach the client.
// Internal error text is never passed here. Log it server-side instead.
package problem

import (
	"encoding/json"
	"net/http"
)

// ContentType is the media type for Problem Details (RFC 9457, section 3).
const ContentType = "application/problem+json"

// TypeAboutBlank is the problem type used when no specific type URI exists
// (RFC 9457, section 4.2.1). Holoraa error type URIs are an owner decision.
const TypeAboutBlank = "about:blank"

// Problem is the response body. Field names follow RFC 9457.
type Problem struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// Write sends a Problem Details response. instance should be the request path
// only, without the query string. The returned error is from encoding or
// writing the response; the caller decides what to do with it.
func Write(w http.ResponseWriter, status int, detail, instance string) error {
	p := Problem{
		Type:     TypeAboutBlank,
		Title:    http.StatusText(status),
		Status:   status,
		Detail:   detail,
		Instance: instance,
	}
	w.Header().Set("Content-Type", ContentType)
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(p)
}
