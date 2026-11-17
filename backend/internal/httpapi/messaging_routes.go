package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
)

// registerMessagingRoutes adds the messaging endpoints under /v1.
func (d Deps) registerMessagingRoutes(v1 chi.Router) {
	origin := d.originCheck
	session := d.requireSession
	csrf := d.requireCSRF

	// Conversations.
	v1.With(session).Get("/conversations", d.listConversations)
	v1.With(origin, session, csrf).Post("/conversations/direct", d.getOrCreateDirectConversation)
	v1.With(session).Get("/conversations/{id}", d.getConversation)
	v1.With(origin, session, csrf).Post("/conversations/{id}/accept", d.acceptConversation)
	v1.With(origin, session, csrf).Post("/conversations/{id}/decline", d.declineConversation)

	// Messages.
	v1.With(session).Get("/conversations/{id}/messages", d.listMessages)
	v1.With(origin, session, csrf).Post("/conversations/{id}/messages", d.sendMessage)
	v1.With(origin, session, csrf).Post("/conversations/{id}/read", d.markConversationRead)
	v1.With(origin, session, csrf).Post("/conversations/{id}/messages/{messageId}/delivered", d.markMessageDelivered)

	// Blocking.
	v1.With(origin, session, csrf).Post("/users/{username}/block", d.blockUser)
	v1.With(origin, session, csrf).Delete("/users/{username}/block", d.unblockUser)

	// Settings.
	v1.With(session).Get("/me/settings", d.getMySettings)
	v1.With(origin, session, csrf).Patch("/me/settings", d.updateMySettings)
}

// ---------- Conversations ----------

type createDirectReq struct {
	TargetUsername string `json:"targetUsername"`
}

func (d Deps) getOrCreateDirectConversation(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	var body createDirectReq
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}

	conv, created, err := d.Messaging.GetOrCreateDirectConversation(r.Context(), sess.UserID, body.TargetUsername)
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}

	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, r, status, conv)
}

func (d Deps) listConversations(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	convs, err := d.Messaging.ListConversations(r.Context(), sess.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "list conversations", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}

	type resp struct {
		Conversations []messaging.Conversation `json:"conversations"`
	}
	writeJSON(w, r, http.StatusOK, resp{Conversations: convs})
}

func (d Deps) getConversation(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	conv, err := d.Messaging.GetConversation(r.Context(), sess.UserID, chi.URLParam(r, "id"))
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, conv)
}

func (d Deps) acceptConversation(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	conv, err := d.Messaging.AcceptConversation(r.Context(), sess.UserID, chi.URLParam(r, "id"))
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, conv)
}

func (d Deps) declineConversation(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	conv, err := d.Messaging.DeclineConversation(r.Context(), sess.UserID, chi.URLParam(r, "id"))
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, conv)
}

// ---------- Messages ----------

type sendMessageReq struct {
	ClientMessageID string `json:"clientMessageId"`
	Content         string `json:"content"`
}

func (d Deps) sendMessage(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	if d.MessageLimiter != nil {
		allowed, retryAfter := d.MessageLimiter.Allow(sess.UserID)
		if !allowed {
			setRetryAfter(w, int64(math.Ceil(retryAfter.Seconds())))
			d.writeProblem(w, r, http.StatusTooManyRequests, "Too many messages. Slow down.")
			return
		}
	}

	var body sendMessageReq
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}

	msg, err := d.Messaging.SendMessage(r.Context(), sess.UserID, chi.URLParam(r, "id"), body.ClientMessageID, body.Content)
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusCreated, msg)
}

func (d Deps) listMessages(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	before := r.URL.Query().Get("before")
	after := r.URL.Query().Get("after")
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			d.writeProblem(w, r, http.StatusBadRequest, "limit must be an integer between 1 and 100.")
			return
		}
		limit = parsed
	}

	page, err := d.Messaging.ListMessages(r.Context(), sess.UserID, chi.URLParam(r, "id"), before, after, limit)
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, page)
}

// ---------- Read / Delivered ----------

type markReadReq struct {
	MessageID string `json:"messageId"`
}

func (d Deps) markConversationRead(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	var body markReadReq
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}

	if err := d.Messaging.MarkRead(r.Context(), sess.UserID, chi.URLParam(r, "id"), body.MessageID); err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) markMessageDelivered(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	if err := d.Messaging.MarkDelivered(r.Context(), sess.UserID, chi.URLParam(r, "id"), chi.URLParam(r, "messageId")); err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Blocking ----------

func (d Deps) blockUser(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	if err := d.Messaging.BlockUser(r.Context(), sess.UserID, chi.URLParam(r, "username")); err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) unblockUser(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	if err := d.Messaging.UnblockUser(r.Context(), sess.UserID, chi.URLParam(r, "username")); err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Settings ----------

type updateSettingsReq struct {
	ReadReceiptsEnabled *bool `json:"readReceiptsEnabled"`
}

func (d Deps) getMySettings(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	settings, err := d.Messaging.GetSettings(r.Context(), sess.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "get settings", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}
	writeJSON(w, r, http.StatusOK, settings)
}

func (d Deps) updateMySettings(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	var body updateSettingsReq
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}
	if body.ReadReceiptsEnabled == nil {
		d.writeProblem(w, r, http.StatusBadRequest, "readReceiptsEnabled is required.")
		return
	}

	settings, err := d.Messaging.UpdateSettings(r.Context(), sess.UserID, *body.ReadReceiptsEnabled)
	if err != nil {
		d.messagingProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, settings)
}

// ---------- Error mapping ----------

// messagingProblem maps messaging service errors to RFC 9457 Problem Details.
func (d Deps) messagingProblem(w http.ResponseWriter, r *http.Request, err error) {
	var ve *messaging.ValidationError
	switch {
	case errors.As(err, &ve):
		d.writeProblem(w, r, http.StatusBadRequest, ve.Field+": "+ve.Reason+".")
	case errors.Is(err, messaging.ErrNotFound):
		d.writeProblem(w, r, http.StatusNotFound, "Conversation not found.")
	case errors.Is(err, messaging.ErrMessageNotFound):
		d.writeProblem(w, r, http.StatusNotFound, "Message not found.")
	case errors.Is(err, messaging.ErrUserNotFound):
		d.writeProblem(w, r, http.StatusNotFound, "User not found.")
	case errors.Is(err, messaging.ErrSelfConversation):
		d.writeProblem(w, r, http.StatusBadRequest, "You cannot start a conversation with yourself.")
	case errors.Is(err, messaging.ErrSelfBlock):
		d.writeProblem(w, r, http.StatusBadRequest, "You cannot block yourself.")
	case errors.Is(err, messaging.ErrBlocked):
		d.writeProblem(w, r, http.StatusForbidden, "This action is not available.")
	case errors.Is(err, messaging.ErrForbidden):
		d.writeProblem(w, r, http.StatusForbidden, "You do not have access to this resource.")
	case errors.Is(err, messaging.ErrPendingLimit):
		d.writeProblem(w, r, http.StatusForbidden, "Only one initial message is allowed until the request is accepted.")
	case errors.Is(err, messaging.ErrPendingRecipient):
		d.writeProblem(w, r, http.StatusForbidden, "Accept the message request before replying.")
	case errors.Is(err, messaging.ErrDeclined):
		d.writeProblem(w, r, http.StatusForbidden, "This conversation has been declined.")
	case errors.Is(err, messaging.ErrInvalidCursor):
		d.writeProblem(w, r, http.StatusBadRequest, "The cursor message is invalid or does not belong to this conversation.")
	case errors.Is(err, messaging.ErrInvalidCursorCombo):
		d.writeProblem(w, r, http.StatusBadRequest, "Cannot specify both 'before' and 'after' cursors.")
	default:
		d.Log.ErrorContext(r.Context(), "messaging request failed", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
	}
}
