# Milestone 3 — User Profiles & Discovery: Test Plan

- **Milestone:** M3 (Frontend & Backend Slice 2)
- **Status:** Draft / Updated for Architectural Alignment
- **Target Release:** v2.0-alpha
- **Owner:** Core QA & Security Lead

---

## 1. Test Strategy & Scope

Verification for Milestone 3 ensures user profiles, search, and social relationships operate with absolute data integrity, measured query performance, and strict privacy isolation. Every query, mutation, and route is tested against real PostgreSQL instances (no database mocks).

---

## 2. Test Execution Levels

### 2.1 Backend Unit & Validation Tests
- File: `backend/internal/profile/profile_test.go`
- Validations:
  - `ValidateUsername`: Length boundaries (2, 3, 32, 33 chars), character sets, reserved names (`admin`, `me`, `root`, etc.).
  - `ValidateDisplayName`: Empty rejection, 64-char ceiling, control character rejection.
  - `ValidateBio`: 300-char ceiling, multiline support, null/empty clearance.
  - `ValidateAvatarURL`: HTTPS scheme only, rejects `http:`, `javascript:`, `data:`, fragments, credentials, and URLs > 2048 chars.
  - `escapeLikeWildcards`: Escapes `%` to `\%`, `_` to `\_`, and `\` to `\\`.

### 2.2 Database Integration Tests
- File: `backend/internal/profile/profile_db_test.go`
- Test Cases:
  - `TestSearchUsersExcludesCallerAndIncomplete`: Asserts user cannot find themselves in search, and users with `username = NULL` are never returned.
  - `TestSearchPrefixBypassesTrigram`: Verifies 1-2 character queries execute via prefix matching.
  - `TestSearchTrigramMatchesDisplayNameAndHandle`: Verifies 3+ character queries match last names in display names and handles.
  - `TestSearchWildcardLiteralEscaping`: Searching for `%` or `_` searches for literal characters and does not match all rows.
  - `TestConcurrentUsernameClaimCollision`: Spawns 10 concurrent goroutines attempting to register the exact same username. Asserts exactly 1 succeeds and 9 receive `ErrUsernameTaken` (409 Conflict via `23505`).
  - `TestFollowAndUnfollow`: Verifies follow and unfollow transitions, follower/following counts, and caller perspective (`PublicWithRelationship`).
  - `TestFollowAndUnfollowIdempotency`: Multiple repeated follow and unfollow calls succeed with HTTP 204 without duplicate edges.
  - `TestFollowSelfRejected`: Validates domain validation and PostgreSQL `follows_check` (SQLSTATE `23514`) rejection.
  - `TestFollowNonexistentUser`: Following or unfollowing nonexistent or incomplete accounts returns `ErrNotFound` (HTTP 404).
  - `TestFollowCaseInsensitive`: Username matching is case-insensitive with whitespace trimming.
  - `TestConcurrentDuplicateFollows`: 10 concurrent distinct users and 10 concurrent duplicate calls from same user preserve consistent state without error.
  - `TestConcurrentFollowUnfollow`: Simultaneous follow/unfollow calls maintain strict database consistency without deadlocks.

### 2.3 HTTP API & Contract Conformance Tests
- File: `backend/internal/httpapi/profile_routes_test.go`, `backend/internal/httpapi/contract_auth_test.go`
- Tests:
  - `GET /v1/users?q=test`: Returns 200 OK with `users` array matching OpenAPI schema.
  - `GET /v1/users?q=`: Empty or whitespace queries return 200 OK and `[]` with 0 database queries executed.
  - `POST /v1/users/{username}/follow`: Requires valid CSRF header and Origin; returns 204 No Content. Idempotent on repeated calls.
  - `DELETE /v1/users/{username}/follow`: Requires valid CSRF header and Origin; returns 204 No Content. Idempotent on repeated calls.
  - Self-follow rejection: `POST /v1/users/{username}/follow` targeting own account returns 400 Bad Request Problem Details.
  - Nonexistent user rejection: `POST`/`DELETE` targeting nonexistent account returns 404 Not Found Problem Details.
  - Rate limiting: 30 mutations/min sliding window per authenticated session enforced with 429 Problem Details and `Retry-After` header.
  - GET /v1/users/{username}`: Returns public profile without `email` field.
  - Schema drift check: Confirms API responses strictly validate against `contracts/openapi.yaml`.

### 2.4 Performance Benchmark & Query Plan Tests
- File: `backend/internal/profile/profile_bench_test.go`
- Tests:
  - Seeds 10,000 synthetic user accounts.
  - Executes `EXPLAIN ANALYZE` on `SearchUsersTrigram`: Asserts plan uses `Bitmap Index Scan on users_username_trgm_idx` and `users_display_name_trgm_idx` without sequential table scans.
  - Measures latency distribution: P50 and P95 latency recorded. Verifies sub-50ms engineering target under benchmark conditions.

### 2.5 Frontend Vitest Suite
- Files: `web/src/components/workspace/SearchOverlay.test.tsx`, `web/src/components/workspace/UserProfileModal.test.tsx`
- Tests:
  - Search input debouncing: Verify request fires after 250ms of typing inactivity.
  - Outside click dismissal: Clicking outside `SearchOverlay` or `UserProfileModal` triggers `onClose`.
  - Keyboard accessibility: Pressing Escape dismisses modals; Arrow keys navigate search candidates.
  - Avatar fallback: Broken image triggers `onError` and renders display name initial cleanly.
  - CSP style compliance: Zero inline `style="..."` attributes present.

---

## 3. Security Verification Matrix

| ID | Security Gate | Test Assertion | Expected Result |
|---|---|---|---|
| **SEC-M3-01** | Email Privacy Isolation | Inspect JSON responses for `GET /v1/users` and `GET /v1/users/{username}` | `email` property is completely absent from all public responses. |
| **SEC-M3-02** | Search Abuse & Rate Limiting | Send 70 rapid search requests within 60 seconds from one session | Requests 1–60 succeed (200); requests 61+ return 429 Too Many Requests with `Retry-After`. |
| **SEC-M3-03** | Follow Mutation Rate Limiting | Send 40 follow/unfollow requests within 60 seconds | Requests 1–30 succeed (204); requests 31+ return 429 Too Many Requests. |
| **SEC-M3-04** | CSRF Protection on Follows | Submit `POST /v1/users/{username}/follow` without `X-CSRF-Token` | Returns 403 Forbidden. |
| **SEC-M3-05** | Unauthenticated Fail-Closed | Request `GET /v1/users` without a session cookie | Returns 401 Unauthorized Problem Details. |
| **SEC-M3-06** | Wildcard Injection Immunity | Search with `%`, `_`, or `\%` | Characters are escaped; treated as literal string; 0 unintended matches. |
| **SEC-M3-07** | SQL Injection Immunity | Search with `' OR '1'='1` and `"; DROP TABLE users; --` | Treated as literal text string; 0 matches, zero SQL errors. |
| **SEC-M3-08** | Self-Follow Rejection | Submit follow request targeting own username | Rejected with HTTP 400 Bad Request. |
| **SEC-M3-09** | Concurrency Collision Handling | Concurrent claim of same username | Database `23505` caught and translated to HTTP 409 Conflict. |
| **SEC-M3-10** | Avatar URL Protocol Injection | Submit `javascript:alert(1)` or `data:image/svg+xml,...` as `avatarUrl` | Rejected by validator with HTTP 400 Bad Request. |

---

## 4. Verification Gates for Completion

1. `cd web && npm run typecheck` — 0 errors.
2. `cd web && npm run lint` — 0 errors, 0 warnings.
3. `cd web && npm test` — 100% test pass rate across all test files.
4. `cd web && npm run build` — Clean production build with Turbopack.
5. `make check GO=/home/ck/toolchains/go1.27.3/go/bin/go` — `go vet`, `go test -race -count=1 ./...`, and binary build pass cleanly.
