-- Queries for users and profiles.

-- name: GetUserByID :one
SELECT id, username, display_name, bio, avatar_url, created_at, updated_at
FROM users
WHERE id = @id::uuid;

-- name: GetUserByUsername :one
SELECT id, username, display_name, bio, avatar_url, created_at, updated_at
FROM users
WHERE username = @username::text;

-- name: GetPublicProfile :one
SELECT id, username, display_name, bio, avatar_url
FROM users
WHERE username = @username::text;

-- name: GetProfileMe :one
SELECT u.id, COALESCE(e.email, '')::text AS email, u.username, u.display_name, u.bio, u.avatar_url
FROM users u
LEFT JOIN LATERAL (
    SELECT email FROM email_identities WHERE user_id = u.id ORDER BY created_at LIMIT 1
) e ON true
WHERE u.id = @id::uuid;

-- name: CreateUser :one
INSERT INTO users DEFAULT VALUES
RETURNING id, username, display_name, bio, avatar_url, created_at, updated_at;

-- name: SearchUsersPrefix :many
-- Fast prefix search used for 1-2 character inputs to bypass expensive trigram calculations.
SELECT
    u.id,
    u.username,
    u.display_name,
    u.bio,
    u.avatar_url,
    EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = @caller_id::uuid
          AND f.following_id = u.id
    ) AS is_following
FROM users u
WHERE u.username IS NOT NULL
  AND u.id != @caller_id::uuid
  AND (
      u.username ILIKE @prefix_query::text || '%'
      OR u.display_name ILIKE @prefix_query::text || '%'
  )
ORDER BY
    CASE WHEN u.username ILIKE @prefix_query::text || '%' THEN 0 ELSE 1 END,
    u.username ASC,
    u.id ASC
LIMIT @limit_val::int;

-- name: SearchUsersTrigram :many
-- Trigram similarity search used for 3+ character inputs.
SELECT
    u.id,
    u.username,
    u.display_name,
    u.bio,
    u.avatar_url,
    EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = @caller_id::uuid
          AND f.following_id = u.id
    ) AS is_following
FROM users u
WHERE u.username IS NOT NULL
  AND u.id != @caller_id::uuid
  AND (
      u.username ILIKE '%' || @escaped_query::text || '%'
      OR u.display_name ILIKE '%' || @escaped_query::text || '%'
      OR u.username % @raw_query::text
      OR u.display_name % @raw_query::text
  )
ORDER BY
    CASE
        WHEN u.username = lower(@raw_query::text) THEN 0
        WHEN u.username ILIKE lower(@escaped_query::text) || '%' THEN 1
        WHEN u.display_name ILIKE @escaped_query::text || '%' THEN 2
        ELSE 3
    END,
    similarity(u.username, lower(@raw_query::text)) DESC,
    u.username ASC,
    u.id ASC
LIMIT @limit_val::int;

-- name: GetPublicProfileWithRelationship :one
SELECT
    u.id,
    u.username,
    u.display_name,
    u.bio,
    u.avatar_url,
    (SELECT count(*) FROM follows WHERE following_id = u.id) AS followers_count,
    (SELECT count(*) FROM follows WHERE follower_id = u.id) AS following_count,
    EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = @caller_id::uuid
          AND f.following_id = u.id
    ) AS is_following
FROM users u
WHERE u.username = lower(@username::text)
  AND u.username IS NOT NULL;
