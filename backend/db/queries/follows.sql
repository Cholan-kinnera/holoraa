-- Queries for social graph follow relationships.

-- name: FollowUser :exec
INSERT INTO follows (follower_id, following_id)
VALUES (
    @follower_id::uuid,
    (SELECT id FROM users WHERE username = lower(@following_username::text))
)
ON CONFLICT (follower_id, following_id) DO NOTHING;

-- name: UnfollowUser :exec
DELETE FROM follows
WHERE follower_id = @follower_id::uuid
  AND following_id = (SELECT id FROM users WHERE username = lower(@following_username::text));

-- name: IsFollowing :one
SELECT EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = @follower_id::uuid
      AND following_id = @following_id::uuid
) AS is_following;

-- name: GetFollowCounts :one
SELECT
    (SELECT count(*) FROM follows WHERE following_id = @user_id::uuid) AS followers_count,
    (SELECT count(*) FROM follows WHERE follower_id = @user_id::uuid) AS following_count;
