-- +goose Up
-- Milestone 4: Real-time messaging, conversations, presence, outbox, and delivery receipts.

-- 1. Directional User Blocks
CREATE TABLE blocks (
    blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked_id ON blocks (blocked_id);

-- 2. Direct Conversations Table with Message Request State & Transactional Sequence Counter
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
    last_read_at              timestamptz,
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

-- Immutability Trigger 1: conversations identity columns (named a0_ to execute first)
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

-- Immutability Trigger 2: conversation_members identity columns (named a0_ to execute first)
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
    delivered_at      timestamptz,
    read_at           timestamptz,
    deleted_at        timestamptz,
    -- Prevent duplicate messages during client retries:
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
    ticket_hash  bytea PRIMARY KEY,
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

-- Trigger 6: Automatic default user settings on user registration
-- +goose StatementBegin
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

-- Backfill default settings for any existing users
INSERT INTO user_settings (user_id, read_receipts_enabled)
SELECT id, true FROM users
ON CONFLICT (user_id) DO NOTHING;
-- +goose StatementEnd

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
        -- Restrict conversations UPDATE to mutable columns ONLY:
        GRANT UPDATE (status, last_message_sequence, updated_at) ON conversations TO holoraa_app;

        -- Membership grants: DELETE is forbidden to application role
        GRANT SELECT, INSERT ON conversation_members TO holoraa_app;
        -- Restrict conversation_members UPDATE to mutable watermark columns ONLY:
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
