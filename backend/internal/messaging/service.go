// Package messaging implements the core business logic for 1:1 direct conversations,
// transactional sequence allocation, message history pagination, mutual follow rules,
// blocking checks, dual read watermarks, and outbox event persistence.
package messaging

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsValidUUID reports whether s is a canonical 36-character hyphenated UUID.
func IsValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

// NewUUID generates a cryptographically secure random RFC 4122 v4 UUID string.
func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// Sentinel errors. Handlers map them to RFC 9457 Problem Details.
var (
	ErrNotFound           = errors.New("conversation not found")
	ErrMessageNotFound    = errors.New("message not found")
	ErrUserNotFound       = errors.New("user not found")
	ErrSelfConversation   = errors.New("cannot start conversation with yourself")
	ErrSelfBlock          = errors.New("cannot block yourself")
	ErrBlocked            = errors.New("user is blocked")
	ErrForbidden          = errors.New("forbidden")
	ErrPendingLimit       = errors.New("only one initial message allowed for pending requests until accepted")
	ErrPendingRecipient   = errors.New("cannot reply to pending request before accepting")
	ErrDeclined           = errors.New("cannot send message in declined conversation")
	ErrInvalidCursor      = errors.New("invalid cursor message")
	ErrInvalidCursorCombo = errors.New("cannot specify both before and after cursors")
)

// ValidationError names the field and the rule it broke.
type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Reason }

// PeerProfile describes the conversation peer.
type PeerProfile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	AvatarURL   *string `json:"avatarUrl"`
}

// MessageSnippet contains summary details of a conversation's latest message.
type MessageSnippet struct {
	ID        string    `json:"id"`
	SenderID  string    `json:"senderId"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

// Conversation represents a 1:1 direct conversation between two users.
type Conversation struct {
	ID                  string          `json:"id"`
	Type                string          `json:"type"`
	Status              string          `json:"status"`
	InitiatedBy         string          `json:"initiatedBy"`
	LastMessageSequence int64           `json:"lastMessageSequence"`
	Peer                PeerProfile     `json:"peer"`
	LastMessage         *MessageSnippet `json:"lastMessage,omitempty"`
	UnreadCount         int64           `json:"unreadCount"`
	UpdatedAt           time.Time       `json:"updatedAt"`
	CreatedAt           time.Time       `json:"createdAt"`
}

// Message represents an immutable chat message.
type Message struct {
	ID              string     `json:"id"`
	ConversationID  string     `json:"conversationId"`
	SenderID        string     `json:"senderId"`
	ClientMessageID string     `json:"clientMessageId"`
	Content         string     `json:"content"`
	SequenceNum     int64      `json:"sequenceNum"`
	CreatedAt       time.Time  `json:"createdAt"`
	DeliveredAt     *time.Time `json:"deliveredAt"`
	ReadAt          *time.Time `json:"readAt"`
}

// MessagesPage contains a slice of paginated messages and pagination indicator.
type MessagesPage struct {
	Messages []Message `json:"messages"`
	HasMore  bool      `json:"hasMore"`
}

// UserSettings represents the caller's persistent privacy preferences.
type UserSettings struct {
	ReadReceiptsEnabled bool `json:"readReceiptsEnabled"`
}

// EventNotifier wakes the outbox relay worker after an outbox row commits.
type EventNotifier interface {
	WakeRelay()
}

// BlockNotifier notifies the realtime hub after block/unblock transactions commit.
type BlockNotifier interface {
	OnUsersBlocked(userA, userB string)
	OnUsersUnblocked(userA, userB string)
}

// BlockTransitionCoordinator optionally serializes block/unblock PostgreSQL commits
// against concurrent Hub pair dispatch checks so no previously queued event can be
// enqueued after a block commits.
type BlockTransitionCoordinator interface {
	BeginBlockTransition(userA, userB string) (release func())
}

// Service provides messaging operations.
type Service struct {
	pool          *pgxpool.Pool
	queries       *dbstore.Queries
	hooksMu       sync.RWMutex
	eventNotifier EventNotifier
	blockNotifier BlockNotifier
}

// NewService returns a new messaging service.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:    pool,
		queries: dbstore.New(pool),
	}
}

// SetRealtimeHooks registers optional post-commit hooks for the realtime relay and hub.
func (s *Service) SetRealtimeHooks(events EventNotifier, blocks BlockNotifier) {
	s.hooksMu.Lock()
	defer s.hooksMu.Unlock()
	s.eventNotifier = events
	s.blockNotifier = blocks
}

func (s *Service) wakeRelay() {
	s.hooksMu.RLock()
	n := s.eventNotifier
	s.hooksMu.RUnlock()
	if n != nil {
		n.WakeRelay()
	}
}

func (s *Service) notifyBlocked(a, b string) {
	s.hooksMu.RLock()
	n := s.blockNotifier
	s.hooksMu.RUnlock()
	if n != nil {
		n.OnUsersBlocked(a, b)
	}
}

func (s *Service) notifyUnblocked(a, b string) {
	s.hooksMu.RLock()
	n := s.blockNotifier
	s.hooksMu.RUnlock()
	if n != nil {
		n.OnUsersUnblocked(a, b)
	}
}

func (s *Service) beginBlockTransition(a, b string) func() {
	s.hooksMu.RLock()
	n := s.blockNotifier
	s.hooksMu.RUnlock()
	if coord, ok := n.(BlockTransitionCoordinator); ok && coord != nil {
		return coord.BeginBlockTransition(a, b)
	}
	return nil
}

// Outbox envelope structures matching contracts/events/*.json.
type eventEnvelope struct {
	V         int         `json:"v"`
	ID        string      `json:"id"`
	Type      string      `json:"type"`
	Timestamp string      `json:"timestamp"`
	Payload   interface{} `json:"payload"`
}

type messageCreatedPayload struct {
	MessageID       string `json:"messageId"`
	ConversationID  string `json:"conversationId"`
	SenderID        string `json:"senderId"`
	ClientMessageID string `json:"clientMessageId"`
	Content         string `json:"content"`
	SequenceNum     int64  `json:"sequenceNum"`
	CreatedAt       string `json:"createdAt"`
}

type messageReadPayload struct {
	ConversationID  string `json:"conversationId"`
	UserID          string `json:"userId"`
	MessageID       string `json:"messageId"`
	SequenceNum     int64  `json:"sequenceNum"`
	FromSequenceNum int64  `json:"fromSequenceNum"`
	ReadAt          string `json:"readAt"`
}

type messageDeliveredPayload struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
}

type conversationUpdatedPayload struct {
	ConversationID string          `json:"conversationId"`
	Status         string          `json:"status"`
	UpdatedAt      string          `json:"updatedAt"`
	LastMessage    *MessageSnippet `json:"lastMessage"`
}

func tsToTime(ts pgtype.Timestamptz) time.Time {
	if ts.Valid {
		return ts.Time
	}
	return time.Time{}
}

func tsToTimePtr(ts pgtype.Timestamptz) *time.Time {
	if ts.Valid {
		t := ts.Time
		return &t
	}
	return nil
}

// ---------- Conversation lifecycle ----------

// GetOrCreateDirectConversation idempotently retrieves or creates a canonical 1:1 conversation.
func (s *Service) GetOrCreateDirectConversation(ctx context.Context, callerID, targetUsername string) (Conversation, bool, error) {
	u := strings.ToLower(strings.TrimSpace(targetUsername))
	if u == "" {
		return Conversation{}, false, &ValidationError{Field: "targetUsername", Reason: "cannot be empty"}
	}

	targetUser, err := s.queries.GetUserByUsername(ctx, u)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, false, ErrUserNotFound
	}
	if err != nil {
		return Conversation{}, false, fmt.Errorf("lookup target user: %w", err)
	}

	if targetUser.ID == callerID {
		return Conversation{}, false, ErrSelfConversation
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Conversation{}, false, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// Serialize operations on this user pair.
	if err := qtx.AcquirePairAdvisoryLock(ctx, dbstore.AcquirePairAdvisoryLockParams{
		UserA: callerID, UserB: targetUser.ID,
	}); err != nil {
		return Conversation{}, false, fmt.Errorf("pair lock: %w", err)
	}

	// Blocking check.
	blocked, err := qtx.CheckIsBlocked(ctx, dbstore.CheckIsBlockedParams{
		UserA: callerID, UserB: targetUser.ID,
	})
	if err != nil {
		return Conversation{}, false, fmt.Errorf("block check: %w", err)
	}
	if blocked {
		return Conversation{}, false, ErrBlocked
	}

	// Idempotent: return existing conversation unless terminally declined.
	existing, err := qtx.GetDirectConversationByUsers(ctx, dbstore.GetDirectConversationByUsersParams{
		UserA: callerID, UserB: targetUser.ID,
	})
	if err == nil {
		if existing.Status == "declined" {
			return Conversation{}, false, ErrDeclined
		}
		full, err2 := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{
			UserID: callerID, ConversationID: existing.ID,
		})
		if err2 != nil {
			return Conversation{}, false, fmt.Errorf("fetch existing conv: %w", err2)
		}
		if err := tx.Commit(ctx); err != nil {
			return Conversation{}, false, fmt.Errorf("commit: %w", err)
		}
		return convFromRow(full), false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, false, fmt.Errorf("query existing conv: %w", err)
	}

	// Determine initial status based on mutual follow.
	mutualPtr, err := qtx.CheckMutualFollow(ctx, dbstore.CheckMutualFollowParams{
		UserA: callerID, UserB: targetUser.ID,
	})
	if err != nil {
		return Conversation{}, false, fmt.Errorf("mutual follow check: %w", err)
	}
	mutual := mutualPtr != nil && *mutualPtr

	status := "pending"
	if mutual {
		status = "accepted"
	}

	newID := NewUUID()
	if _, err := qtx.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
		ID: newID, Status: status, UserA: callerID, UserB: targetUser.ID, InitiatedBy: callerID,
	}); err != nil {
		return Conversation{}, false, fmt.Errorf("create conv: %w", err)
	}

	if err := qtx.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
		ConversationID: newID, UserID: callerID,
	}); err != nil {
		return Conversation{}, false, fmt.Errorf("create member caller: %w", err)
	}
	if err := qtx.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
		ConversationID: newID, UserID: targetUser.ID,
	}); err != nil {
		return Conversation{}, false, fmt.Errorf("create member peer: %w", err)
	}

	full, err := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{
		UserID: callerID, ConversationID: newID,
	})
	if err != nil {
		return Conversation{}, false, fmt.Errorf("fetch new conv: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, false, fmt.Errorf("commit: %w", err)
	}
	return convFromRow(full), true, nil
}

// ListConversations returns all 1:1 direct conversations for the user.
func (s *Service) ListConversations(ctx context.Context, callerID string) ([]Conversation, error) {
	rows, err := s.queries.ListConversationsForUser(ctx, callerID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	out := make([]Conversation, 0, len(rows))
	for _, r := range rows {
		var snippet *MessageSnippet
		if r.LastMessageID != "" {
			snippet = &MessageSnippet{
				ID: r.LastMessageID, SenderID: r.LastMessageSenderID,
				Content: r.LastMessageContent, CreatedAt: tsToTime(r.LastMessageCreatedAt),
			}
		}
		peer := ""
		if r.PeerUsername != nil {
			peer = *r.PeerUsername
		}
		out = append(out, Conversation{
			ID: r.ID, Type: r.Type, Status: r.Status, InitiatedBy: r.InitiatedBy,
			LastMessageSequence: r.LastMessageSequence,
			Peer:                PeerProfile{ID: r.PeerID, Username: peer, DisplayName: r.PeerDisplayName, Bio: r.PeerBio, AvatarURL: r.PeerAvatarUrl},
			LastMessage:         snippet, UnreadCount: r.UnreadCount,
			UpdatedAt: tsToTime(r.UpdatedAt), CreatedAt: tsToTime(r.CreatedAt),
		})
	}
	return out, nil
}

// GetConversation returns a single conversation for the caller.
func (s *Service) GetConversation(ctx context.Context, callerID, convID string) (Conversation, error) {
	if !IsValidUUID(convID) {
		return Conversation{}, &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	row, err := s.queries.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{
		UserID: callerID, ConversationID: convID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		_, e2 := s.queries.GetConversationByID(ctx, convID)
		if e2 == nil {
			return Conversation{}, ErrForbidden
		}
		return Conversation{}, ErrNotFound
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("get conversation: %w", err)
	}
	return convFromRow(row), nil
}

// AcceptConversation transitions a pending conversation to accepted.
func (s *Service) AcceptConversation(ctx context.Context, callerID, convID string) (Conversation, error) {
	if !IsValidUUID(convID) {
		return Conversation{}, &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Conversation{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	conv, err := qtx.GetConversationForUpdate(ctx, convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("lock conv: %w", err)
	}
	if conv.UserAID != callerID && conv.UserBID != callerID {
		return Conversation{}, ErrForbidden
	}
	if conv.Status == "accepted" {
		full, err := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{UserID: callerID, ConversationID: convID})
		if err != nil {
			return Conversation{}, fmt.Errorf("get conv: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return Conversation{}, fmt.Errorf("commit: %w", err)
		}
		return convFromRow(full), nil
	}
	if conv.Status != "pending" || callerID == conv.InitiatedBy {
		return Conversation{}, ErrForbidden
	}

	updated, err := qtx.UpdateConversationStatus(ctx, dbstore.UpdateConversationStatusParams{ID: convID, Status: "accepted"})
	if err != nil {
		return Conversation{}, fmt.Errorf("update status: %w", err)
	}

	full, err := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{UserID: callerID, ConversationID: convID})
	if err != nil {
		return Conversation{}, fmt.Errorf("get conv: %w", err)
	}

	if err := s.insertConvUpdatedEvent(ctx, qtx, convID, "accepted", updated, full, conv.UserAID, conv.UserBID); err != nil {
		return Conversation{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, fmt.Errorf("commit: %w", err)
	}
	s.wakeRelay()
	return convFromRow(full), nil
}

// DeclineConversation transitions a pending conversation to declined.
func (s *Service) DeclineConversation(ctx context.Context, callerID, convID string) (Conversation, error) {
	if !IsValidUUID(convID) {
		return Conversation{}, &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Conversation{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	conv, err := qtx.GetConversationForUpdate(ctx, convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("lock conv: %w", err)
	}
	if conv.UserAID != callerID && conv.UserBID != callerID {
		return Conversation{}, ErrForbidden
	}
	if conv.Status == "declined" {
		full, err := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{UserID: callerID, ConversationID: convID})
		if err != nil {
			return Conversation{}, fmt.Errorf("get conv: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return Conversation{}, fmt.Errorf("commit: %w", err)
		}
		return convFromRow(full), nil
	}
	if conv.Status != "pending" || callerID == conv.InitiatedBy {
		return Conversation{}, ErrForbidden
	}

	updated, err := qtx.UpdateConversationStatus(ctx, dbstore.UpdateConversationStatusParams{ID: convID, Status: "declined"})
	if err != nil {
		return Conversation{}, fmt.Errorf("update status: %w", err)
	}

	full, err := qtx.GetConversationForUser(ctx, dbstore.GetConversationForUserParams{UserID: callerID, ConversationID: convID})
	if err != nil {
		return Conversation{}, fmt.Errorf("get conv: %w", err)
	}

	if err := s.insertConvUpdatedEvent(ctx, qtx, convID, "declined", updated, full, conv.UserAID, conv.UserBID); err != nil {
		return Conversation{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, fmt.Errorf("commit: %w", err)
	}
	s.wakeRelay()
	return convFromRow(full), nil
}

// ---------- Messaging ----------

// SendMessage commits a new message with per-conversation monotonic sequence allocation.
func (s *Service) SendMessage(ctx context.Context, callerID, convID, clientMessageID, content string) (Message, error) {
	if !IsValidUUID(convID) {
		return Message{}, &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	if !IsValidUUID(clientMessageID) {
		return Message{}, &ValidationError{Field: "clientMessageId", Reason: "must be a valid UUID"}
	}
	content = strings.TrimSpace(content)
	n := utf8.RuneCountInString(content)
	if n < 1 || n > 4000 {
		return Message{}, &ValidationError{Field: "content", Reason: "must be between 1 and 4000 characters"}
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Message{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// Verify membership and resolve immutable user pair before locking.
	_, err = qtx.GetConversationMember(ctx, dbstore.GetConversationMemberParams{ConversationID: convID, UserID: callerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrForbidden
	}
	if err != nil {
		return Message{}, fmt.Errorf("verify membership: %w", err)
	}

	convMeta, err := qtx.GetConversationByID(ctx, convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, fmt.Errorf("lookup conv: %w", err)
	}

	// Step 1: Pair advisory lock (matches LLD § 2.1 lock hierarchy).
	if err := qtx.AcquirePairAdvisoryLock(ctx, dbstore.AcquirePairAdvisoryLockParams{
		UserA: convMeta.UserAID, UserB: convMeta.UserBID,
	}); err != nil {
		return Message{}, fmt.Errorf("pair lock: %w", err)
	}

	// Step 2: Lock conversation row.
	conv, err := qtx.GetConversationForUpdate(ctx, convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, fmt.Errorf("lock conv: %w", err)
	}

	// Blocking check.
	blocked, err := qtx.CheckIsBlocked(ctx, dbstore.CheckIsBlockedParams{UserA: conv.UserAID, UserB: conv.UserBID})
	if err != nil {
		return Message{}, fmt.Errorf("block check: %w", err)
	}
	if blocked {
		return Message{}, ErrBlocked
	}

	// Idempotency: (conversation_id, sender_id, client_message_id).
	existing, err := qtx.GetMessageByClientID(ctx, dbstore.GetMessageByClientIDParams{
		ConversationID: convID, SenderID: callerID, ClientMessageID: clientMessageID,
	})
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return Message{}, fmt.Errorf("commit: %w", err)
		}
		return msgFromRow(existing), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Message{}, fmt.Errorf("idempotency check: %w", err)
	}

	// Message request rules.
	if conv.Status == "declined" {
		return Message{}, ErrDeclined
	}
	if conv.Status == "pending" {
		if callerID != conv.InitiatedBy {
			return Message{}, ErrPendingRecipient
		}
		if conv.LastMessageSequence > 0 {
			return Message{}, ErrPendingLimit
		}
	}

	// Sequence allocation.
	nextSeq, err := qtx.IncrementConversationSequence(ctx, convID)
	if err != nil {
		return Message{}, fmt.Errorf("increment seq: %w", err)
	}

	msgID := NewUUID()
	created, err := qtx.CreateMessage(ctx, dbstore.CreateMessageParams{
		ID: msgID, ConversationID: convID, SenderID: callerID,
		ClientMessageID: clientMessageID, Content: content, SequenceNum: nextSeq,
	})
	if err != nil {
		return Message{}, fmt.Errorf("insert message: %w", err)
	}

	// Advance sender's own private watermark.
	if _, err := qtx.UpdatePrivateReadWatermark(ctx, dbstore.UpdatePrivateReadWatermarkParams{
		MessageID: msgID, SequenceNum: nextSeq, ConversationID: convID, UserID: callerID,
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Message{}, fmt.Errorf("advance sender watermark: %w", err)
	}

	// Outbox event targeting peer.
	peerID := conv.UserAID
	if peerID == callerID {
		peerID = conv.UserBID
	}
	env := eventEnvelope{
		V: 1, ID: NewUUID(), Type: "message.created",
		Timestamp: tsToTime(created.CreatedAt).Format(time.RFC3339Nano),
		Payload: messageCreatedPayload{
			MessageID: created.ID, ConversationID: created.ConversationID,
			SenderID: created.SenderID, ClientMessageID: created.ClientMessageID,
			Content: created.Content, SequenceNum: created.SequenceNum,
			CreatedAt: tsToTime(created.CreatedAt).Format(time.RFC3339Nano),
		},
	}
	envBytes, err := json.Marshal(env)
	if err != nil {
		return Message{}, fmt.Errorf("marshal message created event: %w", err)
	}
	if _, err := qtx.InsertOutboxEvent(ctx, dbstore.InsertOutboxEventParams{
		EventType: "message.created", ConversationID: convID, Payload: envBytes, TargetUserIds: []string{peerID},
	}); err != nil {
		return Message{}, fmt.Errorf("insert outbox event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Message{}, fmt.Errorf("commit: %w", err)
	}
	s.wakeRelay()
	return msgFromRow(created), nil
}

// ---------- Message history ----------

// ListMessages returns keyset-paginated messages for a conversation.
func (s *Service) ListMessages(ctx context.Context, callerID, convID, beforeCursor, afterCursor string, limit int) (MessagesPage, error) {
	if !IsValidUUID(convID) {
		return MessagesPage{}, &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	if beforeCursor != "" && afterCursor != "" {
		return MessagesPage{}, ErrInvalidCursorCombo
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// Verify membership.
	_, err := s.queries.GetConversationMember(ctx, dbstore.GetConversationMemberParams{ConversationID: convID, UserID: callerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MessagesPage{}, ErrForbidden
	}
	if err != nil {
		return MessagesPage{}, fmt.Errorf("verify membership: %w", err)
	}

	fetch := int32(limit + 1) // fetch one extra to detect hasMore

	if beforeCursor != "" {
		if !IsValidUUID(beforeCursor) {
			return MessagesPage{}, ErrInvalidCursor
		}
		cur, err := s.queries.GetMessageInConversation(ctx, dbstore.GetMessageInConversationParams{ID: beforeCursor, ConversationID: convID})
		if errors.Is(err, pgx.ErrNoRows) {
			return MessagesPage{}, ErrInvalidCursor
		}
		if err != nil {
			return MessagesPage{}, fmt.Errorf("resolve before cursor: %w", err)
		}
		rows, err := s.queries.ListMessagesBefore(ctx, dbstore.ListMessagesBeforeParams{
			ConversationID: convID, BeforeSequence: cur.SequenceNum, PageLimit: fetch,
		})
		if err != nil {
			return MessagesPage{}, fmt.Errorf("list before: %w", err)
		}
		return buildPage(rows, limit), nil
	}

	if afterCursor != "" {
		if !IsValidUUID(afterCursor) {
			return MessagesPage{}, ErrInvalidCursor
		}
		cur, err := s.queries.GetMessageInConversation(ctx, dbstore.GetMessageInConversationParams{ID: afterCursor, ConversationID: convID})
		if errors.Is(err, pgx.ErrNoRows) {
			return MessagesPage{}, ErrInvalidCursor
		}
		if err != nil {
			return MessagesPage{}, fmt.Errorf("resolve after cursor: %w", err)
		}
		rows, err := s.queries.ListMessagesAfter(ctx, dbstore.ListMessagesAfterParams{
			ConversationID: convID, AfterSequence: cur.SequenceNum, PageLimit: fetch,
		})
		if err != nil {
			return MessagesPage{}, fmt.Errorf("list after: %w", err)
		}
		return buildPage(rows, limit), nil
	}

	// Latest.
	rows, err := s.queries.ListMessagesLatest(ctx, dbstore.ListMessagesLatestParams{ConversationID: convID, PageLimit: fetch})
	if err != nil {
		return MessagesPage{}, fmt.Errorf("list latest: %w", err)
	}
	return buildPage(rows, limit), nil
}

// ---------- Read receipts ----------

// MarkRead advances the caller's private watermark and conditionally publishes peer read receipts.
func (s *Service) MarkRead(ctx context.Context, callerID, convID, messageID string) error {
	if !IsValidUUID(convID) {
		return &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	if !IsValidUUID(messageID) {
		return &ValidationError{Field: "messageId", Reason: "must be a valid UUID"}
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// Hierarchy L1: lock user_settings.
	if err := qtx.UpsertDefaultUserSettings(ctx, callerID); err != nil {
		return fmt.Errorf("upsert settings: %w", err)
	}
	settings, err := qtx.GetUserSettingsForUpdate(ctx, callerID)
	if err != nil {
		return fmt.Errorf("lock settings: %w", err)
	}

	// Hierarchy L2: lock conversation_members (verify membership before probing messages).
	member, err := qtx.GetConversationMemberForUpdate(ctx, dbstore.GetConversationMemberForUpdateParams{ConversationID: convID, UserID: callerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return fmt.Errorf("lock member: %w", err)
	}

	// Validate target message belongs to this conversation.
	target, err := qtx.GetMessageInConversation(ctx, dbstore.GetMessageInConversationParams{ID: messageID, ConversationID: convID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCursor
	}
	if err != nil {
		return fmt.Errorf("lookup target: %w", err)
	}

	// Always advance private watermark.
	if target.SequenceNum > member.LastReadSequence {
		if _, err := qtx.UpdatePrivateReadWatermark(ctx, dbstore.UpdatePrivateReadWatermarkParams{
			MessageID: messageID, SequenceNum: target.SequenceNum, ConversationID: convID, UserID: callerID,
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("update private watermark: %w", err)
		}
	}

	// Option B: mark newly read incoming messages and advance receipt watermark.
	baseline := member.ReceiptSequence
	if member.ReceiptBaselineSequence > baseline {
		baseline = member.ReceiptBaselineSequence
	}

	if settings.ReadReceiptsEnabled && target.SequenceNum > baseline {
		readMsgs, err := qtx.MarkIncomingMessagesRead(ctx, dbstore.MarkIncomingMessagesReadParams{
			ConversationID: convID, BaselineSequence: baseline, TargetSequence: target.SequenceNum, ReaderID: callerID,
		})
		if err != nil {
			return fmt.Errorf("mark read: %w", err)
		}
		if len(readMsgs) > 0 {
			var latest dbstore.MarkIncomingMessagesReadRow
			fromSeq := int64(1<<63 - 1)
			for _, m := range readMsgs {
				if m.SequenceNum > latest.SequenceNum {
					latest = m
				}
				if m.SequenceNum < fromSeq {
					fromSeq = m.SequenceNum
				}
			}

			if _, err := qtx.AdvanceReceiptWatermark(ctx, dbstore.AdvanceReceiptWatermarkParams{
				ReceiptMessageID: latest.ID, ReceiptSequence: latest.SequenceNum, ReceiptAt: latest.ReadAt,
				ConversationID: convID, ReaderID: callerID,
			}); err != nil {
				return fmt.Errorf("advance receipt: %w", err)
			}

			// Find peer for outbox event.
			members, err := qtx.GetConversationMembers(ctx, convID)
			if err != nil {
				return fmt.Errorf("get members: %w", err)
			}
			peerID := ""
			for _, m := range members {
				if m.UserID != callerID {
					peerID = m.UserID
					break
				}
			}
			if peerID != "" {
				env := eventEnvelope{
					V: 1, ID: NewUUID(), Type: "message.read",
					Timestamp: tsToTime(latest.ReadAt).Format(time.RFC3339Nano),
					Payload: messageReadPayload{
						ConversationID: convID, UserID: callerID, MessageID: latest.ID,
						SequenceNum: latest.SequenceNum, FromSequenceNum: fromSeq,
						ReadAt: tsToTime(latest.ReadAt).Format(time.RFC3339Nano),
					},
				}
				envBytes, err := json.Marshal(env)
				if err != nil {
					return fmt.Errorf("marshal read event: %w", err)
				}
				if _, err := qtx.InsertOutboxEvent(ctx, dbstore.InsertOutboxEventParams{
					EventType: "message.read", ConversationID: convID, Payload: envBytes, TargetUserIds: []string{peerID},
				}); err != nil {
					return fmt.Errorf("insert read event: %w", err)
				}
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	s.wakeRelay()
	return nil
}

// MarkDelivered records delivery acknowledgement.
func (s *Service) MarkDelivered(ctx context.Context, callerID, convID, messageID string) error {
	if !IsValidUUID(convID) {
		return &ValidationError{Field: "id", Reason: "must be a valid UUID"}
	}
	if !IsValidUUID(messageID) {
		return &ValidationError{Field: "messageId", Reason: "must be a valid UUID"}
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	_, err = qtx.GetConversationMember(ctx, dbstore.GetConversationMemberParams{ConversationID: convID, UserID: callerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return fmt.Errorf("verify membership: %w", err)
	}

	msg, err := qtx.GetMessageInConversation(ctx, dbstore.GetMessageInConversationParams{ID: messageID, ConversationID: convID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMessageNotFound
	}
	if err != nil {
		return fmt.Errorf("lookup msg: %w", err)
	}

	// Senders cannot acknowledge delivery of their own messages.
	if msg.SenderID == callerID {
		return ErrForbidden
	}
	if msg.DeliveredAt.Valid {
		return tx.Commit(ctx)
	}

	rows, err := qtx.MarkMessageDelivered(ctx, dbstore.MarkMessageDeliveredParams{MessageID: messageID, ConversationID: convID})
	if err != nil {
		return fmt.Errorf("mark delivered: %w", err)
	}
	if rows > 0 {
		env := eventEnvelope{
			V: 1, ID: NewUUID(), Type: "message.delivered",
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			Payload:   messageDeliveredPayload{ConversationID: convID, MessageID: messageID},
		}
		envBytes, err := json.Marshal(env)
		if err != nil {
			return fmt.Errorf("marshal delivered event: %w", err)
		}
		if _, err := qtx.InsertOutboxEvent(ctx, dbstore.InsertOutboxEventParams{
			EventType: "message.delivered", ConversationID: convID, Payload: envBytes, TargetUserIds: []string{msg.SenderID},
		}); err != nil {
			return fmt.Errorf("insert delivered event: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if rows > 0 {
		s.wakeRelay()
	}
	return nil
}

// ---------- Blocking ----------

// BlockUser idempotently blocks a target user.
func (s *Service) BlockUser(ctx context.Context, blockerID, targetUsername string) error {
	u := strings.ToLower(strings.TrimSpace(targetUsername))
	if u == "" {
		return &ValidationError{Field: "username", Reason: "cannot be empty"}
	}
	target, err := s.queries.GetUserByUsername(ctx, u)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("lookup target: %w", err)
	}
	if target.ID == blockerID {
		return ErrSelfBlock
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if err := qtx.AcquirePairAdvisoryLock(ctx, dbstore.AcquirePairAdvisoryLockParams{UserA: blockerID, UserB: target.ID}); err != nil {
		return fmt.Errorf("pair lock: %w", err)
	}
	if err := qtx.CreateBlock(ctx, dbstore.CreateBlockParams{BlockerID: blockerID, BlockedID: target.ID}); err != nil {
		return fmt.Errorf("insert block: %w", err)
	}
	releaseTransition := s.beginBlockTransition(blockerID, target.ID)
	transitionReleased := false
	defer func() {
		if !transitionReleased && releaseTransition != nil {
			releaseTransition()
		}
	}()
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	s.notifyBlocked(blockerID, target.ID)
	if releaseTransition != nil {
		transitionReleased = true
		releaseTransition()
	}
	return nil
}

// UnblockUser removes an active block.
func (s *Service) UnblockUser(ctx context.Context, blockerID, targetUsername string) error {
	u := strings.ToLower(strings.TrimSpace(targetUsername))
	if u == "" {
		return &ValidationError{Field: "username", Reason: "cannot be empty"}
	}
	target, err := s.queries.GetUserByUsername(ctx, u)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("lookup target: %w", err)
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if err := qtx.AcquirePairAdvisoryLock(ctx, dbstore.AcquirePairAdvisoryLockParams{UserA: blockerID, UserB: target.ID}); err != nil {
		return fmt.Errorf("pair lock: %w", err)
	}
	if _, err := qtx.DeleteBlock(ctx, dbstore.DeleteBlockParams{BlockerID: blockerID, BlockedID: target.ID}); err != nil {
		return fmt.Errorf("delete block: %w", err)
	}
	stillBlocked, err := qtx.CheckIsBlocked(ctx, dbstore.CheckIsBlockedParams{UserA: blockerID, UserB: target.ID})
	if err != nil {
		return fmt.Errorf("check reverse block: %w", err)
	}
	releaseTransition := s.beginBlockTransition(blockerID, target.ID)
	transitionReleased := false
	defer func() {
		if !transitionReleased && releaseTransition != nil {
			releaseTransition()
		}
	}()
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if !stillBlocked {
		s.notifyUnblocked(blockerID, target.ID)
	}
	if releaseTransition != nil {
		transitionReleased = true
		releaseTransition()
	}
	return nil
}

// ---------- User settings ----------

// GetSettings retrieves the caller's privacy preferences.
func (s *Service) GetSettings(ctx context.Context, callerID string) (UserSettings, error) {
	if err := s.queries.UpsertDefaultUserSettings(ctx, callerID); err != nil {
		return UserSettings{}, fmt.Errorf("upsert settings: %w", err)
	}
	row, err := s.queries.GetUserSettings(ctx, callerID)
	if err != nil {
		return UserSettings{}, fmt.Errorf("get settings: %w", err)
	}
	return UserSettings{ReadReceiptsEnabled: row.ReadReceiptsEnabled}, nil
}

// UpdateSettings updates user privacy preferences using separate SQL statements inside
// an explicitly READ COMMITTED transaction (see LLD § 2.3).
func (s *Service) UpdateSettings(ctx context.Context, callerID string, enabled bool) (UserSettings, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return UserSettings{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// Statement 1: upsert default.
	if err := qtx.UpsertDefaultUserSettings(ctx, callerID); err != nil {
		return UserSettings{}, fmt.Errorf("upsert settings: %w", err)
	}
	// Statement 2 (L1): lock and capture previous.
	prev, err := qtx.GetUserSettingsForUpdate(ctx, callerID)
	if err != nil {
		return UserSettings{}, fmt.Errorf("lock settings: %w", err)
	}
	// Statement 3: update.
	updated, err := qtx.UpdateUserSettings(ctx, dbstore.UpdateUserSettingsParams{UserID: callerID, ReadReceiptsEnabled: enabled})
	if err != nil {
		return UserSettings{}, fmt.Errorf("update settings: %w", err)
	}
	// Statement 4 (L2): baseline pin on real false→true transition.
	if !prev.ReadReceiptsEnabled && enabled {
		if err := qtx.PinConversationMembersBaseline(ctx, callerID); err != nil {
			return UserSettings{}, fmt.Errorf("pin baseline: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return UserSettings{}, fmt.Errorf("commit: %w", err)
	}
	return UserSettings{ReadReceiptsEnabled: updated.ReadReceiptsEnabled}, nil
}

// ---------- Internal helpers ----------

func (s *Service) insertConvUpdatedEvent(
	ctx context.Context, qtx *dbstore.Queries, convID, status string,
	updated dbstore.Conversation, full dbstore.GetConversationForUserRow,
	userA, userB string,
) error {
	var snippet *MessageSnippet
	if full.LastMessageID != "" {
		snippet = &MessageSnippet{
			ID: full.LastMessageID, SenderID: full.LastMessageSenderID,
			Content: full.LastMessageContent, CreatedAt: tsToTime(full.LastMessageCreatedAt),
		}
	}
	env := eventEnvelope{
		V: 1, ID: NewUUID(), Type: "conversation.updated",
		Timestamp: tsToTime(updated.UpdatedAt).Format(time.RFC3339Nano),
		Payload: conversationUpdatedPayload{
			ConversationID: convID, Status: status,
			UpdatedAt: tsToTime(updated.UpdatedAt).Format(time.RFC3339Nano), LastMessage: snippet,
		},
	}
	envBytes, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal conv updated event: %w", err)
	}
	if _, err := qtx.InsertOutboxEvent(ctx, dbstore.InsertOutboxEventParams{
		EventType: "conversation.updated", ConversationID: convID, Payload: envBytes, TargetUserIds: []string{userA, userB},
	}); err != nil {
		return fmt.Errorf("insert conv updated event: %w", err)
	}
	return nil
}

func convFromRow(r dbstore.GetConversationForUserRow) Conversation {
	var snippet *MessageSnippet
	if r.LastMessageID != "" {
		snippet = &MessageSnippet{
			ID: r.LastMessageID, SenderID: r.LastMessageSenderID,
			Content: r.LastMessageContent, CreatedAt: tsToTime(r.LastMessageCreatedAt),
		}
	}
	peer := ""
	if r.PeerUsername != nil {
		peer = *r.PeerUsername
	}
	return Conversation{
		ID: r.ID, Type: r.Type, Status: r.Status, InitiatedBy: r.InitiatedBy,
		LastMessageSequence: r.LastMessageSequence,
		Peer:                PeerProfile{ID: r.PeerID, Username: peer, DisplayName: r.PeerDisplayName, Bio: r.PeerBio, AvatarURL: r.PeerAvatarUrl},
		LastMessage:         snippet, UnreadCount: r.UnreadCount,
		UpdatedAt: tsToTime(r.UpdatedAt), CreatedAt: tsToTime(r.CreatedAt),
	}
}

func msgFromRow(m dbstore.Message) Message {
	return Message{
		ID: m.ID, ConversationID: m.ConversationID, SenderID: m.SenderID,
		ClientMessageID: m.ClientMessageID, Content: m.Content, SequenceNum: m.SequenceNum,
		CreatedAt: tsToTime(m.CreatedAt), DeliveredAt: tsToTimePtr(m.DeliveredAt), ReadAt: tsToTimePtr(m.ReadAt),
	}
}

func buildPage(rows []dbstore.Message, limit int) MessagesPage {
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	msgs := make([]Message, 0, len(rows))
	for _, r := range rows {
		msgs = append(msgs, msgFromRow(r))
	}
	return MessagesPage{Messages: msgs, HasMore: more}
}
