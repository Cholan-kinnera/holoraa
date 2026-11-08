# Milestone 3 — User Profiles & Discovery: High-Level Design (HLD)

- **Milestone:** M3 (Frontend & Backend Slice 2)
- **Status:** Draft / Updated for Architectural Alignment
- **Target Release:** v2.0-alpha
- **Owner:** Core Architecture Lead

---

## 1. Architectural Principles & Operation Separation

Milestone 3 enforces strict architectural boundaries across three distinct operational concepts:

```
+-------------------------------------------------------------------------+
|                         OPERATIONAL BOUNDARIES                          |
+-------------------------------------------------------------------------+
| 1. User Discovery (Read-Only)                                           |
|    - Authenticated query over public profiles.                          |
|    - Excludes private data (email, sessions, audit events).             |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| 2. Following (Directional Social Edge)                                  |
|    - Connects follower -> following.                                    |
|    - Subscribes user to public content (The Spot / Notes).              |
|    - DOES NOT create a conversation.                                    |
|    - DOES NOT grant permission for unrestricted direct messaging.       |
+-------------------------------------------------------------------------+
                                    |
                                    v (Milestone 4 Boundary)
+-------------------------------------------------------------------------+
| 3. Conversation & Direct Messaging (Milestone 4)                        |
|    - Private messaging entity (conversations & conversation_members).   |
|    - Governed by mutual consent, DM policies, and blocking filters.     |
+-------------------------------------------------------------------------+
```

---

## 2. System Topology

```
+-------------------------------------------------------------------------+
|                               Browser Client                            |
|       (Next.js App Router / Workspace Drawer / Profile Dialogs)         |
+-------------------------------------------------------------------------+
                                    |
                         HTTPS + Cookie (SameSite=Lax)
                                    v
+-------------------------------------------------------------------------+
|                       Next.js BFF (Server Layer)                        |
|  - AppLayout session gate (/app/*)                                      |
|  - Server Actions: updateProfileAction, followUserAction                |
|  - Route Handler / BFF Proxy: /api/users/search (debounced)             |
+-------------------------------------------------------------------------+
                                    |
                        Internal HTTP / mTLS
                        Header: Cookie, Origin, X-CSRF-Token
                                    v
+-------------------------------------------------------------------------+
|                         Go Modular Monolith                             |
|  +-------------------------------------------------------------------+  |
|  | Chi Router + Security Middleware (Session, CSRF, Rate Limiting)   |  |
|  +-------------------------------------------------------------------+  |
|         |                                 |                             |
|         v                                 v                             |
|  +----------------------+      +-------------------------------------+  |
|  |   Profile Service    |      |    Discovery & Search Service       |  |
|  | - Me / PatchMe       |      | - Prefix (1-2 chars) / Trigram (3+) |  |
|  | - GetPublicProfile   |      | - Wildcard Escaping & Ranking       |  |
|  +----------------------+      | - Follow Graph Intersect (Counts)   |  |
|         |                      +-------------------------------------+  |
|         |                                 |                             |
|         +----------------+----------------+                             |
|                          v                                              |
|  +-------------------------------------------------------------------+  |
|  |               Repository Tier (sqlc + pgx/v5)                     |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
                                    |
                           PostgreSQL Connection
                                    v
+-------------------------------------------------------------------------+
|                    PostgreSQL 17 Database Engine                         |
|  - users (id, username, display_name, bio, avatar_url, updated_at)       |
|  - email_identities (email, user_id, verified_at)                       |
|  - follows (follower_id, following_id, created_at) [NEW]                |
|  - GIN Trigram Indexes: username_trgm, display_name_trgm [NEW]          |
+-------------------------------------------------------------------------+
```

---

## 3. Subsystem Architecture

### 3.1 User Discovery & Search Design

#### A. Dual-Mode Search Strategy
To avoid expensive fuzzy calculations on short inputs while providing typo-tolerant search for full words, search uses dual matching modes:
1. **Short Queries (1–2 characters):**
   - Pure B-tree prefix matching on `username` (`username ILIKE lower(@query) || '%'`).
   - Bypasses trigram index calculations entirely to prevent CPU spikes and high false-positive rates on single letters.
2. **Standard Queries (3+ characters):**
   - Trigram similarity matching (`pg_trgm`) and substring matching across `username` and `display_name`.

#### B. Normalization & Wildcard Safety
- Queries are trimmed of leading/trailing whitespace.
- If trimmed query is empty, the handler returns `[]` immediately without executing a database query.
- Special SQL LIKE characters (`%` and `_`) are explicitly escaped (`\%`, `\_`) to prevent wildcard injection attacks or table-scan denial-of-service attempts.
- Parameters are strictly bound via parameterized sqlc queries.

#### C. Deterministic Ranking
Search results are ordered using a deterministic 5-stage ranking model:
```sql
ORDER BY
    CASE
        WHEN u.username = lower(@query) THEN 0
        WHEN u.username ILIKE lower(@query) || '%' THEN 1
        WHEN u.display_name ILIKE @query || '%' THEN 2
        ELSE 3
    END,
    similarity(u.username, lower(@query)) DESC,
    u.username ASC,
    u.id ASC
```

#### D. Limits & Search Rate Limiting
- Hard limit cap: Maximum 20 candidates per request (default 10).
- Rate Limiting: 60 search requests per minute per authenticated user session. Exceeding returns HTTP 429 Too Many Requests with RFC 9457 Problem Details.
- Latency Target: Sub-50ms is treated as an empirical performance target to be measured and validated via `EXPLAIN ANALYZE` benchmarks, not an assumed guarantee.

---

### 3.2 Privacy & Public Profile Contract

#### A. Type Separation
The system strictly prevents data leakage by maintaining isolated models:
- **`profile.Me` (Caller Only):** Contains `id`, `email`, `username`, `displayName`, `bio`, `avatarUrl`, `profileComplete`.
- **`profile.PublicWithSocial` (Public):** Contains `id`, `username`, `displayName`, `bio`, `avatarUrl`, `followersCount`, `followingCount`, `isFollowing`. **`email` is completely omitted from the Go struct and SQL projection.**

#### B. Visibility Policy
- **Follower & Following Counts:** Visible as aggregate non-negative integers on public profiles.
- **Mutual Connections:** Computed relative to the authenticated caller:
  `SELECT count(*) FROM follows WHERE follower_id = @caller_id AND following_id IN (SELECT follower_id FROM follows WHERE following_id = @target_id)`
- **Private Data:** Email addresses, session tokens, IP hashes, and audit event logs are strictly unqueryable through public discovery endpoints.

---

### 3.3 Username Uniqueness & Concurrency Protection

- **Authoritative Enforcement:** Uniqueness is guaranteed exclusively by the PostgreSQL unique constraint `users_username_key` on `users(username)`.
- **Anti-TOCTOU Pattern:** The application does **not** rely solely on an initial availability check before updating, as concurrent requests would both pass the check and race.
- **Atomic Locking:** `PATCH /v1/me` acquires a row lock (`SELECT ... FOR UPDATE`) on the caller's row in a transaction and executes the `UPDATE`.
- **Constraint Violation Mapping:** If a concurrent transaction commits the same username first, PostgreSQL raises error code `23505` (`unique_violation`) with constraint `users_username_key`. The Go repository catches this and returns `profile.ErrUsernameTaken`, which Chi maps to HTTP 409 Conflict (`"That username is already taken."`).

---

### 3.4 Follow Abuse, Safety & Blocking Evaluation

#### A. Abuse Protections
- **Self-Follow Prevention:** Enforced at both the database level (`CHECK follower_id != following_id`) and API level (HTTP 400 Bad Request: `"You cannot follow yourself."`).
- **Idempotency:** `POST /v1/users/{username}/follow` uses `ON CONFLICT (follower_id, following_id) DO NOTHING` and returns HTTP 204 No Content.
- **Unfollow Idempotency:** `DELETE /v1/users/{username}/follow` deletes the edge cleanly and returns HTTP 204 No Content even if the edge did not exist.
- **Mutation Rate Limiting:** Capped at 30 follow/unfollow actions per minute per session to prevent automated follow-churn and social graph scraping.

#### B. User Blocking Evaluation (Include vs Defer)
- **Decision:** Explicitly **DEFER** block-user tables and APIs to **Milestone 4 (Conversations & Messaging Foundation)**.
- **Architectural Rationale:**
  - In Milestone 3, following is unidirectional and discovery is read-only. There are no messaging channels, no notifications, and no user-generated content delivery.
  - In Milestone 4, blocking must govern conversation initiation, mute WebSocket event dispatch, filter search visibility, and hide message threads. Implementing blocking alongside conversation creation policies ensures a cohesive security model without dual-write hazards.

---

### 3.5 Avatar Architecture & Future Cloudflare R2 Migration

1. **Milestone 3 Implementation:**
   - Validates HTTPS scheme only (`u.Scheme == "https"`), no embedded credentials (`u.User == nil`), no URL fragments, length <= 2048 characters.
   - Next.js uses standard responsive image rendering with `referrerPolicy="no-referrer"` to prevent leaking referer URLs to third-party image hosts.
   - **Fallback Initials:** If `avatarUrl` is null or fails to load, client renders a circular avatar containing the initial character of the display name over a deterministic dark-palette accent background.
   - **Broken Image Recovery:** Client-side `onError` handler automatically falls back to initials avatar, preventing broken image icons.
2. **Milestone 5 Cloudflare R2 Bridge:**
   - In Milestone 5, the backend will introduce `POST /v1/media/avatar-upload-url`, returning a presigned S3/R2 PUT URL with strict content-type (`image/jpeg`, `image/png`, `image/webp`) and 5MB size limit.
   - The client will upload directly to R2 and submit the resulting URL to `PATCH /v1/me`.

---

### 3.6 Database & Performance Review

- **`pg_trgm` Justification:**
  - Standard B-tree indexes only support exact and prefix matches (`query%`). They cannot search display names by last name (e.g., searching "sharma" for "Aanya Sharma") or tolerate minor typos.
  - `pg_trgm` is natively supported in Neon PostgreSQL 17, adds minimal index overhead on `users`, and avoids future schema refactoring.
  - Bypassing trigrams on 1–2 character queries protects database CPU from expensive calculations on short strings.
- **Rollback Strategy:**
  - `00003_user_discovery_and_follows.down.sql` drops `follows`, drops the GIN trigram indexes, and drops the extension. Existing user data in `users` and `email_identities` remains intact.
