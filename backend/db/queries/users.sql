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
