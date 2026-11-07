# High-Level Design (HLD) — Milestone 2: Authentication Foundation

- **Project:** Holoraa
- **Milestone:** Milestone 2 — Authentication Foundation
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Review
- **Governing Decision:** [ADR 0009: Authentication and server-managed sessions](../../adr/0009-authentication-and-sessions.md)

---

## 1. Architecture Overview & BFF Topology

Holoraa enforces a **Backend-For-Frontend (BFF) architecture** utilizing Next.js App Router as the secure client gateway and Go modular monolith as the core authority.

### A. Network & Topology Model
1. **Browser-to-Next.js (Public Edge):**
   - The browser communicates **exclusively** with the Next.js origin (`http://localhost:3000` in dev; `https://holoraa.vercel.app` in prototype; `https://holoraa.com` on custom domain).
   - The browser never initiates direct cross-origin HTTP fetch calls to the Go backend (`holoraa-api.onrender.com`).
   - All authentication state transitions use **Next.js Server Actions** (`sendCodeAction`, `verifyCodeAction`, `signOutAction`) over same-origin POST.
2. **Next.js-to-Go (Server-to-Server Private Interconnect):**
   - Server Actions and Server Components execute in Node.js on the Next.js server.
   - Next.js calls the Go API server-to-server via HTTP/HTTPS using the internal API client (`web/src/lib/api/client.ts`), pointing to `HOLORAA_API_URL`.
   - Next.js forwards the browser's incoming `Cookie` header and client `Origin` header (`web/src/lib/auth/server.ts`).
3. **Cookie Creation, Scope & Forwarding:**
   - On successful OTP verification, the Go API emits `Set-Cookie: __Host-holoraa_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/`.
   - The Next.js Server Action captures this header from the Go response via `parseSetCookie()` and applies it to the Next.js cookie store via `(await cookies()).set()`.
   - The browser receives the `Set-Cookie` header for the **Next.js domain**. The cookie is host-only (`__Host-` prefix enforces `Secure`, `Path=/`, and zero domain attribute).
   - On subsequent browser requests to Next.js (`/app`, Server Actions), the browser sends the cookie to Next.js. Next.js extracts it via `(await cookies()).getAll()` and injects it into the server-to-server request `Cookie` header forwarded to Go.
   - Go computes `SHA-256(token)` and validates it against `sessions.token_hash` in PostgreSQL.

### B. Distinction: Server Actions vs Rewrite Proxies
- **Server Actions (Current Implementation):** Server Actions are typed RPC functions executing on the Next.js server. Next.js explicitly parses form payloads, applies client validation, invokes Go REST endpoints server-to-server, maps Set-Cookie headers, and redirects.
- **Rewrite Proxies (Alternative / Extension):** Next.js `rewrites()` in `next.config.ts` configure reverse-proxy routing where the browser makes direct REST calls (e.g., `fetch('/v1/thoughts')`) that Next.js streams directly to the Go API without application-level mapping. Rewrite proxies are NOT used for authentication in Milestone 2; they remain an optional architectural path for future high-volume client fetch calls.

### C. Future WebSocket Ticket Authentication (Milestone 4 Preview)
Because the session cookie is scoped host-only to Next.js (`holoraa.vercel.app`) and the Go WebSocket server will listen on Render (`holoraa-api.onrender.com`), the browser cannot attach the cookie during cross-site WebSocket handshakes.
- **The Solution:** A ticket-based handshake pattern:
  1. Browser invokes a Next.js Server Action (`getWebSocketTicket`).
  2. Next.js authenticates the session server-to-server and asks Go for a single-use ticket.
  3. Go generates a cryptographically random ticket (32 bytes, TTL 30s) and stores its HMAC digest in memory/DB.
  4. Client connects to `wss://holoraa-api.onrender.com/v1/ws?ticket=<ticket>`.
  5. Go validates and consumes the ticket during the HTTP-to-WebSocket upgrade, binding the socket to the user ID.

```mermaid
graph TD
    subgraph Browser ["Client Environment (Desktop / Mobile Browser)"]
        UserAgent["Browser User Agent"]
    end

    subgraph FrontendTier ["Frontend Tier (Next.js 16 / Vercel or Render)"]
        ProxyMiddleware["Proxy Middleware (Nonce-based CSP)"]
        SignInPage["/sign-in Page & SignInForm"]
        ServerActions["Server Actions (sendCodeAction / verifyCodeAction)"]
        AppLayoutGate["/app/layout.tsx (Session Gate)"]
        CookieStore["Next.js Cookie Store (__Host-holoraa_session)"]
    end

    subgraph BackendTier ["Backend Tier (Go Modular Monolith / Render)"]
        ChiRouter["Chi Router (/v1)"]
        OriginMiddleware["Origin Check Middleware"]
        SessionMiddleware["Require Session Middleware"]
        CSRFMiddleware["Require CSRF Middleware"]
        AuthService["internal/auth.Service"]
        MailService["internal/mail.Sender (Resend / Fake)"]
    end

    subgraph DataTier ["Data Tier (PostgreSQL 17 / Neon)"]
        UsersTable[("users")]
        EmailIdentitiesTable[("email_identities")]
        ChallengesTable[("email_otp_challenges")]
        SessionsTable[("sessions")]
        AuthEventsTable[("auth_events")]
    end

    UserAgent -->|Same-Origin HTTPS Request| ProxyMiddleware
    ProxyMiddleware --> SignInPage
    SignInPage -->|Form Submission| ServerActions
    ServerActions -->|Sets Cookie on Next.js Host| CookieStore
    ServerActions -->|Server-to-Server HTTPS + Forwarded Cookie| ChiRouter
    AppLayoutGate -->|Internal getSession()| ChiRouter

    ChiRouter --> OriginMiddleware
    OriginMiddleware --> SessionMiddleware
    SessionMiddleware --> CSRFMiddleware
    CSRFMiddleware --> AuthService

    AuthService --> ChallengesTable
    AuthService --> SessionsTable
    AuthService --> UsersTable
    AuthService --> EmailIdentitiesTable
    AuthService --> AuthEventsTable
    AuthService --> MailService
```

---

## 2. Component Responsibilities

| Component | Layer | Primary Responsibility | Failure Mode |
|---|---|---|---|
| **Next.js Proxy (`proxy.ts`)** | Frontend (Edge) | Generates CSP nonce, injects `Content-Security-Policy` and `x-nonce` headers. | Fails closed: invalid requests receive 500 without rendering. |
| **App Layout Gate (`app/layout.tsx`)** | Frontend (Server) | Queries `getSession()`. Redirects unauthenticated traffic to `/sign-in`. | Fails closed: renders `<Unavailable />` on API error; redirects on expired/signed-out. |
| **Auth Server Actions (`actions.ts`)** | Frontend (Server) | Orchestrates form submission to Go API. Transfers Set-Cookie headers to browser store. | Catches network errors; returns generic friendly feedback without leaking internal details. |
| **Origin Middleware (`originCheck`)** | Backend (HTTP) | Inspects `Origin` header on state-changing requests against `HOLORAA_ALLOWED_ORIGINS`. | Returns HTTP 403 Problem Details immediately. |
| **Session Middleware (`requireSession`)** | Backend (HTTP) | Reads cookie, hashes token via SHA-256, queries `sessions` table. Injects session into context. | Returns HTTP 401 Problem Details ("Sign in to continue."). Clears cookie if expired. |
| **CSRF Middleware (`requireCSRF`)** | Backend (HTTP) | Compares `X-CSRF-Token` header against `HMAC(secret, session_id)` in constant time. | Returns HTTP 403 Problem Details ("The CSRF token is missing or invalid."). |
| **Auth Service (`internal/auth`)** | Backend (Domain) | Generates OTPs, enforces limits, resolves identities, rotates and revokes sessions. | Transaction rollback on failure; logs error server-side without leaking to client. |
| **Mail Sender (`internal/mail`)** | Backend (Integration) | Dispatches plain-text email with 6-digit code via Resend or writes to local filesystem. | Returns `ErrSendFailed`; API returns HTTP 503 Problem Details; challenge not recorded. |

---

## 3. System Interactions & Resend Transaction Boundary Analysis

### A. Resend Delivery & Transaction Boundary Evaluation
In the baseline implementation (`backend/internal/auth/auth.go`), `mail.Send()` executes while the PostgreSQL transaction `tx` is held open:

```go
tx, err := s.pool.Begin(ctx)
// ... insert challenge ...
if err := s.mail.Send(ctx, msg); err != nil { // External HTTP call inside DB transaction!
    return "", ErrSendFailed
}
// ... record event ...
tx.Commit(ctx)
```

#### Evaluation of Risks:
1. **Connection Pool Starvation:** An external HTTP call to Resend has a 10s timeout. If Resend experiences latency, connection pool slots are occupied by waiting transactions, blocking health checks and session validations across the application.
2. **Dual-Write Hazard (Asymmetric Failure):** If `s.mail.Send(ctx, msg)` succeeds (Resend delivers the email), but the subsequent `tx.Commit(ctx)` fails (e.g., PostgreSQL deadlock, connection drop, server termination), the user receives a 6-digit code in their inbox, but the challenge row in PostgreSQL is rolled back! When the user submits the code, the API rejects it as invalid.
3. **Transactional Outbox Analysis:**
   - *Full Outbox Pattern:* Requires an `email_outbox` table, asynchronous polling worker/channel, status states (`pending`, `sent`, `failed`), and retry backoff. While ideal for enterprise production, introducing this now adds background workers and table schemas outside Milestone 2 scope.
   - *Recommended Prototype Design (Proposed for Owner Review):*
     **Commit First, Send Next, Cleanup on Failure:**
     1. Insert challenge and rate limit audit in PostgreSQL and execute `tx.Commit(ctx)`.
     2. Dispatch email to Resend outside the transaction with a tight 5-second timeout.
     3. If email dispatch fails, execute an immediate cleanup query (`DELETE FROM email_otp_challenges WHERE id = $1`) and return 503.
     4. This completely eliminates holding database connections during external network calls while preventing orphaned challenges on delivery failure.

### B. Code Verification & Multi-Device Session Isolation
1. Browser submits `challengeId` and `code` via Server Action to `POST /v1/auth/otp/verify`.
2. Go API begins a transaction and executes:
   ```sql
   SELECT email, code_mac, attempts, expires_at <= now(), consumed_at IS NOT NULL
     FROM email_otp_challenges WHERE id = $1 FOR UPDATE
   ```
   *Pessimistic row locking (`FOR UPDATE`) guarantees that concurrent verification requests for the same challenge are strictly serialized. Only one request can consume the code.*
3. On valid HMAC verification:
   - Challenge is marked consumed (`consumed_at = now()`).
   - User identity resolved in `users` and `email_identities`.
   - **Multi-Device Isolation:** Session rotation executes:
     ```sql
     UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL
     ```
     *Only the presented session token on the current browser is rotated. Existing active sessions on other devices (e.g., user's mobile phone) remain completely valid.*
   - A fresh 32-byte opaque session token is generated; `SHA-256(token)` is inserted into `sessions` with sliding idle (14d) and absolute (30d) limits.
   - Go returns `Set-Cookie` with the new token.

---

## 4. Security Architecture & Offline Logout Scenarios

### A. Triaged Offline & Downtime Logout Behaviors
Because JavaScript running in the browser **cannot read, modify, or delete an `HttpOnly` cookie**, the cookie can only be expired when the browser receives an HTTP response containing `Set-Cookie: ...; Max-Age=0`.

We define the exact behavior across three distinct failure scenarios:

1. **Scenario 1: Go Backend Unavailable, Next.js Available:**
   - User clicks Sign Out.
   - Next.js Server Action attempts `POST /v1/auth/logout` to the Go backend.
   - Go backend is unreachable or returns 503.
   - Next.js catches the network failure, invokes `clearSessionCookies()`, and returns an HTTP response to the browser with:
     `Set-Cookie: __Host-holoraa_session=; Path=/; Max-Age=0`
   - **Result:** The browser successfully deletes the cookie locally and redirects to `/sign-in`.
   - **Security Nuance:** Server-side session revocation in PostgreSQL was *not completed*. The session record in PostgreSQL remains valid until its idle (14d) or absolute (30d) expiration passes. If the raw session token had previously been exfiltrated by an attacker, it remains valid on the backend until expired or until the database is back up and the user logs out again.
2. **Scenario 2: Next.js Unavailable (Frontend Down / Gateway Timeout 502/504):**
   - User clicks Sign Out.
   - The browser's POST request to Next.js fails at the network/proxy layer.
   - No HTTP response with `Set-Cookie: Max-Age=0` reaches the browser.
   - **Result:** The browser cookie remains intact. The UI displays an error notice. The user cannot log out until frontend network connectivity is restored.
3. **Scenario 3: User Device Completely Offline:**
   - The user's device has no internet connection (airplane mode / network lost).
   - Client-side JavaScript cannot clear `HttpOnly` cookies.
   - The browser cannot send a request to Next.js or receive a response.
   - **Result:** The cookie remains stored in the browser's secure cookie jar. Offline cookie expiration is fundamentally impossible for `HttpOnly` cookies.
   - **Mitigation:** The UI displays an offline indicator ("You are offline. Reconnect to log out."). When connectivity is restored, the next request will either complete the sign-out or fail if the session has naturally expired.

### B. Core Security Controls Summary
1. **Zero Plaintext Secrets:** OTPs stored as HMAC; session tokens stored as SHA-256 digests; rate-limit keys stored as HMACs.
2. **Zero Account Enumeration:** `POST /v1/auth/otp` returns identical `202 Accepted` responses for known and unknown accounts.
3. **Triple CSRF Protection:** `SameSite=Lax` cookies, `Origin` header validation against allowlist, and constant-time validated `X-CSRF-Token` header.
4. **Strict CSP:** Per-request cryptographic nonces on all pages; no inline styles (`style="..."`) allowed.

---

## 5. Technology Decisions & Architecture Decision Records (ADRs)

| Technology Choice | Rationale | Governing ADR |
|---|---|---|
| **Opaque PostgreSQL Sessions** | Immediate revocation, complete auditability, zero reliance on external auth providers or unrevocable JWTs. | [ADR 0009](../../adr/0009-authentication-and-sessions.md) |
| **Passwordless Email OTP** | Eliminates password management, credential stuffing, and plaintext database breach exposure. | [ADR 0009](../../adr/0009-authentication-and-sessions.md) |
| **Resend Email Delivery** | Reliable developer-first transactional email with HTTP API integration; decoupled by interface. | [ADR 0009](../../adr/0009-authentication-and-sessions.md) |
| **BFF Architecture via Server Actions** | Isolates backend URL, enforces host-only cookies, prevents cross-site tracking blocks. | ADR 0009 & Project Standard |
| **Strict Nonce-Only CSP** | Mitigates XSS by forbidding inline scripts and inline style attributes (`style="..."`). | Project Security Standard |
