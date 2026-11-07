# Low-Level Design (LLD) — Milestone 2: Authentication Foundation

- **Project:** Holoraa
- **Milestone:** Milestone 2 — Authentication Foundation
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Review
- **Source of Truth:** `contracts/openapi.yaml` & `backend/db/migrations/00002_auth_profiles.sql`

---

## 1. Database Schema Specifications

```sql
-- Profiles (users)
CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username     text UNIQUE CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,31}$'),
    display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 64),
    bio          text CHECK (bio IS NULL OR char_length(bio) <= 300),
    avatar_url   text CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Email Identities (email_identities)
CREATE TABLE email_identities (
    email       text PRIMARY KEY CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_identities_user_id_idx ON email_identities (user_id);

-- One-Time Code Challenges (email_otp_challenges)
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

-- Server-Side Sessions (sessions)
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

-- Audit & Rate-Limiting Events (auth_events)
CREATE TABLE auth_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('otp_sent', 'verify_failed')),
    ip_hash    bytea NOT NULL CHECK (octet_length(ip_hash) = 32),
    email_hash bytea CHECK (email_hash IS NULL OR octet_length(email_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_kind_ip_created_idx ON auth_events (kind, ip_hash, created_at);
CREATE INDEX auth_events_kind_email_created_idx ON auth_events (kind, email_hash, created_at);
```

---

## 2. API Contracts & Endpoint Specifications

### A. Send One-Time Code
- **Method & Route:** `POST /v1/auth/otp`
- **Headers:** `Origin: <allowed_origin>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Success Response (202 Accepted):**
  ```json
  {
    "challengeId": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
  }
  ```
- **Error Responses (RFC 9457):**
  - `400 Bad Request`: Malformed email syntax.
  - `403 Forbidden`: Missing or invalid `Origin`.
  - `429 Too Many Requests`: Exceeded 5 sends/hr (email) or 20 sends/hr (IP) or 60s cooldown. Returns `Retry-After: <seconds>`.
  - `503 Service Unavailable`: Email delivery provider failure.

### B. Verify One-Time Code
- **Method & Route:** `POST /v1/auth/otp/verify`
- **Headers:** `Origin: <allowed_origin>`, `Content-Type: application/json`, optional existing `Cookie`
- **Request Body:**
  ```json
  {
    "challengeId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "code": "849201"
  }
  ```
- **Success Response (200 OK):**
  - **Set-Cookie Header:**
    `__Host-holoraa_session=<base64url_token>; Path=/; HttpOnly; Secure; SameSite=Lax` (production)
    `holoraa_session=<base64url_token>; Path=/; HttpOnly; SameSite=Lax` (development)
  - **Body:**
    ```json
    {
      "user": {
        "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "email": "user@example.com",
        "username": "arjun",
        "displayName": "Arjun Mehta",
        "bio": "Building calm tools",
        "avatarUrl": "https://images.unsplash.com/...",
        "profileComplete": true,
        "createdAt": "2026-11-04T12:00:00Z",
        "updatedAt": "2026-11-04T12:00:00Z"
      }
    }
    ```
- **Error Responses (RFC 9457):**
  - `401 Unauthorized`: `"The code is invalid or has expired."` (constant-time, unified message).
  - `429 Too Many Requests`: Exceeded 30 failures/15min on client IP.

### C. Current Session
- **Method & Route:** `GET /v1/auth/session`
- **Headers:** `Cookie: <session_cookie>`
- **Success Response (200 OK):**
  ```json
  {
    "user": { ... },
    "csrfToken": "a8f5b4c..."
  }
  ```
- **Error Response (401 Unauthorized):**
  - Missing, expired, or revoked session. Clears cookie if invalid.

### D. Logout Specifications Under Failure Modes
- **Method & Route:** `POST /v1/auth/logout`
- **Headers:** `Origin: <allowed_origin>`, `Cookie: <session_cookie>`, `X-CSRF-Token: <csrf_token>`
- **Success Response (204 No Content):**
  - Returns `Set-Cookie: __Host-holoraa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`.
- **Failure Semantics:**
  1. *Go Backend Down / Unreachable:*
     Next.js catches the network error, triggers `clearSessionCookies()`, and responds with `Set-Cookie: Max-Age=0`. The browser cookie is expired locally. (Server-side revocation in DB is not recorded).
  2. *Next.js Server Down:*
     Browser request fails to connect. No response received. Cookie remains active on the client.
  3. *Client Device Offline:*
     Browser cannot connect to network. `HttpOnly` cookie cannot be touched by client JS. Cookie remains active in browser jar until connectivity returns and logout is re-sent.

### E. Future WebSocket Ticket Exchange Contract (Milestone 4 Preview)
- **Method & Route:** `POST /v1/auth/ws-ticket`
- **Headers:** `Cookie: <session_cookie>`, `Origin: <allowed_origin>`, `X-CSRF-Token: <csrf_token>`
- **Success Response (200 OK):**
  ```json
  {
    "ticket": "wst_7c9e6679_4a8b1c2d3e4f...",
    "expiresIn": 30
  }
  ```
  - Ticket is single-use and valid for 30 seconds. Client appends `?ticket=...` on `wss://holoraa-api.onrender.com/v1/ws`.

---

## 3. Frontend BFF Implementation: Server Actions vs Rewrites

### A. Server Actions Flow (Active Implementation)
1. `/sign-in` renders `<SignInForm />` as a Client Component.
2. Form dispatch triggers `sendCodeAction` or `verifyCodeAction` in `web/src/app/sign-in/actions.ts`.
3. Actions execute on Next.js server, call `requestContext()` to resolve `HOLORAA_API_URL` and `Origin`.
4. API call executes server-to-server.
5. On verify, `applyCookies()` parses `Set-Cookie` and sets host-only cookie on the Next.js domain.

### B. Rewrite Proxy Comparison (Not Used for Auth)
- A rewrite proxy routes raw HTTP paths (e.g., `web/next.config.ts` -> `rewrites: [{ source: '/v1/:path*', destination: 'http://api:8080/v1/:path*' }]`).
- *Why Server Actions are preferred for Auth:* Server Actions provide type safety, server-side environment isolation, centralized cookie mapping via `next/headers`, and avoid exposing backend endpoints to browser inspection.

---

## 4. Input Validation & Error Handling Rules

1. **Email Address Normalization & Validation:**
   - Client rule: `validateEmail(raw)` in `lib/auth/validation.ts` checks length (3–254) and regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
   - Backend rule: `auth.NormalizeEmail(raw)` trims whitespace, lowercases the entire string, validates ASCII printable local part and valid domain label.
2. **One-Time Code Validation:**
   - Client rule: `validateCode(raw)` requires exactly 6 ASCII digits `^[0-9]{6}$`.
   - Backend rule: String length check ($6$ characters) and digits check before database lookup.
3. **Problem Details Format:**
   ```json
   {
     "type": "about:blank",
     "title": "Unauthorized",
     "status": 401,
     "detail": "The code is invalid or has expired.",
     "instance": "/v1/auth/otp/verify"
   }
   ```
   Internal error causes (e.g. database deadlocks, connection resets) are logged via `slog` with request IDs; the client strictly receives `"An internal error occurred."` with status 500.

---

## 5. Resend Boundary & Transaction Safety Analysis

### Problem Formulation: Dual-Write Hazard
When an email is dispatched while an open PostgreSQL transaction exists:
$$\text{Tx Begin} \longrightarrow \text{Insert Challenge} \longrightarrow \text{HTTP Mail Send} \longrightarrow \text{Tx Commit}$$
- **State A (Network Timeout):** Mail is sent by Resend, but HTTP client times out or connection drops before `Tx Commit`. The user receives a valid email, but PostgreSQL has zero record of the challenge.
- **State B (Pool Starvation):** 10 concurrent requests waiting for Resend hold 10 PostgreSQL connections open for up to 10 seconds each, exhausting `pgxpool`.

### Proposed Safe Design for Review:
1. **Commit Challenge First:** Execute challenge insertion and rate limit insertion inside an immediate, sub-millisecond transaction and `COMMIT`.
2. **Send Out of Transaction:** Call Resend API with a 5-second timeout.
3. **Compensating Action on Delivery Failure:** If Resend returns an error, execute `DELETE FROM email_otp_challenges WHERE id = $1` and return 503.
4. *Result:* Database connection held for $< 2\,\text{ms}$; zero pool starvation risk; explicit compensation on mailer failure.
