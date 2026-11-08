# Low-Level Design (LLD) — Milestone 4: Direct Messaging & Real-Time Events

- **Milestone:** M4 — Direct Messaging & Real-Time Events
- **Document Version:** 1.2.0
- **Status:** Proposed for Owner Approval
- **Author:** Senior Backend Architect, Application Security Engineer, Full-Stack Engineer

---

## 1. Database Schema & Migration Specification

The messaging subsystem requires forward-only PostgreSQL migration `00004_messaging_and_realtime.sql`.

### 1.1 Complete SQL Migration (`backend/db/migrations/00004_messaging_and_realtime.sql`)

```sql
-- +goose Up
-- Milestone 4: One-to-one direct messaging, conversation state, outbox, and blocking.

-- 1. User Blocking Relationships
CREATE TABLE blocks (
    blocker_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);
CREATE INDEX idx_blocks_blocked_id ON blocks (blocked_id);

-- 2. Conversations Table with Message Request State
CREATE TABLE conversations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type        text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct')),
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    user_a_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_b_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Enforce deterministic canonical pairing (user_a_id strictly less than user_b_id)
    CHECK (user_a_id < user_b_id),
    CONSTRAINT uq_conversations_direct_pair UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX idx_conversations_user_a ON conversations (user_a_id);
CREATE INDEX idx_conversations_user_b ON conversations (user_b_id);
CREATE INDEX idx_conversations_status ON conversations (status);
CREATE INDEX idx_conversations_updated_at ON conversations (updated_at DESC);

-- 3. Messages Table with Monotonic Sequence Numbers & Delivery Tracking
CREATE TABLE messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_message_id uuid NOT NULL,
    content           text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    sequence_num      bigint GENERATED ALWAYS AS IDENTITY,
    created_at        timestamptz NOT NULL DEFAULT now(),
    delivered_at      timestamptz, -- populated when recipient client returns message.delivered ACK
    deleted_at        timestamptz,
    -- Prevent duplicate messages during client network retries:
    CONSTRAINT uq_messages_client_id UNIQUE (conversation_id, sender_id, client_message_id)
);
CREATE INDEX idx_messages_cursor ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX idx_messages_sequence ON messages (conversation_id, sequence_num ASC);
CREATE INDEX idx_messages_sender ON messages (sender_id);

-- 4. Conversation Memberships & Monotonic Read Watermarks
CREATE TABLE conversation_members (
    conversation_id       uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    last_read_message_id  uuid REFERENCES messages (id) ON DELETE SET NULL,
    last_read_sequence    bigint NOT NULL DEFAULT 0,
    last_read_at          timestamptz NOT NULL DEFAULT now(),
    joined_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_members_user ON conversation_members (user_id);

-- 5. Transactional Outbox with Explicit Lease Management
CREATE TABLE outbox_events (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type       text NOT NULL CHECK (char_length(event_type) <= 64),
    conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    payload          jsonb NOT NULL,
    target_user_ids  uuid[] NOT NULL,
    attempts         smallint NOT NULL DEFAULT 0,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'poison')),
    claimed_by       text,
    claimed_at       timestamptz,
    lease_expires_at timestamptz,
    error_message    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    delivered_at     timestamptz
);
CREATE INDEX idx_outbox_claimable ON outbox_events (id ASC)
    WHERE status = 'pending' OR (status = 'processing' AND lease_expires_at < now());

-- 6. Short-Lived Single-Use WebSocket Tickets (Hash Only)
CREATE TABLE ws_tickets (
    ticket_hash  bytea PRIMARY KEY CHECK (octet_length(ticket_hash) = 32),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ws_tickets_expires_at ON ws_tickets (expires_at);

-- 7. Permissions for Runtime Database Role
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'holoraa_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON blocks TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_members TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ws_tickets TO holoraa_app;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS ws_tickets;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS blocks;
```

---

## 2. Database Concurrency, Locks & Outbox Leases

### 2.1 Concurrency-Safe Blocking & Message-Send Serialization
To prevent race conditions where a message send slips past a concurrent blocking operation, both operations acquire a row-level lock on the canonical conversation row:

```sql
-- Step 1 in Message Send Transaction:
SELECT c.id, c.status
FROM conversations c
WHERE c.id = @conversation_id::uuid
FOR UPDATE; -- Serializes against concurrent block operations

-- Step 2: Validate Block State inside locked transaction
SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = @sender_id::uuid AND blocked_id = @recipient_id::uuid)
       OR (blocker_id = @recipient_id::uuid AND blocked_id = @sender_id::uuid)
) AS is_blocked;
-- If is_blocked == true, rollback and return HTTP 403 Forbidden ("You cannot message this user.")

-- Step 3: Insert Message with Client Idempotency
INSERT INTO messages (conversation_id, sender_id, client_message_id, content)
VALUES (@conversation_id::uuid, @sender_id::uuid, @client_message_id::uuid, @content::text)
ON CONFLICT (conversation_id, sender_id, client_message_id) DO NOTHING
RETURNING id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at;

-- Step 4: Insert Outbox Event
INSERT INTO outbox_events (event_type, conversation_id, payload, target_user_ids, status)
VALUES ('message.created', @conversation_id::uuid, @event_payload::jsonb, ARRAY[@recipient_id::uuid], 'pending');

-- Step 5: Touch Conversation Timestamp
UPDATE conversations SET updated_at = now() WHERE id = @conversation_id::uuid;
```

**Blocking Transaction:**
```sql
-- When User B blocks User A:
BEGIN;
-- Lock conversation row to serialize against any active send transaction
SELECT id FROM conversations
WHERE (user_a_id = LEAST($a, $b) AND user_b_id = GREATEST($a, $b))
FOR UPDATE;

-- Insert block record
INSERT INTO blocks (blocker_id, blocked_id)
VALUES ($b, $a)
ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

COMMIT;
```
If a message send and a block execute concurrently, the `FOR UPDATE` lock forces sequential execution. If the block commits first, the send transaction's block check detects the committed block and fails closed.

### 2.2 Explicit Outbox Lease Claiming
The outbox worker claims pending events in an atomic database transaction **before** performing any network I/O:

```sql
-- name: ClaimOutboxBatchWithLease :many
UPDATE outbox_events
SET status = 'processing',
    claimed_by = @worker_id::text,
    claimed_at = now(),
    lease_expires_at = now() + interval '30 seconds',
    attempts = attempts + 1
WHERE id IN (
    SELECT id FROM outbox_events
    WHERE status = 'pending'
       OR (status = 'processing' AND lease_expires_at < now())
    ORDER BY id ASC
    LIMIT @batch_size::int
    FOR UPDATE SKIP LOCKED
)
RETURNING id, event_type, conversation_id, payload, target_user_ids, attempts;
```

**Dispatch & Completion:**
1. Transaction 1 (Commit Claim): Worker commits the lease update. Other workers or queries see `status = 'processing'` and `lease_expires_at > now()`, skipping these rows.
2. Network I/O: Worker broadcasts frames over WebSockets.
3. Transaction 2 (Mark Delivered):
   ```sql
   UPDATE outbox_events
   SET status = 'delivered', delivered_at = now(), lease_expires_at = NULL
   WHERE id = @id::bigint AND claimed_by = @worker_id::text;
   ```
4. **Expired Lease Recovery:** If the worker crashes or network I/O hangs past 30 seconds, `lease_expires_at < now()` evaluates to true. On the next claiming sweep, any active worker re-claims the event and retries delivery.
5. **Poison Isolation:** If `attempts >= 5`, the event is transitioned to `status = 'poison'`, logged as an operational alert, and excluded from standard processing.

### 2.3 Monotonic Read Watermark Updates
Read positions use the monotonic sequence number `messages.sequence_num`:

```sql
-- name: AdvanceReadWatermarkMonotonic :exec
UPDATE conversation_members
SET last_read_message_id = m.id,
    last_read_sequence = m.sequence_num,
    last_read_at = now()
FROM messages m
WHERE conversation_members.conversation_id = @conversation_id::uuid
  AND conversation_members.user_id = @caller_id::uuid
  AND m.id = @new_message_id::uuid
  AND m.conversation_id = @conversation_id::uuid -- validates message belongs to this conversation
  AND m.sequence_num > conversation_members.last_read_sequence; -- strictly monotonic
```
If a client sends an older or duplicate read event, `m.sequence_num > conversation_members.last_read_sequence` evaluates to false, updating 0 rows safely without error or deadlock.

### 2.4 Keyset Pagination & Reconnect Catch-Up Protocol
The API supports bidirectional keyset navigation (`before` for backward history, `after` for forward reconnect catch-up):

```sql
-- name: ListMessagesKeyset :many
SELECT
    m.id,
    m.conversation_id,
    m.sender_id,
    m.client_message_id,
    m.content,
    m.sequence_num,
    m.created_at,
    m.delivered_at
FROM messages m
WHERE m.conversation_id = @conversation_id::uuid
  AND m.deleted_at IS NULL
  AND (
      (@before_id::uuid IS NULL AND @after_id::uuid IS NULL)
      OR (@before_id::uuid IS NOT NULL AND (m.created_at, m.id) < ((SELECT created_at FROM messages WHERE id = @before_id::uuid), @before_id::uuid))
      OR (@after_id::uuid IS NOT NULL AND (m.created_at, m.id) > ((SELECT created_at FROM messages WHERE id = @after_id::uuid), @after_id::uuid))
  )
ORDER BY
    CASE WHEN @after_id::uuid IS NOT NULL THEN m.created_at END ASC,
    CASE WHEN @after_id::uuid IS NULL THEN m.created_at END DESC,
    m.id DESC
LIMIT @limit_val::int;
```

---

## 3. WebSocket Ticket Transport Evaluation & Security

### 3.1 Transport Comparison

| Feature | Option A: `Sec-WebSocket-Protocol` Header | Option B: URL Query Parameter (`?ticket=...`) |
|---|---|---|
| **Transport Medium** | HTTP Request Header | HTTP Request URL Path/Query |
| **Browser Support** | Native `new WebSocket(url, ['holoraa-ticket.' + t])` | Native `new WebSocket(url + '?ticket=' + t)` |
| **Browser History** | **Zero leakage** (headers are not stored in history) | Risk of storage in local history |
| **Proxy / Access Logs** | **Zero leakage** (headers excluded from access logs by default) | **High risk** (URLs logged by default by CDNs/proxies) |
| **APM & Tracing** | Headers scrubbed by default | URLs captured by trace spans unless redacted |

### 3.2 Implemented Security Architecture
1. **Primary Transport (`Sec-WebSocket-Protocol`):**
   Browser clients establish connection using:
   ```javascript
   const socket = new WebSocket(wsUrl, ["holoraa-ticket." + ticket]);
   ```
   The server extracts the ticket from the `Sec-WebSocket-Protocol` header and echoes `Sec-WebSocket-Protocol: holoraa` on HTTP 101 Switching Protocols.
2. **Fallback Query String & Residual Risk Mitigation:**
   For non-browser CLI test fixtures supporting query parameters:
   - **Log Redaction:** The Go `accessLog` middleware strips query strings matching `ticket=*` before writing structured log entries.
   - **Atomic Invalidation:**
     ```sql
     DELETE FROM ws_tickets
     WHERE ticket_hash = sha256($1) AND expires_at > now()
     RETURNING user_id;
     ```
   - **Residual Risk Notice:** Any intermediary proxy outside Holoraa's boundary (e.g. corporate forward proxies or misconfigured reverse proxies) that logs full URLs can capture query tickets. Therefore, the browser client **must exclusively use the `Sec-WebSocket-Protocol` transport**.

---

## 4. Complete Canonical REST API Specifications

All endpoints require authentication (`__Host-holoraa_session` or `holoraa_session`) and conform to OpenAPI 3.1.1.

| Method | Endpoint | CSRF? | Rate Limit | Request Body | Response (Success) | Description |
|---|---|:---:|:---:|---|---|---|
| `GET` | `/v1/conversations` | No | None | None | `200 OK` `{ "conversations": [...] }` | List caller's conversations with snippets & unread counts. |
| `POST` | `/v1/conversations/direct` | Yes | 5/hr | `{ "targetUsername": "bob" }` | `200/201 OK` `{ "conversation": {...} }` | Get or create canonical 1:1 conversation. |
| `POST` | `/v1/conversations/{id}/accept` | Yes | None | None | `200 OK` `{ "status": "accepted" }` | Accept a pending message request. |
| `POST` | `/v1/conversations/{id}/decline`| Yes | None | None | `200 OK` `{ "status": "declined" }` | Decline/archive a message request. |
| `GET` | `/v1/conversations/{id}/messages`| No | None | Query: `?before={id}&after={id}&limit=50` | `200 OK` `{ "messages": [...], "hasMore": bool }` | Keyset cursor message history & sync. |
| `POST` | `/v1/conversations/{id}/messages`| Yes | 30/min | `{ "clientMessageId": "uuid", "content": "..." }` | `201 Created` `{ "message": {...} }` | Send message (REST fallback). |
| `POST` | `/v1/conversations/{id}/read` | Yes | None | `{ "messageId": "uuid" }` | `204 No Content` | Advance monotonic read watermark. |
| `POST` | `/v1/users/{username}/block` | Yes | None | None | `204 No Content` | Block target user (idempotent). |
| `DELETE`| `/v1/users/{username}/block` | Yes | None | None | `204 No Content` | Unblock target user (idempotent). |
| `POST` | `/v1/realtime/ticket` | Yes | 10/min | None | `201 Created` `{ "ticket": "...", "expiresIn": 60 }` | Issue single-use WebSocket ticket. |
| `GET` | `/v1/realtime/ws` | No | 10/min | Header / Query: `ticket` | `101 Switching Protocols` | Establish WebSocket connection. |

---

## 5. Complete WebSocket Event Contract

All frames use JSON envelopes: `{"v": 1, "id": "uuid", "type": "...", "timestamp": "...", "payload": {...}}`.

### 5.1 Client -> Server Events
1. `ping`: Heartbeat probe (`{}`).
2. `message.send`: `{ "conversationId": "uuid", "clientMessageId": "uuid", "content": "string" }`
3. `message.delivered`: `{ "conversationId": "uuid", "messageId": "uuid" }` (Explicit client delivery ACK).
4. `message.read`: `{ "conversationId": "uuid", "messageId": "uuid" }` (Read watermark advancement).
5. `typing.started`: `{ "conversationId": "uuid" }`
6. `typing.stopped`: `{ "conversationId": "uuid" }`

### 5.2 Server -> Client Events
1. `pong`: Heartbeat reply (`{}`).
2. `connection.ready`: `{ "userId": "uuid", "serverTime": "...", "activeConversations": ["uuid"] }`
3. `message.ack`: `{ "clientMessageId": "uuid", "messageId": "uuid", "sequenceNum": 104, "createdAt": "..." }`
4. `message.created`: `{ "message": { "id", "conversationId", "senderId", "content", "sequenceNum", "createdAt" } }`
5. `message.status`: `{ "conversationId": "uuid", "messageId": "uuid", "status": "delivered" | "read", "timestamp": "..." }`
6. `typing.indicator`: `{ "conversationId": "uuid", "userId": "uuid", "isTyping": bool }`
7. `presence.updated`: `{ "userId": "uuid", "status": "online" | "offline", "lastSeenAt": "..." }`
8. `conversation.updated`: `{ "conversation": { "id", "status", "updatedAt", "lastMessage": {...} } }`
9. `error`: `{ "code": "UNAUTHORIZED" | "RATE_LIMITED" | "BLOCKED", "message": "...", "clientMessageId": "uuid" }`

---

## 6. Next.js BFF & React Client Hook Architecture

### 6.1 Server Actions (`web/src/app/app/messages/actions.ts`)
- `getConversationsAction()`
- `getOrCreateDirectConversationAction(targetUsername: string)`
- `acceptMessageRequestAction(conversationId: string)`
- `declineMessageRequestAction(conversationId: string)`
- `getMessagesAction(conversationId: string, options?: { before?: string; after?: string; limit?: number })`
- `sendMessageAction(conversationId: string, clientMessageId: string, content: string)`
- `markConversationReadAction(conversationId: string, messageId: string)`
- `blockUserAction(username: string)`
- `unblockUserAction(username: string)`
- `issueRealtimeTicketAction()`

### 6.2 Client Realtime Hook State Machine (`web/src/lib/realtime/useRealtimeSocket.ts`)
- **Transport:** Uses `new WebSocket(url, ['holoraa-ticket.' + ticket])`.
- **States:** `DISCONNECTED` -> `FETCHING_TICKET` -> `CONNECTING` -> `CONNECTED` -> `RECONNECTING`.
- **Heartbeat Loop:** Sends `ping` every 30 seconds. If no `pong` is received within 10 seconds, closes socket with code `4000` to trigger fresh ticket acquisition and reconnection.
- **Reconnect Jitter:** Full jitter exponential backoff: `Math.min(1000 * Math.pow(2, attempts) + Math.random() * 500, 30000)`.
- **Visibility Observer:** Attaches `IntersectionObserver` to message bubbles. When a message bubble is in viewport for ≥ 500ms while window has focus, dispatches `message.read`.
