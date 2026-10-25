// Package mail sends transactional email. Two implementations exist:
//
//   - Fake writes each message to a local file. It is the development default
//     and needs no credentials.
//   - Resend posts to the Resend HTTP API. It is used only when the
//     configuration selects it (ADR 0009).
//
// Callers never log message bodies. A one-time code is a secret until it
// expires.
package mail

import "context"

// Message is one outgoing email. Text is the plain-text body.
type Message struct {
	To      string
	Subject string
	Text    string
}

// Sender delivers a message or reports that delivery failed.
type Sender interface {
	Send(ctx context.Context, m Message) error
}
