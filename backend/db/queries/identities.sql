-- Queries for email identities.

-- name: GetEmailIdentityByEmail :one
SELECT email, user_id, created_at, verified_at
FROM email_identities
WHERE email = @email::text;

-- name: CreateEmailIdentity :one
INSERT INTO email_identities (email, user_id)
VALUES (@email::text, @user_id::uuid)
RETURNING email, user_id, created_at, verified_at;
