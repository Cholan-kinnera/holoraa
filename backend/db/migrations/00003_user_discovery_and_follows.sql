-- +goose Up
-- Milestone 3: User discovery indexes and follow graph relationships.

-- 1. Enable pg_trgm for fuzzy typeahead matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram GIN indexes on users for search.
CREATE INDEX IF NOT EXISTS users_username_trgm_idx ON users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx ON users USING gin (display_name gin_trgm_ops);

-- 3. Social graph follow relationships.
CREATE TABLE follows (
    follower_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_following_id ON follows (following_id);

-- 4. Runtime permissions for holoraa_app.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'holoraa_app') THEN
        GRANT SELECT, INSERT, DELETE ON follows TO holoraa_app;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS follows;
DROP INDEX IF EXISTS users_display_name_trgm_idx;
DROP INDEX IF EXISTS users_username_trgm_idx;
