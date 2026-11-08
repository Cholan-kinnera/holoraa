# Milestone 3 — User Profiles & Discovery: Product Requirements Document (PRD)

- **Milestone:** M3 (Frontend & Backend Slice 2)
- **Status:** Draft / Updated for Architectural Alignment
- **Target Release:** v2.0-alpha
- **Owner:** Core Engineering

---

## 1. Problem Statement

Following the completion of Milestone 2 (passwordless OTP authentication and opaque session infrastructure), users can authenticate securely. However, an authenticated account alone does not create a functional social space:
1. New accounts lack a guided onboarding flow to claim a unique identity (handle and display name).
2. Users have no mechanism to discover friends, search for known peers, or view public profile information.
3. The platform lacks the foundational relationship graph (following) required to prepare direct conversations and group spaces in Milestone 4.

Milestone 3 establishes user profiles, search discovery, and social relationships while strictly adhering to Holoraa's core non-negotiables: **zero algorithmic feed manipulation, no tracking pixels, privacy by default, and calm, human-centred interaction**.

---

## 2. Core Architectural Separation: Discovery, Following, and Messaging

Milestone 3 explicitly separates three distinct concepts:

```
+-----------------------------------------------------------------------------------+
| 1. User Discovery                                                                 |
|    - Read-only search & profile viewing.                                          |
|    - Authenticated discovery over complete public profiles.                       |
+-----------------------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------------------+
| 2. Following (Social Graph)                                                       |
|    - Directional relationship edge: follower -> following.                       |
|    - Signals interest in public content (The Spot / Notes).                       |
|    - DOES NOT create a conversation.                                              |
|    - DOES NOT grant permission for unrestricted direct messaging.                 |
+-----------------------------------------------------------------------------------+
                                    |
                                    v (Milestone 4 Boundary)
+-----------------------------------------------------------------------------------+
| 3. Conversation & Direct Messaging (Milestone 4)                                  |
|    - Distinct messaging entity: conversations & conversation_members.             |
|    - Governed by mutual relationship consent and M4 conversation creation policy.|
+-----------------------------------------------------------------------------------+
```

---

## 3. Objectives & Scope

### In Scope
- **Profile Onboarding & Completion:** Mandatory setup prompt for new accounts lacking a claimed username (`users.username IS NULL`).
- **Identity Management:** Full lifecycle for usernames (`^[a-z][a-z0-9_]{2,31}$`), display names (1–64 UTF-8 characters), bios (up to 300 characters), and avatar HTTPS links.
- **Uniqueness & Reservation Engine:** Database-level uniqueness enforcement (`users_username_key`) with atomic conflict handling and reserved system handles (`admin`, `api`, `holoraa`, `me`, `root`, `support`, `users`, `v1`).
- **User Discovery & Typeahead Search:** Authenticated, rate-limited user search with dual-mode matching (prefix for short queries, trigram for 3+ chars), strict wildcard escaping, and deterministic ranking.
- **Public Profile Viewing:** Read-only public profile cards exposing display name, username, bio, avatar, and relationship counts, while **strictly redacting** email addresses, IP records, and session metadata.
- **Relationship Foundation (M4 Pre-requisite):** Directional follow edges (`follows` table) establishing mutual and directional graphs.

### Deferred to Future Milestones
- **User Blocking & Muting:** Deferred to **Milestone 4 (Conversations & Messaging Foundation)**, where it will be implemented alongside conversation creation permissions, message filtering, and WebSocket event suppression.
- **Realtime WebSocket Messaging:** Deferred to **Milestone 4**.
- **Binary Media Uploads to Cloudflare R2:** Deferred to **Milestone 5**.
- **WebRTC Voice and Video Calls:** Deferred to **Milestone 6**.
- **Push Notifications:** Deferred to **Milestone 7**.
- **Algorithmic Feed Ranking & Engagement Traps:** **Permanent Non-Goal**.

---

## 4. User Stories

| ID | As a... | I want to... | So that... |
|---|---|---|---|
| **US-01** | New user | Be prompted to choose a unique username and display name immediately upon first sign-in | My friends can recognize and identify me. |
| **US-02** | User | Receive immediate inline feedback if a username is already taken or reserved | I can select an available handle without losing form state. |
| **US-03** | User | Update my display name, bio, and avatar URL at any time | I can keep my personal presentation accurate. |
| **US-04** | User | Search for friends by typing a partial username or name | I can easily locate people I want to connect with. |
| **US-05** | User | Click a search candidate to view their public profile card | I can verify who they are and see their bio and follower counts. |
| **US-06** | User | Follow another user | We establish a directional connection ready for conversation creation in Milestone 4. |

---

## 5. Functional Requirements

### FR-01: Profile Setup Gate
- When a user session reports `profileComplete: false`, access to workspace routes is intercepted, routing the user to `/app/profile?setup=1`.
- The user cannot participate in public spaces, follow other users, or initiate searches until a valid username is claimed.

### FR-02: Username Syntax & Uniqueness
- Usernames must match `^[a-z][a-z0-9_]{2,31}$` (3–32 characters, lowercase letters, numbers, and underscores, starting with a letter).
- Comparison is strictly case-insensitive.
- System reserved handles cannot be registered (`admin`, `api`, `holoraa`, `me`, `root`, `support`, `users`, `v1`).
- Database collisions must return RFC 9457 Problem Details with HTTP 409 Conflict based on the authoritative PostgreSQL unique constraint.

### FR-03: Profile Attributes & Editing
- **Display Name:** Required, 1 to 64 UTF-8 characters, stripped of leading/trailing whitespace, no control characters.
- **Bio:** Optional, up to 300 characters, can be cleared by sending an empty string or null.
- **Avatar URL:** Optional, validated HTTPS URL without embedded credentials, up to 2048 characters.
- Partial updates via `PATCH /v1/me` support updating any combination of these fields atomically.

### FR-04: User Search & Discovery API
- Endpoint: `GET /v1/users?q={query}&limit={limit}`.
- Authenticated: Requires a valid session cookie. Unauthenticated requests fail closed with HTTP 401.
- Query Normalization:
  - Minimum query length: 1 character.
  - Empty or whitespace-only queries immediately return HTTP 200 with `[]` without hitting the database.
  - SQL LIKE special characters (`%` and `_`) are escaped (`\%`, `\_`) to prevent wildcard injection attacks.
- Search Matching:
  - **1–2 characters:** Pure B-tree prefix matching on `username` (`username ILIKE lower(@query) || '%'`). Expensive fuzzy matching is bypassed.
  - **3+ characters:** Trigram similarity matching (`pg_trgm`) and substring matching across `username` and `display_name`.
- Deterministic Ranking:
  1. Exact username match (`username = lower(@query)`).
  2. Prefix username match (`username ILIKE lower(@query) || '%'`).
  3. Prefix display name match (`display_name ILIKE @query || '%'`).
  4. Trigram similarity score.
  5. Tie-breaker: `username ASC, id ASC`.
- Result limits: Hard cap of 20 results per request (default 10).
- Exclusions: Strictly excludes the calling user (`id != caller.id`) and incomplete accounts (`username IS NULL`).
- Search Rate Limiting: 60 requests per minute per authenticated user session. Exceeding returns HTTP 429 Too Many Requests.

### FR-05: Public Profile Contract & Visibility Policy
- Endpoint: `GET /v1/users/{username}`.
- Visibility Policy:
  - **Public Fields:** `id` (UUID), `username`, `displayName`, `bio`, `avatarUrl`, `followersCount`, `followingCount`.
  - **Relational Field (Caller-Specific):** `isFollowing` (boolean indicating if the caller follows this target).
  - **Strictly Excluded (Private):** Email address, IP hashes, session tokens, verification codes, and internal audit logs are **never** returned in public endpoints.

### FR-06: Follow Relationships (M4 Enabler)
- Endpoints:
  - `POST /v1/users/{username}/follow` (Create directional relationship)
  - `DELETE /v1/users/{username}/follow` (Remove directional relationship)
- **Self-Follow:** Forbidden. Database constraint `CHECK (follower_id != following_id)` returns HTTP 400 Bad Request.
- **Idempotency:** Re-following an already followed user succeeds with HTTP 204 No Content via `ON CONFLICT DO NOTHING`.
- **Rate Limiting:** 30 follow/unfollow mutations per minute per authenticated session.

---

## 6. Non-Functional Requirements

- **Performance Target:** User search query response time targeted at sub-50ms under synthetic load of up to 50,000 users. Performance must be empirically verified via `EXPLAIN ANALYZE` benchmarks, not assumed.
- **Security & Privacy:**
  - Zero leakage of personal email addresses in public profiles, search endpoints, or directory lists.
  - Authenticated-only access to discovery endpoints.
- **Accessibility:** Search inputs, profile edit modals, and result lists must conform to WCAG 2.1 AA standards, supporting full keyboard navigation (Arrow keys, Enter, Escape) and pointer outside-click dismissal.
- **Styling Integrity:** Strictly dark-first OLED palette adhering to Holoraa F1 tokens (`var(--ink-950)`, `var(--bg-oled-surface)`, `var(--accent)`, `var(--line)`). Zero inline `style="..."` attributes.

---

## 7. Acceptance Criteria

1. A newly authenticated user with `username: null` is guided directly to setup their username and display name.
2. Attempting to claim an already taken username immediately surfaces an inline 409 Conflict error without wiping form state.
3. Claiming an available username succeeds, updates session state, sets `profileComplete: true`, and grants full workspace access.
4. Searching with 1–2 characters performs fast prefix matching; 3+ characters enables trigram similarity matching.
5. Empty queries or whitespace-only inputs return an empty array without executing database queries.
6. Special characters (`%`, `_`) in search queries are escaped and treated as literal characters.
7. Discovered user profiles and public profile cards completely omit the `email` field.
8. Clicking outside the search dropdown or profile modal, or pressing Escape, cleanly closes the view.
9. Attempting to self-follow returns HTTP 400 Bad Request.
10. Automated test suite passes 100% across Go unit/database tests (`make check`) and Vitest suites (`npm test`).