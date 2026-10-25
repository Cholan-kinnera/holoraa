-- +goose Up
-- Slice 1 of M9: accounts, email sign-in, sessions, and profiles.
-- Design: docs/architecture/AUTH_AND_PROFILES.md, decision: docs/adr/0009-authentication-and-sessions.md.
--
-- Secrets are never stored here in plain form: codes and session tokens are
-- stored as keyed MACs or SHA-256 digests, and client addresses as keyed MACs.

-- Profiles. One row per account. username is NULL until profile setup.
CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username     text UNIQUE CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,31}$'),
    display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 64),
    bio          text CHECK (bio IS NULL OR char_length(bio) <= 300),
    avatar_url   text CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Sign-in identities, separate from profiles. A later Google identity table
-- is keyed by provider subject, never by email alone.
CREATE TABLE email_identities (
    email       text PRIMARY KEY CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_identities_user_id_idx ON email_identities (user_id);

-- One-time code challenges. code_mac is HMAC(secret, challenge id and code).
CREATE TABLE email_otp_challenges (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
    code_mac    bytea NOT NULL CHECK (octet_length(code_mac) = 32),
    attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    ip_hash     bytea NOT NULL CHECK (octet_length(ip_hash) = 32),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_otp_challenges_expires_at_idx ON email_otp_challenges (expires_at);

-- Server-side sessions. token_hash is SHA-256 of the raw token.
CREATE TABLE sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash          bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at          timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    idle_expires_at     timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Send and failure events, used only for rate limits. Keys are MACs, not raw
-- addresses or emails.
CREATE TABLE auth_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('otp_sent', 'verify_failed')),
    ip_hash    bytea NOT NULL CHECK (octet_length(ip_hash) = 32),
    email_hash bytea CHECK (email_hash IS NULL OR octet_length(email_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_kind_ip_created_idx ON auth_events (kind, ip_hash, created_at);
CREATE INDEX auth_events_kind_email_created_idx ON auth_events (kind, email_hash, created_at);

-- Runtime grants. The runtime role is created by the workspace transition
-- runbook (docs/runbooks/workspace-transition.md). In development it may not
-- exist yet, so the grants apply only when it does.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'holoraa_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON users, email_identities, email_otp_challenges, sessions, auth_events TO holoraa_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO holoraa_app;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS auth_events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS email_otp_challenges;
DROP TABLE IF EXISTS email_identities;
DROP TABLE IF EXISTS users;
