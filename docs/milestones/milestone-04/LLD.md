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

-- 2. Conversations Table with Message Request State & Transactional Sequence Counter
CREATE TABLE conversations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type                  text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct')),
    status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    user_a_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_b_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    initiated_by          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    last_message_sequence bigint NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    -- Enforce deterministic canonical pairing (user_a_id strictly less than user_b_id)
    CHECK (user_a_id < user_b_id),
    -- Invariant: initiated_by must be one of the two conversation participants
    CHECK (initiated_by = user_a_id OR initiated_by = user_b_id),
    CONSTRAINT uq_conversations_direct_pair UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX idx_conversations_user_a ON conversations (user_a_id);
CREATE INDEX idx_conversations_user_b ON conversations (user_b_id);
CREATE INDEX idx_conversations_initiated_by ON conversations (initiated_by);
CREATE INDEX idx_conversations_status ON conversations (status);
CREATE INDEX idx_conversations_updated_at ON conversations (updated_at DESC);

-- 3. Conversation Memberships & Dual Watermarks (Private vs Peer-Visible)
CREATE TABLE conversation_members (
    conversation_id           uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id                   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Private read watermark (for unread counts & local sync)
    last_read_message_id      uuid,
    last_read_sequence        bigint NOT NULL DEFAULT 0,
    last_read_at              timestamptz, -- NULL until a real read event occurs
    -- Peer-visible receipt watermark (for peer double ticks)
    receipt_message_id        uuid,
    receipt_sequence          bigint NOT NULL DEFAULT 0,
    receipt_at                timestamptz,
    receipt_baseline_sequence bigint NOT NULL DEFAULT 0,
    joined_at                 timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id),
    -- Sequence Invariant CHECK Constraints
    CHECK (last_read_sequence >= 0),
    CHECK (receipt_sequence >= 0),
    CHECK (receipt_baseline_sequence >= 0),
    CHECK (receipt_sequence <= last_read_sequence),
    CHECK (receipt_baseline_sequence <= last_read_sequence)
);
CREATE INDEX idx_conversation_members_user ON conversation_members (user_id);

-- Immutability Trigger 1: conversations identity columns (named a0_ to execute before participant checks)
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_enforce_conversation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id <> OLD.id OR
       NEW.type <> OLD.type OR
       NEW.user_a_id <> OLD.user_a_id OR
       NEW.user_b_id <> OLD.user_b_id OR
       NEW.initiated_by <> OLD.initiated_by OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'cannot update immutable conversation identity columns'
            USING ERRCODE = 'feature_not_supported';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a0_enforce_conversation_immutability
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_conversation_immutability();

-- Immutability Trigger 2: conversation_members identity columns (named a0_ to execute before participant checks)
CREATE OR REPLACE FUNCTION trg_enforce_conversation_member_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.conversation_id <> OLD.conversation_id OR
       NEW.user_id <> OLD.user_id OR
       NEW.joined_at <> OLD.joined_at THEN
        RAISE EXCEPTION 'cannot update immutable conversation member identity columns'
            USING ERRCODE = 'feature_not_supported';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a0_enforce_conversation_member_immutability
BEFORE UPDATE ON conversation_members
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_conversation_member_immutability();

-- Trigger 3: Enforce that ONLY user_a_id or user_b_id can ever be inserted into conversation_members:
CREATE OR REPLACE FUNCTION trg_check_conversation_member()
RETURNS TRIGGER AS $$
DECLARE
    v_a uuid;
    v_b uuid;
BEGIN
    SELECT user_a_id, user_b_id INTO v_a, v_b
    FROM conversations
    WHERE id = NEW.conversation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'conversation % does not exist', NEW.conversation_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.user_id <> v_a AND NEW.user_id <> v_b THEN
        RAISE EXCEPTION 'user % is not authorized to join direct conversation % (allowed: % or %)',
            NEW.user_id, NEW.conversation_id, v_a, v_b
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_conversation_member_trigger
BEFORE INSERT OR UPDATE ON conversation_members
FOR EACH ROW
EXECUTE FUNCTION trg_check_conversation_member();

-- Trigger 4: Deferred constraint trigger on conversations (validates exactly 2 members at commit)
CREATE OR REPLACE FUNCTION trg_enforce_conv_two_members()
RETURNS TRIGGER AS $$
DECLARE
    v_count int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.id) THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_count
    FROM conversation_members
    WHERE conversation_id = NEW.id;

    IF v_count <> 2 THEN
        RAISE EXCEPTION 'direct conversation % must have exactly two members, found %', NEW.id, v_count
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_conversation_members_conv
AFTER INSERT ON conversations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_conv_two_members();

-- Trigger 5: Deferred constraint trigger on conversation_members (validates both OLD and NEW identities)
CREATE OR REPLACE FUNCTION trg_enforce_mem_two_members()
RETURNS TRIGGER AS $$
DECLARE
    v_count int;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Only validate if the parent conversation still exists.
        -- If the parent conversation was deleted (cascading delete), allow it.
        IF EXISTS (SELECT 1 FROM conversations WHERE id = OLD.conversation_id) THEN
            SELECT count(*) INTO v_count
            FROM conversation_members
            WHERE conversation_id = OLD.conversation_id;

            IF v_count <> 2 THEN
                RAISE EXCEPTION 'direct conversation % must have exactly two members, found %', OLD.conversation_id, v_count
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Validate NEW conversation identity if parent conversation exists
        IF EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id) THEN
            SELECT count(*) INTO v_count
            FROM conversation_members
            WHERE conversation_id = NEW.conversation_id;

            IF v_count <> 2 THEN
                RAISE EXCEPTION 'direct conversation % must have exactly two members, found %', NEW.conversation_id, v_count
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- Validate OLD conversation identity if conversation_id changed
        IF OLD.conversation_id IS DISTINCT FROM NEW.conversation_id THEN
            IF EXISTS (SELECT 1 FROM conversations WHERE id = OLD.conversation_id) THEN
                SELECT count(*) INTO v_count
                FROM conversation_members
                WHERE conversation_id = OLD.conversation_id;

                IF v_count <> 2 THEN
                    RAISE EXCEPTION 'direct conversation % must have exactly two members, found %', OLD.conversation_id, v_count
                        USING ERRCODE = 'check_violation';
                END IF;
            END IF;
        END IF;
        RETURN NULL;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_conversation_members_mem
AFTER UPDATE OR DELETE ON conversation_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_mem_two_members();

-- Trigger 6: Automatic default user settings on user registration
CREATE OR REPLACE FUNCTION trg_create_default_user_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_settings (user_id, read_receipts_enabled)
    VALUES (NEW.id, true)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_default_user_settings_trigger
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION trg_create_default_user_settings();
-- +goose StatementEnd

-- 4. Messages Table with Per-Conversation Monotonic Sequence Numbers & Sender Integrity
CREATE TABLE messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_message_id uuid NOT NULL,
    content           text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    sequence_num      bigint NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    delivered_at      timestamptz, -- populated when recipient client returns message.delivered ACK
    read_at           timestamptz, -- populated when peer reads message with receipts enabled
    deleted_at        timestamptz,
    -- Prevent duplicate messages during client network retries:
    CONSTRAINT uq_messages_client_id UNIQUE (conversation_id, sender_id, client_message_id),
    -- Foreign key target for conversation-scoped message references:
    CONSTRAINT uq_messages_conversation_id UNIQUE (conversation_id, id),
    -- Enforce strictly unique per-conversation sequence numbering:
    CONSTRAINT uq_messages_conversation_sequence UNIQUE (conversation_id, sequence_num),
    -- Enforce that sender MUST be an authorized member of this conversation:
    CONSTRAINT fk_messages_sender_member
        FOREIGN KEY (conversation_id, sender_id)
        REFERENCES conversation_members (conversation_id, user_id)
        ON DELETE CASCADE
);
CREATE INDEX idx_messages_cursor ON messages (conversation_id, sequence_num DESC);
CREATE INDEX idx_messages_sender ON messages (sender_id);

-- Enforce that watermark message pointers belong to this exact conversation:
-- PostgreSQL 17 column-specific ON DELETE SET NULL safely nullifies only the message pointer
-- while preserving the conversation_members row and primary key.
ALTER TABLE conversation_members
    ADD CONSTRAINT fk_conversation_members_last_read
        FOREIGN KEY (conversation_id, last_read_message_id)
        REFERENCES messages (conversation_id, id)
        ON DELETE SET NULL (last_read_message_id),
    ADD CONSTRAINT fk_conversation_members_receipt
        FOREIGN KEY (conversation_id, receipt_message_id)
        REFERENCES messages (conversation_id, id)
        ON DELETE SET NULL (receipt_message_id);

-- 5. Transactional Outbox with Explicit Lease Management & Fencing Tokens
CREATE TABLE outbox_events (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type       text NOT NULL CHECK (char_length(event_type) <= 64),
    conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    payload          jsonb NOT NULL,
    target_user_ids  uuid[] NOT NULL,
    attempts         smallint NOT NULL DEFAULT 0,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'poison')),
    claimed_by       text,
    claim_token      uuid,
    claimed_at       timestamptz,
    lease_expires_at timestamptz,
    error_message    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    published_at     timestamptz
);
-- Valid immutable partial index for outbox claiming sweeps:
CREATE INDEX idx_outbox_claimable ON outbox_events (id ASC)
    WHERE status IN ('pending', 'processing');

-- 6. Short-Lived Single-Use WebSocket Tickets (Hash Only)
CREATE TABLE ws_tickets (
    ticket_hash  bytea PRIMARY KEY CHECK (octet_length(ticket_hash) = 32),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ws_tickets_expires_at ON ws_tickets (expires_at);

-- 7. Persistent User Privacy Settings
CREATE TABLE user_settings (
    user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    read_receipts_enabled boolean NOT NULL DEFAULT true,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 8. Permissions for Runtime Database Role (Strict Column-Level UPDATE Grants)
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'holoraa_app') THEN
        -- Revoke all default table-level updates to enforce column-level security
        REVOKE ALL ON blocks, conversations, conversation_members, messages, outbox_events, ws_tickets, user_settings FROM holoraa_app;

        -- Table grants:
        GRANT SELECT, INSERT, DELETE ON blocks TO holoraa_app;
        GRANT SELECT, INSERT, DELETE ON conversations TO holoraa_app;
        -- Restrict conversations UPDATE to mutable columns ONLY (id, type, user_a_id, user_b_id, initiated_by are immutable):
        GRANT UPDATE (status, last_message_sequence, updated_at) ON conversations TO holoraa_app;

        -- Membership grants: DELETE is forbidden to application role (memberships deleted strictly via cascade)
        GRANT SELECT, INSERT ON conversation_members TO holoraa_app;
        -- Restrict conversation_members UPDATE to mutable watermark columns ONLY (conversation_id, user_id, joined_at are immutable):
        GRANT UPDATE (last_read_message_id, last_read_sequence, last_read_at,
                      receipt_message_id, receipt_sequence, receipt_at, receipt_baseline_sequence)
            ON conversation_members TO holoraa_app;

        GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ws_tickets TO holoraa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings TO holoraa_app;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE IF EXISTS conversation_members DROP CONSTRAINT IF EXISTS fk_conversation_members_receipt;
ALTER TABLE IF EXISTS conversation_members DROP CONSTRAINT IF EXISTS fk_conversation_members_last_read;
DROP TRIGGER IF EXISTS trg_conversation_members_mem ON conversation_members;
DROP FUNCTION IF EXISTS trg_enforce_mem_two_members;
DROP TRIGGER IF EXISTS trg_conversation_members_conv ON conversations;
DROP FUNCTION IF EXISTS trg_enforce_conv_two_members;
DROP TRIGGER IF EXISTS check_conversation_member_trigger ON conversation_members;
DROP FUNCTION IF EXISTS trg_check_conversation_member;
DROP TRIGGER IF EXISTS a0_enforce_conversation_member_immutability ON conversation_members;
DROP FUNCTION IF EXISTS trg_enforce_conversation_member_immutability;
DROP TRIGGER IF EXISTS a0_enforce_conversation_immutability ON conversations;
DROP FUNCTION IF EXISTS trg_enforce_conversation_immutability;
DROP TRIGGER IF EXISTS create_default_user_settings_trigger ON users;
DROP FUNCTION IF EXISTS trg_create_default_user_settings;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS ws_tickets;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS blocks;
```

---

## 2. Database Concurrency, Locks & Outbox Leases

### 2.1 Concurrency-Safe Blocking & Conversation Pair Serialization

#### The User-Pair Race Condition
Locking an existing conversation row with `SELECT ... FOR UPDATE` only protects pairs that already have a record in `conversations`. When no conversation exists yet, Alice initiating a conversation (`POST /v1/conversations/direct`) and Bob concurrently blocking Alice (`POST /v1/users/alice/block`) execute without an existing row to lock.

#### Pair-Level Serialization via Transaction-Scoped Advisory Locks
To guarantee deterministic serialization across all operations—regardless of whether a conversation already exists—both transactions acquire a 64-bit transaction-scoped advisory lock derived deterministically from the sorted user UUID pair:

```sql
-- Deterministic 64-bit lock key derived from ordered pair:
SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(LEAST(@user_a::text, @user_b::text) || ':' || GREATEST(@user_a::text, @user_b::text)), 1, 16))::bit(64)::bigint
);
```

#### Properties of the Pair Lock:
1. **Transaction-Scoped (`xact`):** Automatically released on transaction `COMMIT` or `ROLLBACK`. Zero leak risk across pooled connections.
2. **Deterministic & Deadlock-Free:** Because user UUIDs are ordered with `LEAST` and `GREATEST`, Alice blocking Bob and Bob messaging Alice compute the exact same 64-bit key and acquire it in the exact same order.
3. **Works for Nonexistent Conversations:** Does not require a pre-existing table row.

#### Complete Message Ingestion Transaction (Exact 8-Step Order):
```sql
BEGIN;

-- Step 1: Acquire pair advisory lock (deterministic order for both participants)
SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(LEAST(@user_a::text, @user_b::text) || ':' || GREATEST(@user_a::text, @user_b::text)), 1, 16))::bit(64)::bigint
);

-- Step 2: Lock and validate conversation row
SELECT id, status, initiated_by, user_a_id, user_b_id, last_message_sequence
FROM conversations
WHERE id = @conversation_id::uuid
FOR UPDATE;

-- Step 3: Check (conversation_id, sender_id, client_message_id) for an existing message (Idempotency)
SELECT id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at, delivered_at
FROM messages
WHERE conversation_id = @conversation_id::uuid
  AND sender_id = @sender_id::uuid
  AND client_message_id = @client_message_id::uuid;

-- Step 4: If duplicate, return the original message immediately without incrementing the counter; COMMIT and exit.
-- (Go service checks if row returned from Step 3: if found, commits transaction and returns original message).

-- Step 5: Validate block rules and request/permission status
SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = @sender_id::uuid AND blocked_id = @recipient_id::uuid)
       OR (blocker_id = @recipient_id::uuid AND blocked_id = @sender_id::uuid)
) AS is_blocked;
-- If is_blocked == true: rollback and return HTTP 403 Forbidden ("RELATIONSHIP_BLOCKED").
-- If status == 'declined': rollback and return HTTP 403 Forbidden ("REQUEST_DECLINED").
-- If status == 'pending':
--    If sender != initiated_by: rollback and return HTTP 403 Forbidden ("REQUEST_NOT_ACCEPTED").
--    If sender == initiated_by and last_message_sequence >= 1: rollback and return HTTP 403 Forbidden ("PENDING_REQUEST_LIMIT").

-- Step 6: Allocate the next per-conversation sequence number
UPDATE conversations
SET last_message_sequence = last_message_sequence + 1,
    updated_at = now()
WHERE id = @conversation_id::uuid
RETURNING last_message_sequence;

-- Step 7: Insert message and outbox event in the same transaction
INSERT INTO messages (
    id,
    conversation_id,
    sender_id,
    client_message_id,
    content,
    sequence_num
)
VALUES (
    gen_random_uuid(),
    @conversation_id::uuid,
    @sender_id::uuid,
    @client_message_id::uuid,
    @content::text,
    @next_sequence::bigint
)
RETURNING id, conversation_id, sender_id, client_message_id, content, sequence_num, created_at;

INSERT INTO outbox_events (
    event_type,
    conversation_id,
    payload,
    target_user_ids,
    status
)
VALUES (
    'message.created',
    @conversation_id::uuid,
    @event_payload::jsonb,
    ARRAY[@recipient_id::uuid],
    'pending'
);

-- Step 8: Commit
COMMIT;
```

#### Idempotency & Rollback Semantics:
- **No Sequence Allocation on Retries:** Because idempotency is checked at Step 3 before sequence allocation at Step 6, repeated client submissions with the same `(conversation_id, sender_id, client_message_id)` will never increment `conversations.last_message_sequence` or insert duplicate rows.
- **Rollback Behaviour & Sequence Gaps:** Unlike standalone PostgreSQL sequences (`CREATE SEQUENCE`) whose increments are not rolled back on abort, `conversations.last_message_sequence` is an ordinary table column updated within a transaction locked with `FOR UPDATE`. If an error occurs after Step 6 (e.g. database abort or network disconnect before commit), PostgreSQL's `ROLLBACK` completely rolls back the update, restoring `last_message_sequence` to its prior value. Therefore, aborted transactions do not leave sequence gaps.
- **Monotonicity Guarantees:** Monotonic ordering ($seq_{n+1} > seq_n$) is strictly preserved. In distributed event handling and cursor pagination, all operations compare sequence numbers relatively (`<` or `>`), ensuring zero synchronization degradation.

#### Blocking & Unblocking Lifecycle (Authoritative `blocks` Table Model):
Holoraa adopts the **Authoritative `blocks` Table with Dynamic Evaluation** pattern:
- `conversations.status` is strictly `('pending', 'accepted', 'declined')`. It represents the 1:1 message request state machine only.
- In the current MVP, `declined` is terminal for both participants: `POST /v1/conversations/direct` returns `403 Forbidden` if an existing canonical conversation has `status = 'declined'`, neither participant can reopen, accept, or send messages in it, mutual follows do not override `declined`, and `GET /v1/conversations` / `GET /v1/conversations/{id}` continue exposing `status = 'declined'` to both participants. Any future re-request capability requires a separately designed explicit lifecycle.
- The `blocks` table is the sole source of truth for user relationship restrictions.
- `conversations.status` is **never mutated to `'blocked'`**. This preserves whether the conversation was originally pending, accepted, or declined, eliminating all state restoration ambiguity upon unblock.

```sql
-- Blocking Transaction:
BEGIN;
-- Step 1: Acquire pair advisory lock (protects nonexistent & existing conversations alike)
SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(LEAST($a::text, $b::text) || ':' || GREATEST($a::text, $b::text)), 1, 16))::bit(64)::bigint
);

-- Step 2: Insert into blocks (authoritative source of block state)
INSERT INTO blocks (blocker_id, blocked_id)
VALUES ($blocker, $blocked)
ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

-- Note: conversations.status remains intact ('pending', 'accepted', or 'declined').
COMMIT;
```

```sql
-- Unblocking Transaction:
BEGIN;
-- Step 1: Acquire pair advisory lock
SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(LEAST($a::text, $b::text) || ':' || GREATEST($a::text, $b::text)), 1, 16))::bit(64)::bigint
);

-- Step 2: Remove from blocks
DELETE FROM blocks
WHERE blocker_id = $blocker AND blocked_id = $blocked;

-- The conversation immediately resumes in its exact prior state:
-- If it was 'pending', the recipient must still accept the request before replying.
-- If it was 'accepted', messaging resumes immediately.
COMMIT;
```

### 2.2 Explicit Outbox Lease Claiming with Fencing Tokens
The outbox worker claims pending events in an atomic database transaction **before** performing any network I/O. Fencing tokens (`claim_token uuid`) prevent stale workers from corrupting active leases:

```sql
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
```

#### Publication Completion & Stale Worker Rejection:
1. **Transaction 1 (Commit Claim):** Worker commits the lease update. Other workers see `status = 'processing'` and `lease_expires_at > now()`, skipping these rows.
2. **Network I/O:** Worker broadcasts frames over WebSockets.
3. **Transaction 2 (Mark Published with Fencing & Lease Expiry Check):**
   ```sql
   -- name: MarkOutboxPublished :execrows
   UPDATE outbox_events
   SET status = 'published',
       published_at = now(),
       lease_expires_at = NULL
   WHERE id = @id::bigint
     AND claimed_by = @worker_id::text
     AND claim_token = @claim_token::uuid
     AND lease_expires_at > now();
   ```
   - **Strict Lease Expiry Invariant:** If the worker's lease has expired (`lease_expires_at <= now()`), it must **NOT** mark the event as published, even if no other worker has claimed the event yet.
   - **Split-Brain Prevention:** At the lease expiration boundary, a concurrent worker evaluating `WHERE lease_expires_at < now()` in `ClaimOutboxBatchWithLease` may be in-flight to claim the row. Allowing an expired worker to succeed creates an un-fenced split-brain race where Worker 1 marks the event published while Worker 2 is already re-processing it, risking duplicate sends or corrupted lease metadata.
   - **Rows-Affected Verification:** By checking the rows affected (`:execrows`), if the lease expired before completion, the update returns 0 rows. The worker detects this, logs a warning (`"outbox lease expired before publication completion"`), and aborts without overwriting database state. The event remains safely claimable by the next sweep.
4. **Poison Isolation:** If `attempts >= 5`, the event is transitioned to `status = 'poison'`, logged as an operational alert, and excluded from standard processing.

### 2.3 Dual Read Watermarks & Privacy-Preserving Receipts

Holoraa enforces two distinct, decoupled read watermark concepts in `conversation_members`:
1. **Private Read Watermark (`last_read_sequence`, `last_read_message_id`, `last_read_at`):**
   - Strictly private to the reading member.
   - Advances whenever the member views messages in the thread, regardless of whether read receipts are enabled or disabled.
   - Computes accurate local unread counts (`WHERE sequence_num > cm.last_read_sequence`) and synchronizes scroll position across the user's own devices.
2. **Peer-Visible Receipt Watermark (`receipt_sequence`, `receipt_message_id`, `receipt_at`, `receipt_baseline_sequence`):**
   - Visible to conversation peers as delivery confirmation (coral double ticks).
   - Only advances when `user_settings.read_receipts_enabled` is true AND the message sequence exceeds `receipt_baseline_sequence`.
   - When receipts are disabled, private read progress continues, but `receipt_sequence` remains frozen and zero outbox events are emitted.
   - When receipts are re-enabled, `receipt_baseline_sequence` is atomically pinned to the current `last_read_sequence` **strictly on a real false-to-true transition**. The next receipt only discloses progress strictly greater than this baseline, ensuring messages read during the disabled period are **never retroactively disclosed**.

#### Read Receipt Semantics: Option B (Incoming Messages Newly Marked Read)
Holoraa strictly adopts **Option B: Read receipts represent actual incoming messages newly marked read**.
- **Reader advances view over own messages:** Advances only the reader's private read watermark (`last_read_sequence`) so unread count is 0 and scroll position synchronizes across the reader's devices. Because no incoming messages from the peer were newly read, `receipt_sequence` remains unchanged, `read_at` is not touched, and **zero `message.read` outbox events are emitted**.
- **Reader reads incoming messages:** When the reader's view advances over unread incoming messages (`sender_id != reader_id` and `read_at IS NULL`) while receipts are enabled, `messages.read_at` is set, `receipt_sequence` advances to the latest incoming message read, and a single `message.read` outbox event is emitted covering the exact sequence range (`fromSequenceNum` to `sequenceNum`).
- **Duplicate reads:** When a read cursor references an already-read sequence, 0 rows match `read_at IS NULL`, producing **zero outbox events**.
- **Disabled receipts:** When `user_settings.read_receipts_enabled = false`, 0 messages are updated and **zero outbox events are emitted**.
- **Re-enabling:** Transitioning from disabled to enabled pins `receipt_baseline_sequence = last_read_sequence`. Zero events are emitted upon toggle; subsequent receipts only disclose incoming messages with `sequence_num > receipt_baseline_sequence` (zero retroactive disclosure).

#### Strict Hierarchical Lock Order:
To eliminate deadlocks and ensure that receipt emission never executes against stale settings:
1. **Hierarchy Level 1:** Lock `user_settings` for the acting user (`FOR UPDATE` with safe upsert).
2. **Hierarchy Level 2:** Lock `conversation_members` row(s) for the acting user (`FOR UPDATE`).
3. **Hierarchy Level 3:** Execute atomic watermark advancement, `messages.read_at` update, and conditional outbox event insertion.
4. **Commit:** Commit transaction and release all locks simultaneously.

Both `POST /v1/conversations/{id}/read` and `PATCH /v1/me/settings` strictly adhere to this Level 1 $\to$ Level 2 hierarchy, making lock contention deadlock-free.

#### Exact Transaction Ordering: Advance Read Watermark (`POST /v1/conversations/{id}/read`):
```sql
BEGIN;

-- Step 1 (Lock Hierarchy L1): Safe upsert and row lock on reader's user_settings
INSERT INTO user_settings (user_id, read_receipts_enabled)
VALUES (@caller_id::uuid, true)
ON CONFLICT (user_id) DO NOTHING;

SELECT read_receipts_enabled
FROM user_settings
WHERE user_id = @caller_id::uuid
FOR UPDATE;

-- Step 2 (Lock Hierarchy L2): Lock conversation member row and capture current watermarks
SELECT
    last_read_sequence,
    receipt_sequence,
    receipt_baseline_sequence
FROM conversation_members
WHERE conversation_id = @conversation_id::uuid
  AND user_id = @caller_id::uuid
FOR UPDATE;

-- Step 3: Validate target message exists in this conversation
SELECT id, sequence_num
FROM messages
WHERE id = @new_message_id::uuid
  AND conversation_id = @conversation_id::uuid;
-- If message not found: abort with HTTP 400 Bad Request ("INVALID_CURSOR").

-- Step 4: Advance private read watermark unconditionally (strictly monotonic)
UPDATE conversation_members
SET last_read_message_id = @new_message_id::uuid,
    last_read_sequence = @target_sequence::bigint,
    last_read_at = now()
WHERE conversation_id = @conversation_id::uuid
  AND user_id = @caller_id::uuid
  AND @target_sequence::bigint > last_read_sequence;

-- Step 5: Option B: Newly Read Incoming Messages & Peer Receipt Advancement (Pure CTE)
WITH reader_setting AS (
    SELECT read_receipts_enabled
    FROM user_settings
    WHERE user_id = @caller_id::uuid
),
active_baseline AS (
    SELECT GREATEST(cm.receipt_sequence, cm.receipt_baseline_sequence) AS baseline
    FROM conversation_members cm
    WHERE cm.conversation_id = @conversation_id::uuid
      AND cm.user_id = @caller_id::uuid
),
newly_read_messages AS (
    -- Mark incoming messages read ONLY if sender is peer, receipts enabled, and sequence > baseline
    UPDATE messages m
    SET read_at = now()
    FROM reader_setting rs, active_baseline ab
    WHERE m.conversation_id = @conversation_id::uuid
      AND m.sequence_num > ab.baseline
      AND m.sequence_num <= @target_sequence::bigint
      AND m.sender_id != @caller_id::uuid
      AND m.read_at IS NULL
      AND rs.read_receipts_enabled = true
    RETURNING m.id, m.sequence_num, m.read_at
),
peer_advancement AS (
    -- Advance peer receipt ONLY IF incoming messages were actually marked read
    UPDATE conversation_members cm
    SET receipt_message_id = (SELECT id FROM newly_read_messages ORDER BY sequence_num DESC LIMIT 1),
        receipt_sequence = (SELECT sequence_num FROM newly_read_messages ORDER BY sequence_num DESC LIMIT 1),
        receipt_at = (SELECT read_at FROM newly_read_messages ORDER BY sequence_num DESC LIMIT 1)
    WHERE cm.conversation_id = @conversation_id::uuid
      AND cm.user_id = @caller_id::uuid
      AND EXISTS (SELECT 1 FROM newly_read_messages)
    RETURNING
        cm.conversation_id,
        cm.user_id AS reader_id,
        cm.receipt_message_id,
        cm.receipt_sequence,
        (SELECT min(sequence_num) FROM newly_read_messages) AS from_sequence_num,
        cm.receipt_at
)
-- Insert Outbox Event ONLY IF incoming messages were actually newly marked read:
INSERT INTO outbox_events (
    event_type,
    conversation_id,
    payload,
    target_user_ids,
    status
)
SELECT
    'message.read',
    pa.conversation_id,
    jsonb_build_object(
        'conversationId', pa.conversation_id,
        'userId', pa.reader_id,
        'messageId', pa.receipt_message_id,
        'sequenceNum', pa.receipt_sequence,
        'fromSequenceNum', pa.from_sequence_num,
        'readAt', pa.receipt_at
    ),
    ARRAY[@peer_id::uuid],
    'pending'
FROM peer_advancement pa;

COMMIT;
```

#### Exact Transaction Ordering: Toggle Privacy Setting (`PATCH /v1/me/settings`):
To prevent stale snapshot anomalies under PostgreSQL `READ COMMITTED`, the settings update executes as **separate SQL statements** inside a single transaction rather than a combined CTE:

```sql
BEGIN;

-- Statement 1 (Lock Hierarchy L1): Safe upsert ensures row exists
INSERT INTO user_settings (user_id, read_receipts_enabled)
VALUES (@user_id::uuid, true)
ON CONFLICT (user_id) DO NOTHING;

-- Statement 2 (Lock Hierarchy L1): Exclusively lock settings row and capture previous value
SELECT read_receipts_enabled AS previous_enabled
FROM user_settings
WHERE user_id = @user_id::uuid
FOR UPDATE;

-- Statement 3: Update user_settings with requested value
UPDATE user_settings
SET read_receipts_enabled = @requested_enabled::boolean,
    updated_at = now()
WHERE user_id = @user_id::uuid;

-- Statement 4 (Lock Hierarchy L2): Separate Statement for Baseline Pinning
-- Executed IF AND ONLY IF (previous_enabled == false AND requested_enabled == true).
--
-- Why a separate statement is mandatory:
-- Under PostgreSQL READ COMMITTED isolation, each SQL statement establishes a fresh
-- statement-level snapshot. If Statement 2 blocked waiting for an in-flight read transaction
-- to commit an updated last_read_sequence, executing Statement 4 as an independent statement
-- guarantees that it takes a fresh snapshot AFTER the lock was acquired.
-- Consequently, Statement 4 evaluates `receipt_baseline_sequence = last_read_sequence`
-- against the fresh, newly committed last_read_sequence (rather than a stale snapshot from
-- before the lock wait).
--
-- If previous_enabled == true and requested_enabled == true (repeated PATCH true),
-- Statement 4 is NOT executed, preserving the active baseline sequence intact.
UPDATE conversation_members
SET receipt_baseline_sequence = last_read_sequence
WHERE user_id = @user_id::uuid;

-- Statement 5: Commit transaction
COMMIT;
```

#### Membership Lifecycle & Deletion Semantics:
1. **Exactly-Two-Member Integrity (Deferred Constraint Triggers):**
   - Direct conversations require exactly two members corresponding to `user_a_id` and `user_b_id`.
   - Enforced by PostgreSQL deferred constraint triggers `trg_conversation_members_conv` (on `conversations`) and `trg_conversation_members_mem` (on `conversation_members`).
   - At transaction `COMMIT`, the triggers verify that `COUNT(*) == 2` in `conversation_members` for the conversation. Any attempt to commit an incomplete conversation (e.g. inserting only one participant) fails with `check_violation`.
2. **Prohibition of Independent Member Deletion:**
   - Members cannot independently leave or be deleted from direct conversations.
   - Trigger `trg_conversation_members_mem` fires on `DELETE FROM conversation_members`. If the parent conversation still exists, it detects `count != 2` and aborts the transaction with `check_violation`.
   - Database privileges explicitly revoke `DELETE` on `conversation_members` from the application role `holoraa_app`.
3. **Atomic Conversation Creation:**
   - Conversation creation transactions insert both rows into `conversations` and `conversation_members` atomically:
     ```sql
     BEGIN;
     SELECT pg_advisory_xact_lock(...);
     INSERT INTO conversations (id, type, status, user_a_id, user_b_id, initiated_by)
     VALUES ($id, 'direct', $status, $a, $b, $initiator);
     INSERT INTO conversation_members (conversation_id, user_id)
     VALUES ($id, $a), ($id, $b);
     COMMIT;
     ```
   - Incomplete conversations are never visible to other transactions under `READ COMMITTED` isolation.
4. **User Deletion Cascading Semantics:**
   - When a user deletes their account (`DELETE FROM users WHERE id = $id`), PostgreSQL foreign keys with `ON DELETE CASCADE` on `conversations.user_a_id` and `conversations.user_b_id` cascade-delete the entire conversation row.
   - Deleting the `conversations` row cascade-deletes:
     - `conversation_members` (via `REFERENCES conversations (id) ON DELETE CASCADE`)
     - `messages` (via `REFERENCES conversations (id) ON DELETE CASCADE`)
     - `outbox_events` (via `REFERENCES conversations (id) ON DELETE CASCADE`)
   - The deferred constraint trigger checks `IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = v_cid) RETURN NULL;`, allowing parent cascade deletion to complete cleanly without trigger violation.
   - It is impossible for one membership row to be deleted while leaving the conversation or messages orphaned or active.

#### Mathematical Proof of Zero Retroactive Disclosure:
Let $S_{\text{read}}$ be the set of message sequence numbers read while receipts were disabled: $S_{\text{read}} = \{s \mid s \le W_{\text{private}}\}$.
Upon re-enabling receipts, the transaction sets $B = W_{\text{private}}$.
For any subsequent read of message $k$ ($k > B$):
The database query updates `messages.read_at` exclusively `WHERE sequence_num > B AND sequence_num <= k`.
Because $\forall s \in S_{\text{read}}, s \le B$, no message from $S_{\text{read}}$ can satisfy `sequence_num > B`.
Therefore, messages read during the disabled window permanently retain `read_at IS NULL` and are excluded from outbox event payloads, even under arbitrary numbers of disable/re-enable cycles.

#### Concurrent Read & Setting Updates:
Both `POST /v1/conversations/{id}/read` and `PATCH /v1/me/settings` execute within PostgreSQL transactions locking the relevant rows (`FOR UPDATE OF cm` and `UPDATE conversation_members ... WHERE user_id = $1`). If a read occurs concurrently with a setting toggle, PostgreSQL serializes the two transactions: either the read executes before the setting change (evaluating previous state) or after the setting change (evaluating the updated baseline), preventing split-brain state or race conditions.

### 2.4 Keyset Pagination & Cursor Validation Protocol
Because each message in a conversation possesses a strictly monotonic, transactional `sequence_num`, keyset pagination is deterministic, immune to pagination drift, and avoids duplicate or skipped messages during concurrent writes.

#### Strict Cursor Validation Policy:
Before running pagination queries, the API strictly validates the provided cursor:
```sql
-- name: ValidateMessageCursor :one
SELECT id, sequence_num, deleted_at
FROM messages
WHERE id = @cursor_id::uuid
  AND conversation_id = @conversation_id::uuid;
```
1. **Non-Existent or Cross-Conversation Cursor:**
   If `@before_id` or `@after_id` does not return a row belonging to `@conversation_id`, the API returns RFC 9457 HTTP `400 Bad Request` with error code `INVALID_CURSOR`:
   ```json
   {
     "type": "https://holoraa.com/errors/invalid-cursor",
     "title": "Invalid Cursor",
     "status": 400,
     "detail": "The specified cursor message does not exist in this conversation.",
     "code": "INVALID_CURSOR"
   }
   ```
   *No Silent Fallback:* The API explicitly rejects silent fallback to newest messages. Silent fallbacks cause subtle client-side state corruption where pagination windows jump unexpectedly or duplicate displayed messages.
2. **Conflicting Cursors:**
   If a request supplies both `before` and `after`, the API returns RFC 9457 HTTP `400 Bad Request` with error code `INVALID_CURSOR_COMBINATION`:
   ```json
   {
     "type": "https://holoraa.com/errors/invalid-cursor-combination",
     "title": "Invalid Cursor Combination",
     "status": 400,
     "detail": "Cannot specify both 'before' and 'after' cursors.",
     "code": "INVALID_CURSOR_COMBINATION"
   }
   ```
3. **Soft-Deleted Message Cursors:**
   If the cursor message has `deleted_at IS NOT NULL` (soft-deleted), it **remains a completely valid pagination anchor**. Its `sequence_num` is immutable and permanent. The pagination queries anchor on `sequence_num < cursor.sequence_num` (or `> cursor.sequence_num`), while filtering `m.deleted_at IS NULL` for returned message items. Users scrolling past a deleted message experience contiguous, uninterrupted history.

#### Backward Keyset Pagination (Older History / Scroll-Up):
```sql
-- name: ListMessagesBefore :many
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
  AND (@before_id::uuid IS NULL OR m.sequence_num < (
      SELECT sequence_num FROM messages WHERE id = @before_id::uuid AND conversation_id = @conversation_id::uuid
  ))
  AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = @conversation_id::uuid AND cm.user_id = @caller_id::uuid
  )
ORDER BY m.sequence_num DESC
LIMIT @limit_val::int;
```
*Client Handling:* The server returns up to `limit` messages strictly older than `before_id`, ordered newest-to-oldest. The client prepends these to the message window in reverse order.

#### Forward Synchronization (Reconnect Catch-Up):
```sql
-- name: ListMessagesAfter :many
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
  AND m.sequence_num > (
      SELECT sequence_num FROM messages WHERE id = @after_id::uuid AND conversation_id = @conversation_id::uuid
  )
  AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = @conversation_id::uuid AND cm.user_id = @caller_id::uuid
  )
ORDER BY m.sequence_num ASC
LIMIT @limit_val::int;
```
*Client Handling:* Used after WebSocket reconnection to fetch any messages committed while the socket was offline, strictly in chronological order (`ASC`). Limit defaults to 50 (max 100).

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
1. **Exclusive Transport (`Sec-WebSocket-Protocol`):**
   Clients establish connections offering both the base application protocol and the ticket token:
   ```javascript
   const protocols = ["holoraa", "holoraa-ticket." + ticket];
   const socket = new WebSocket(wsUrl, protocols);
   ```
   - **RFC 6455 Subprotocol Negotiation:** The Go server inspects the `Sec-WebSocket-Protocol` header, extracts the ticket from the `holoraa-ticket.<ticket>` token, validates and consumes it atomically against PostgreSQL, and selects `holoraa` (which was explicitly included in the client's offered protocol array).
   - **Zero Secret Echo:** The server **never returns the secret ticket string as the negotiated protocol**. It strictly responds with `Sec-WebSocket-Protocol: holoraa` on HTTP 101 Switching Protocols.
   - **Query-String & Cookie Rejection:** Query-string tickets (`?ticket=...`), `?session=...` parameters, and long-lived session cookies are **strictly rejected** on `GET /v1/realtime/ws` (`401 Unauthorized`).
   - **Header Redaction & Atomic Invalidation:**
     ```sql
     DELETE FROM ws_tickets
     WHERE ticket_hash = sha256($1) AND expires_at > now()
     RETURNING user_id;
     ```
     Production reverse proxies and OpenTelemetry tracing must explicitly redact ticket-bearing headers (`Sec-WebSocket-Protocol: holoraa-ticket.[REDACTED]`), and the Go backend never logs request query strings or raw ticket values.

---

## 4. Complete Canonical REST API Specifications

All endpoints require authentication (`__Host-holoraa_session` or `holoraa_session`) and conform to OpenAPI 3.1.1.

| Method | Endpoint | CSRF? | Rate Limit | Request Body | Response (Success) | Description |
|---|---|:---:|:---:|---|---|---|
| `GET` | `/v1/conversations` | No | None | None | `200 OK` `{ "conversations": [...] }` | List caller's conversations (including declined) with snippets & unread counts. |
| `GET` | `/v1/conversations/{id}` | No | None | None | `200 OK` `{ ... }` | Get a single conversation by ID (including declined). |
| `GET` | `/v1/me/settings` | No | None | None | `200 OK` `{ "readReceiptsEnabled": bool }` | Get caller's persistent privacy settings. |
| `PATCH` | `/v1/me/settings` | Yes | None | `{ "readReceiptsEnabled": bool }` | `200 OK` `{ "readReceiptsEnabled": bool }` | Update caller's persistent privacy settings. |
| `POST` | `/v1/conversations/direct` | Yes | 5/hr | `{ "targetUsername": "bob" }` | `200/201 OK` `{ ... }` | Get or create canonical 1:1 conversation (403 if blocked or declined). |
| `POST` | `/v1/conversations/{id}/accept` | Yes | None | None | `200 OK` `{ "status": "accepted" }` | Accept a pending message request. |
| `POST` | `/v1/conversations/{id}/decline`| Yes | None | None | `200 OK` `{ "status": "declined" }` | Decline/archive a message request. |
| `GET` | `/v1/conversations/{id}/messages`| No | None | Query: `?before={id}&after={id}&limit=50` | `200 OK` `{ "messages": [...], "hasMore": bool }` | Keyset cursor message history & sync. |
| `POST` | `/v1/conversations/{id}/messages`| Yes | 30/min | `{ "clientMessageId": "uuid", "content": "..." }` | `201 Created` `{ "message": {...} }` | Send message (REST fallback). |
| `POST` | `/v1/conversations/{id}/read` | Yes | None | `{ "messageId": "uuid" }` | `204 No Content` | Advance monotonic read watermark. |
| `POST` | `/v1/users/{username}/block` | Yes | None | None | `204 No Content` | Block target user (idempotent). |
| `DELETE`| `/v1/users/{username}/block` | Yes | None | None | `204 No Content` | Unblock target user (idempotent). |
| `POST` | `/v1/realtime/ticket` | Yes | 10/min | None | `201 Created` `{ "ticket": "...", "expiresIn": 60 }` | Issue single-use WebSocket ticket. |
| `GET` | `/v1/realtime/ws` | No | 10/min | Header: `Sec-WebSocket-Protocol` (`holoraa, holoraa-ticket.<ticket>`) | `101 Switching Protocols` | Establish WebSocket connection (subprotocol ticket only). |

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
