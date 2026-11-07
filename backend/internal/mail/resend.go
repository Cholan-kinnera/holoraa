package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// DefaultResendURL is the Resend email endpoint.
const DefaultResendURL = "https://api.resend.com/emails"

// resendTimeout bounds one send. It is kept short (5s per DEC-M2-01) so a
// slow provider does not tie up resources.
const resendTimeout = 5 * time.Second

// Resend sends mail through the Resend HTTP API. It is used only when the
// configuration selects it, and it needs an API key and a verified sender.
type Resend struct {
	APIKey string
	From   string
	URL    string
	Client *http.Client
}

// NewResend returns a Resend sender for the production endpoint.
func NewResend(apiKey, from string) *Resend {
	return &Resend{
		APIKey: apiKey,
		From:   from,
		URL:    DefaultResendURL,
		Client: &http.Client{Timeout: resendTimeout},
	}
}

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Text    string   `json:"text"`
}

// Send posts the message. Any 2xx status is success. A failure returns the
// HTTP status only: the provider's body and the API key are never included in
// the error.
func (r *Resend) Send(ctx context.Context, m Message) error {
	body, err := json.Marshal(resendRequest{
		From:    r.From,
		To:      []string{m.To},
		Subject: m.Subject,
		Text:    m.Text,
	})
	if err != nil {
		return fmt.Errorf("encode email: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build email request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.Client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("%w: transport timeout", ErrAmbiguousDelivery)
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return fmt.Errorf("%w: transport timeout", ErrAmbiguousDelivery)
		}
		// The transport error can contain the URL but not the key. It is still
		// reduced to a fixed message.
		return fmt.Errorf("send email: transport error")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("send email: provider returned status %d", resp.StatusCode)
	}
	return nil
}
