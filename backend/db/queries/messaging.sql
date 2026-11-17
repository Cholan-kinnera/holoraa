-- Pair Advisory Lock (Deterministic Deadlock-Free User Serialization)
-- name: AcquirePairAdvisoryLock :exec
SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(LEAST(@user_a::text, @user_b::text) || ':' || GREATEST(@user_a::text, @user_b::text)), 1, 16))::bit(64)::bigint
);

-- Blocks
-- name: CheckMutualFollow :one
SELECT (
    EXISTS (SELECT 1 FROM follows WHERE follower_id = @user_a::uuid AND following_id = @user_b::uuid)
    AND
    EXISTS (SELECT 1 FROM follows WHERE follower_id = @user_b::uuid AND following_id = @user_a::uuid)
) AS is_mutual;

-- name: CheckIsBlocked :one
SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = @user_a::uuid AND blocked_id = @user_b::uuid)
       OR (blocker_id = @user_b::uuid AND blocked_id = @user_a::uuid)
) AS is_blocked;

-- name: GetBlockRelationship :one
SELECT
    EXISTS (SELECT 1 FROM blocks WHERE blocker_id = @caller_id::uuid AND blocked_id = @peer_id::uuid) AS caller_blocked_peer,
    EXISTS (SELECT 1 FROM blocks WHERE blocker_id = @peer_id::uuid AND blocked_id = @caller_id::uuid) AS peer_blocked_caller;

-- name: CreateBlock :exec
INSERT INTO blocks (blocker_id, blocked_id)
VALUES ($1, $2)
ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

-- name: DeleteBlock :execrows
DELETE FROM blocks
WHERE blocker_id = $1 AND blocked_id = $2;

-- Conversations
-- name: GetConversationByID :one
SELECT id, type, status, user_a_id, user_b_id, initiated_by, last_message_sequence, created_at, updated_at
FROM conversations
WHERE id = $1;

-- name: GetConversationForUpdate :one
SELECT id, type, status, user_a_id, user_b_id, initiated_by, last_message_sequence, created_at, updated_at
FROM conversations
WHERE id = $1
FOR UPDATE;

-- name: GetDirectConversationByUsers :one
SELECT id, type, status, user_a_id, user_b_id, initiated_by, last_message_sequence, created_at, updated_at
FROM conversations
WHERE user_a_id = LEAST(@user_a::uuid, @user_b::uuid)
  AND user_b_id = GREATEST(@user_a::uuid, @user_b::uuid);

-- name: CreateDirectConversation :one
INSERT INTO conversations (
    id, type, status, user_a_id, user_b_id, initiated_by
)
VALUES (
    $1, 'direct', $2, LEAST(@user_a::uuid, @user_b::uuid), GREATEST(@user_a::uuid, @user_b::uuid), @initiated_by::uuid
)
RETURNING id, type, status, user_a_id, user_b_id, initiated_by, last_message_sequence, created_at, updated_at;

-- name: UpdateConversationStatus :one
UPDATE conversations
SET status = $2, updated_at = now()
WHERE id = $1
RETURNING id, type, status, user_a_id, user_b_id, initiated_by, last_message_sequence, created_at, updated_at;

-- name: IncrementConversationSequence :one
UPDATE conversations
SET last_message_sequence = last_message_sequence + 1,
    updated_at = now()
WHERE id = $1
RETURNING last_message_sequence;

-- name: ListConversationsForUser :many
SELECT
    c.id,
    c.type,
    c.status,
    c.initiated_by,
    c.last_message_sequence,
    c.created_at,
    c.updated_at,
    cm.last_read_sequence,
    cm.receipt_sequence,
    (CASE WHEN c.user_a_id = @user_id::uuid THEN c.user_b_id ELSE c.user_a_id END)::uuid AS peer_id,
    u.username AS peer_username,
    u.display_name AS peer_display_name,
    u.bio AS peer_bio,
    u.avatar_url AS peer_avatar_url,
    (
        SELECT count(*)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sequence_num > cm.last_read_sequence
          AND m.sender_id != @user_id::uuid
          AND m.deleted_at IS NULL
    ) AS unread_count,
    COALESCE(lm.id::text, '')::text AS last_message_id,
    COALESCE(lm.sender_id::text, '')::text AS last_message_sender_id,
    COALESCE(lm.content, '')::text AS last_message_content,
    lm.created_at AS last_message_created_at
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id::uuid
JOIN users u ON u.id = CASE WHEN c.user_a_id = @user_id::uuid THEN c.user_b_id ELSE c.user_a_id END
LEFT JOIN LATERAL (
    SELECT id, sender_id, content, created_at
    FROM messages
    WHERE conversation_id = c.id AND deleted_at IS NULL
    ORDER BY sequence_num DESC
    LIMIT 1
) lm ON true
ORDER BY c.updated_at DESC;

-- name: GetConversationForUser :one
SELECT
    c.id,
    c.type,
    c.status,
    c.initiated_by,
    c.last_message_sequence,
    c.created_at,
    c.updated_at,
    cm.last_read_sequence,
    cm.receipt_sequence,
    (CASE WHEN c.user_a_id = @user_id::uuid THEN c.user_b_id ELSE c.user_a_id END)::uuid AS peer_id,
    u.username AS peer_username,
    u.display_name AS peer_display_name,
    u.bio AS peer_bio,
    u.avatar_url AS peer_avatar_url,
    (
        SELECT count(*)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sequence_num > cm.last_read_sequence
          AND m.sender_id != @user_id::uuid
          AND m.deleted_at IS NULL
    ) AS unread_count,
    COALESCE(lm.id::text, '')::text AS last_message_id,
    COALESCE(lm.sender_id::text, '')::text AS last_message_sender_id,
    COALESCE(lm.content, '')::text AS last_message_content,
    lm.created_at AS last_message_created_at
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id::uuid
JOIN users u ON u.id = CASE WHEN c.user_a_id = @user_id::uuid THEN c.user_b_id ELSE c.user_a_id END
LEFT JOIN LATERAL (
    SELECT id, sender_id, content, created_at
    FROM messages
    WHERE conversation_id = c.id AND deleted_at IS NULL
    ORDER BY sequence_num DESC
    LIMIT 1
) lm ON true
WHERE c.id = @conversation_id::uuid;

-- Conversation Members
-- name: CreateConversationMember :exec
INSERT INTO conversation_members (conversation_id, user_id)
VALUES ($1, $2);

-- name: GetConversationMember :one
SELECT conversation_id, user_id, last_read_message_id, last_read_sequence, last_read_at,
       receipt_message_id, receipt_sequence, receipt_at, receipt_baseline_sequence, joined_at
FROM conversation_members
WHERE conversation_id = $1 AND user_id = $2;

-- name: GetConversationMemberForUpdate :one
SELECT conversation_id, user_id, last_read_message_id, last_read_sequence, last_read_at,
       receipt_message_id, receipt_sequence, receipt_at, receipt_baseline_sequence, joined_at
FROM conversation_members
WHERE conversation_id = $1 AND user_id = $2
FOR UPDATE;

-- name: GetConversationMembers :many
SELECT conversation_id, user_id, last_read_message_id, last_read_sequence, last_read_at,
       receipt_message_id, receipt_sequence, receipt_at, receipt_baseline_sequence, joined_at
FROM conversation_members
WHERE conversation_id = $1
ORDER BY joined_at ASC;

-- name: UpdatePrivateReadWatermark :one
UPDATE conversation_members
SET last_read_message_id = @message_id::uuid,
    last_read_sequence = @sequence_num::bigint,
    last_read_at = now()
WHERE conversation_id = @conversation_id::uuid
  AND user_id = @user_id::uuid
  AND @sequence_num::bigint > last_read_sequence
RETURNING last_read_sequence;

-- name: PinConversationMembersBaseline :exec
UPDATE conversation_members
SET receipt_baseline_sequence = last_read_sequence
WHERE user_id = $1;

-- Messages
-- name: CreateMessage :one
INSERT INTO messages (
    id, conversation_id, sender_id, client_message_id, content, sequence_num
)
VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at;

-- name: GetMessageByClientID :one
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE conversation_id = $1 AND sender_id = $2 AND client_message_id = $3;

-- name: GetMessageByID :one
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE id = $1;

-- name: GetMessageInConversation :one
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE id = $1 AND conversation_id = $2;

-- name: ListMessagesBefore :many
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE conversation_id = @conversation_id::uuid
  AND sequence_num < @before_sequence::bigint
  AND deleted_at IS NULL
ORDER BY sequence_num DESC
LIMIT @page_limit::int;

-- name: ListMessagesAfter :many
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE conversation_id = @conversation_id::uuid
  AND sequence_num > @after_sequence::bigint
  AND deleted_at IS NULL
ORDER BY sequence_num ASC
LIMIT @page_limit::int;

-- name: ListMessagesLatest :many
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at, read_at, deleted_at
FROM messages
WHERE conversation_id = @conversation_id::uuid
  AND deleted_at IS NULL
ORDER BY sequence_num DESC
LIMIT @page_limit::int;

-- name: MarkMessageDelivered :execrows
UPDATE messages
SET delivered_at = COALESCE(delivered_at, now())
WHERE id = @message_id::uuid
  AND conversation_id = @conversation_id::uuid
  AND delivered_at IS NULL;

-- name: MarkIncomingMessagesRead :many
UPDATE messages
SET read_at = now()
WHERE conversation_id = @conversation_id::uuid
  AND sequence_num > @baseline_sequence::bigint
  AND sequence_num <= @target_sequence::bigint
  AND sender_id != @reader_id::uuid
  AND read_at IS NULL
RETURNING id, sequence_num, read_at;

-- name: AdvanceReceiptWatermark :one
UPDATE conversation_members
SET receipt_message_id = @receipt_message_id::uuid,
    receipt_sequence = @receipt_sequence::bigint,
    receipt_at = @receipt_at::timestamptz
WHERE conversation_id = @conversation_id::uuid
  AND user_id = @reader_id::uuid
RETURNING receipt_sequence;

-- User Settings
-- name: UpsertDefaultUserSettings :exec
INSERT INTO user_settings (user_id, read_receipts_enabled)
VALUES ($1, true)
ON CONFLICT (user_id) DO NOTHING;

-- name: GetUserSettings :one
SELECT user_id, read_receipts_enabled, updated_at
FROM user_settings
WHERE user_id = $1;

-- name: GetUserSettingsForUpdate :one
SELECT user_id, read_receipts_enabled, updated_at
FROM user_settings
WHERE user_id = $1
FOR UPDATE;

-- name: UpdateUserSettings :one
UPDATE user_settings
SET read_receipts_enabled = $2,
    updated_at = now()
WHERE user_id = $1
RETURNING user_id, read_receipts_enabled, updated_at;

-- Outbox Events
-- name: InsertOutboxEvent :one
INSERT INTO outbox_events (
    event_type, conversation_id, payload, target_user_ids, status
)
VALUES (
    $1, $2, $3, $4, 'pending'
)
RETURNING id, event_type, conversation_id, payload, target_user_ids, attempts, status, created_at;

-- name: ClaimOutboxBatchWithLease :many
WITH claimable AS (
    SELECT id
    FROM outbox_events
    WHERE status IN ('pending', 'processing')
      AND (status = 'pending' OR lease_expires_at < now())
    ORDER BY id ASC
    LIMIT @batch_size::int
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events e
SET status = 'processing',
    claimed_by = @worker_id::text,
    claim_token = gen_random_uuid(),
    claimed_at = now(),
    lease_expires_at = now() + interval '30 seconds',
    attempts = attempts + 1
FROM claimable c
WHERE e.id = c.id
RETURNING e.id, e.event_type, e.conversation_id, e.payload, e.target_user_ids, e.attempts, e.claim_token;

-- name: IsOutboxLeaseValid :one
SELECT EXISTS (
    SELECT 1 FROM outbox_events
    WHERE id = @id::bigint
      AND claimed_by = @worker_id::text
      AND claim_token = @claim_token::uuid
      AND lease_expires_at > now()
) AS valid;

-- name: MarkOutboxPublished :execrows
UPDATE outbox_events
SET status = 'published',
    published_at = now(),
    lease_expires_at = NULL
WHERE id = @id::bigint
  AND claimed_by = @worker_id::text
  AND claim_token = @claim_token::uuid
  AND lease_expires_at > now();

-- name: MarkOutboxPoison :execrows
UPDATE outbox_events
SET status = 'poison',
    error_message = @error_message::text,
    lease_expires_at = NULL
WHERE id = @id::bigint
  AND claimed_by = @worker_id::text
  AND claim_token = @claim_token::uuid
  AND lease_expires_at > now();

-- name: MarkOutboxSuppressed :execrows
UPDATE outbox_events
SET status = 'published',
    published_at = now(),
    error_message = @error_message::text,
    lease_expires_at = NULL
WHERE id = @id::bigint
  AND claimed_by = @worker_id::text
  AND claim_token = @claim_token::uuid
  AND lease_expires_at > now();

-- name: ScheduleOutboxRetry :execrows
UPDATE outbox_events
SET status = 'processing',
    error_message = @error_message::text,
    lease_expires_at = @next_retry_at::timestamptz
WHERE id = @id::bigint
  AND claimed_by = @worker_id::text
  AND claim_token = @claim_token::uuid
  AND lease_expires_at > now();

-- Realtime Presence & Connection Helpers
-- name: ListActiveConversationIDsForUser :many
SELECT c.id
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id::uuid
WHERE c.status IN ('accepted', 'pending')
ORDER BY c.updated_at DESC;

-- name: ListPresencePeersForUser :many
SELECT
    (CASE WHEN c.user_a_id = @user_id::uuid THEN c.user_b_id ELSE c.user_a_id END)::uuid AS peer_id
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @user_id::uuid
WHERE c.status = 'accepted'
  AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
         OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
  );

-- WebSocket Tickets
-- name: CreateWSTicket :exec
INSERT INTO ws_tickets (ticket_hash, user_id, expires_at)
VALUES ($1, $2, $3);

-- name: ConsumeWSTicket :one
DELETE FROM ws_tickets
WHERE ticket_hash = $1
  AND expires_at > now()
RETURNING user_id;

-- name: CleanupExpiredWSTickets :execrows
DELETE FROM ws_tickets
WHERE expires_at <= now();
