package httpapi

import (
	"errors"
	"math"
	"net/http"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/realtime"
)

// registerRealtimeRoutes adds WebSocket ticket issuance and upgrade endpoints under /v1.
func (d Deps) registerRealtimeRoutes(v1 chi.Router) {
	v1.With(d.originCheck, d.requireSession, d.requireCSRF).Post("/realtime/ticket", d.issueRealtimeTicket)
	v1.With(d.originCheck).Get("/realtime/ws", d.upgradeWebSocket)
}

type realtimeTicketResponse struct {
	Ticket    string `json:"ticket"`
	ExpiresIn int    `json:"expiresIn"`
}

func (d Deps) issueRealtimeTicket(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	if d.TicketLimiter != nil {
		allowed, retryAfter := d.TicketLimiter.Allow(sess.ID)
		if !allowed {
			setRetryAfter(w, int64(math.Ceil(retryAfter.Seconds())))
			d.writeProblem(w, r, http.StatusTooManyRequests, "Too many ticket requests. Try again later.")
			return
		}
	}

	ticket, expiresIn, err := d.Tickets.Issue(r.Context(), sess.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "issue realtime ticket", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}

	writeJSON(w, r, http.StatusCreated, realtimeTicketResponse{
		Ticket:    ticket,
		ExpiresIn: expiresIn,
	})
}

func (d Deps) upgradeWebSocket(w http.ResponseWriter, r *http.Request) {
	if d.WSUpgradeLimiter != nil {
		allowed, retryAfter := d.WSUpgradeLimiter.Allow(d.Security.ClientIP(r))
		if !allowed {
			setRetryAfter(w, int64(math.Ceil(retryAfter.Seconds())))
			d.writeProblem(w, r, http.StatusTooManyRequests, "Too many WebSocket connection attempts. Try again later.")
			return
		}
	}

	// Authenticate strictly via single-use ticket. Never accept session cookies or
	// session query parameters as WebSocket authentication credentials.
	rawTicket, hasSessionQuery := realtime.ExtractTicket(r)
	if hasSessionQuery || rawTicket == "" {
		d.writeProblem(w, r, http.StatusUnauthorized, "A valid single-use realtime ticket is required.")
		return
	}

	userID, err := d.Tickets.Consume(r.Context(), rawTicket)
	if errors.Is(err, realtime.ErrInvalidTicket) {
		d.writeProblem(w, r, http.StatusUnauthorized, "Invalid or expired realtime ticket.")
		return
	}
	if err != nil {
		d.Log.ErrorContext(r.Context(), "consume realtime ticket", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:   []string{realtime.SubprotocolBase},
		OriginPatterns: d.Security.AllowedOrigins,
	})
	if err != nil {
		// websocket.Accept writes the error HTTP status if the handshake failed.
		return
	}

	d.Hub.ServeConn(r.Context(), userID, conn)
}
