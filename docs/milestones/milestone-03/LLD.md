# Milestone 3 — User Profiles & Discovery: Low-Level Design (LLD)

- **Milestone:** M3 (Frontend & Backend Slice 2)
- **Status:** Draft / Updated for Architectural Alignment
- **Target Release:** v2.0-alpha
- **Owner:** Database & Backend Engineering

---

## 1. Database Schema & Migration

File: **`backend/db/migrations/00003_user_discovery_and_follows.sql`**

```sql
-- +goose Up
-- Milestone 3: User discovery indexes and follow graph relationships.

-- 1. Enable pg_trgm for fuzzy typeahead matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram GIN indexes on users for sub-millisecond search.
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
```

---

## 2. SQL Queries (`sqlc`)

Additions to **`backend/db/queries/users.sql`**:

```sql
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
    u.username ASC
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
```

New file **`backend/db/queries/follows.sql`**:

```sql
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
```

---

## 3. Go Internal Interfaces & Data Models

In **`backend/internal/profile/profile.go`**:

```go
// Sentinel errors
var (
	ErrUsernameTaken    = errors.New("username taken")
	ErrNotFound         = errors.New("profile not found")
	ErrCannotFollowSelf = errors.New("cannot follow self")
)

// UserSummary represents a discovered user in search results.
type UserSummary struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	AvatarURL   *string `json:"avatarUrl"`
	IsFollowing bool    `json:"isFollowing"`
}

// PublicWithSocial includes relational context for public profile views.
type PublicWithSocial struct {
	ID             string  `json:"id"`
	Username       string  `json:"username"`
	DisplayName    *string `json:"displayName"`
	Bio            *string `json:"bio"`
	AvatarURL      *string `json:"avatarUrl"`
	FollowersCount int64   `json:"followersCount"`
	FollowingCount int64   `json:"followingCount"`
	IsFollowing    bool    `json:"isFollowing"`
}

// escapeLikeWildcards escapes % and _ to prevent wildcard injection in SQL LIKE queries.
func escapeLikeWildcards(raw string) string {
	s := strings.ReplaceAll(raw, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// Search routes queries to prefix or trigram matching based on length.
func (r *Repo) Search(ctx context.Context, callerID, rawQuery string, limit int) ([]UserSummary, error) {
	q := strings.TrimSpace(rawQuery)
	if q == "" {
		return []UserSummary{}, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}

	sanitized := escapeLikeWildcards(q)

	if len(q) < 3 {
		rows, err := r.queries.SearchUsersPrefix(ctx, dbstore.SearchUsersPrefixParams{
			CallerID:    callerID,
			PrefixQuery: sanitized,
			LimitVal:    int32(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("search users prefix: %w", err)
		}
		return mapSummary(rows), nil
	}

	rows, err := r.queries.SearchUsersTrigram(ctx, dbstore.SearchUsersTrigramParams{
		CallerID:     callerID,
		EscapedQuery: sanitized,
		RawQuery:     q,
		LimitVal:     int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("search users trigram: %w", err)
	}
	return mapSummary(rows), nil
}

// SearchLimiter enforces an atomic sliding-window rate limit on search requests (60 req/min).
type SearchLimiter struct {
	mu     sync.Mutex
	limits map[string][]time.Time
	limit  int
	window time.Duration
}

// Follow establishes a directional follow edge.
func (r *Repo) Follow(ctx context.Context, followerID, followingUsername string) error {
	u := strings.ToLower(strings.TrimSpace(followingUsername))
	target, err := r.Public(ctx, u)
	if err != nil {
		return err
	}
	if target.ID == followerID {
		return ErrCannotFollowSelf
	}
	return r.queries.FollowUser(ctx, dbstore.FollowUserParams{
		FollowerID:        followerID,
		FollowingUsername: u,
	})
}

// Unfollow removes a directional follow edge.
func (r *Repo) Unfollow(ctx context.Context, followerID, followingUsername string) error {
	u := strings.ToLower(strings.TrimSpace(followingUsername))
	if u == "" {
		return ErrNotFound
	}
	_, err := r.Public(ctx, u)
	if err != nil {
		return err
	}
	return r.queries.UnfollowUser(ctx, dbstore.UnfollowUserParams{
		FollowerID:        followerID,
		FollowingUsername: u,
	})
}
```

---

## 4. HTTP API Contract Additions (`contracts/openapi.yaml`)

```yaml
  /v1/users:
    get:
      operationId: searchUsers
      summary: Search users
      description: Returns a list of public user profiles matching query prefix or trigrams.
      security:
        - sessionCookie: []
      parameters:
        - name: q
          in: query
          required: false
          description: Search term (1 to 100 characters). Empty or whitespace returns an empty list.
          schema:
            type: string
            maxLength: 100
        - name: limit
          in: query
          required: false
          description: Maximum number of results (1 to 20). Defaults to 10.
          schema:
            type: integer
            minimum: 1
            maximum: 20
            default: 10
      responses:
        "200":
          description: List of discovered users.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserSearchResponse"
        "400":
          $ref: "#/components/responses/Problem"
        "401":
          $ref: "#/components/responses/Problem"
        "429":
          $ref: "#/components/responses/Problem"

  /v1/users/{username}/follow:
    post:
      operationId: followUser
      summary: Follow a user
      description: Establishes a directional follow relationship to the target user. Idempotent.
      security:
        - sessionCookie: []
          csrfToken: []
      parameters:
        - name: username
          in: path
          required: true
          description: The target username, case-insensitive.
          schema:
            type: string
            minLength: 3
            maxLength: 32
      responses:
        "204":
          description: Follow established or already existed.
        "400":
          $ref: "#/components/responses/Problem"
        "401":
          $ref: "#/components/responses/Problem"
        "403":
          $ref: "#/components/responses/Problem"
        "404":
          $ref: "#/components/responses/Problem"
        "429":
          description: Too many follow mutations from this session. Retry-After gives the wait in seconds.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
    delete:
      operationId: unfollowUser
      summary: Unfollow a user
      description: Removes a directional follow relationship to the target user. Idempotent.
      security:
        - sessionCookie: []
          csrfToken: []
      parameters:
        - name: username
          in: path
          required: true
          description: The target username, case-insensitive.
          schema:
            type: string
            minLength: 3
            maxLength: 32
      responses:
        "204":
          description: Follow removed or was not present.
        "401":
          $ref: "#/components/responses/Problem"
        "403":
          $ref: "#/components/responses/Problem"
        "404":
          $ref: "#/components/responses/Problem"
        "429":
          description: Too many follow mutations from this session. Retry-After gives the wait in seconds.
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
```

---

## 5. Frontend Component Architecture

### 5.1 Search Bar & Typeahead (`SearchOverlay.tsx`)
- Embeds in `ContextDrawer.tsx` header.
- **Outside Click & Escape Dismissal:**
  ```tsx
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);
  ```
- **Debounced Server Action:** Calls `searchUsersAction` with 250ms debounce.
- **Keyboard Navigation:** Arrow Down/Up navigates candidates, Enter opens `UserProfileModal`.

### 5.2 Public Profile Modal (`UserProfileModal.tsx`)
- Renders an accessible modal dialog (`role="dialog"`, `aria-modal="true"`).
- Displays avatar with initials fallback and broken image recovery (`onError={() => setImgError(true)}`).
- Follow/Unfollow button with optimistic state update and server action sync.
- Outside-click and Escape key dismissal.
