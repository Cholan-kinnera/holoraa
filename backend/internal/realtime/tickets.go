// Package realtime implements single-instance WebSocket transport, single-use
// ticket authentication, multi-device presence, ephemeral typing indicators,
// and the transactional outbox relay worker with pair-locked block suppression.
package realtime

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
)

const (
	// TicketTTL is the lifetime of a single-use WebSocket ticket.
	TicketTTL = 60 * time.Second

	// SubprotocolBase is the negotiated RFC 6455 subprotocol (never echoes tickets).
	SubprotocolBase = "holoraa"
	// TicketSubprotocolPrefix carries the opaque ticket token in Sec-WebSocket-Protocol.
	TicketSubprotocolPrefix = "holoraa-ticket."

	minTicketLen = 32
	maxTicketLen = 256
)

// ErrInvalidTicket indicates missing, malformed, expired, or already-consumed tickets.
var ErrInvalidTicket = errors.New("invalid or expired websocket ticket")

// TicketService issues and atomically consumes single-use WebSocket authentication tickets.
type TicketService struct {
	queries *dbstore.Queries
}

// NewTicketService returns a new TicketService backed by pool.
func NewTicketService(pool *pgxpool.Pool) *TicketService {
	return &TicketService{queries: dbstore.New(pool)}
}

// Issue creates a 32-byte cryptographically random ticket, stores only its SHA-256
// digest in ws_tickets with a 60-second expiry, and returns the opaque token + TTL seconds.
func (ts *TicketService) Issue(ctx context.Context, userID string) (string, int, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", 0, fmt.Errorf("generate ticket entropy: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	digest := sha256.Sum256([]byte(token))

	expiresAt := time.Now().UTC().Add(TicketTTL)
	err := ts.queries.CreateWSTicket(ctx, dbstore.CreateWSTicketParams{
		TicketHash: digest[:],
		UserID:     userID,
		ExpiresAt:  pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return "", 0, fmt.Errorf("persist websocket ticket: %w", err)
	}
	return token, int(TicketTTL.Seconds()), nil
}

// Consume atomically deletes an unexpired ticket digest and returns the authenticated userID.
// The raw ticket is never echoed in returned errors.
func (ts *TicketService) Consume(ctx context.Context, token string) (string, error) {
	if len(token) < minTicketLen || len(token) > maxTicketLen {
		return "", ErrInvalidTicket
	}
	digest := sha256.Sum256([]byte(token))
	userID, err := ts.queries.ConsumeWSTicket(ctx, digest[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidTicket
	}
	if err != nil {
		return "", fmt.Errorf("consume websocket ticket: %w", err)
	}
	return userID, nil
}

// CleanupExpired removes expired rows from ws_tickets.
func (ts *TicketService) CleanupExpired(ctx context.Context) (int64, error) {
	return ts.queries.CleanupExpiredWSTickets(ctx)
}

// ExtractTicket inspects Sec-WebSocket-Protocol exclusively for a "holoraa-ticket.<token>"
// subprotocol entry. Query-string credentials (including ?ticket= and ?session=) are rejected.
func ExtractTicket(r *http.Request) (ticket string, hasForbiddenQuery bool) {
	q := r.URL.Query()
	for _, forbidden := range []string{"ticket", "session", "session_id", "sessionId", "token", "cookie"} {
		if q.Has(forbidden) {
			return "", true
		}
	}

	for _, hdr := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, part := range strings.Split(hdr, ",") {
			tok := strings.TrimSpace(part)
			if strings.HasPrefix(tok, TicketSubprotocolPrefix) {
				candidate := strings.TrimPrefix(tok, TicketSubprotocolPrefix)
				if candidate != "" {
					return candidate, false
				}
			}
		}
	}

	return "", false
}
