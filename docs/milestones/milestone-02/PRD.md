# Product Requirements Document (PRD) — Milestone 2: Authentication Foundation

- **Project:** Holoraa
- **Milestone:** Milestone 2 (F1 Slice 2) — Authentication Foundation
- **Document Version:** 1.0.0
- **Status:** Proposed for Owner Review
- **Target Audience:** Engineering, Product, Security

---

## 1. Problem Statement

Before users can communicate privately, create spaces, or exchange messages on Holoraa, the platform requires an uncompromised, privacy-first authentication foundation. Traditional password systems suffer from password reuse attacks, credential stuffing, and plaintext database breaches. Conversely, delegating identity entirely to third-party identity providers introduces external tracking vectors, vendor lock-in, and unpredictable downtime.

Holoraa requires an authentication system that:
1. Provides zero-friction, passwordless registration and sign-in for users across desktop, tablet, and mobile browsers.
2. Guarantees absolute user privacy with no third-party tracking or behavioural data sharing.
3. Precludes account enumeration and brute-force guessing attacks.
4. Maintains immediate server-authoritative session revocation.

---

## 2. Objectives

- **Primary Goal:** Implement a reliable, production-ready passwordless email One-Time Password (OTP) authentication flow with server-side opaque sessions in PostgreSQL and strict route protection in Next.js.
- **Success Metrics:**
  - 100% of sign-in and session operations follow RFC 9457 Problem Details for errors.
  - Zero password or credential leakage; raw OTPs and raw session tokens are never stored in plaintext or logged.
  - Sub-millisecond local session validation overhead via PostgreSQL indexing.
  - Fail-closed route authorization: unauthenticated requests to `/app/*` never render private workspace content.
  - 100% pass rate across unit tests, contract conformance tests, and security regression suites.

---

## 3. User Stories

| ID | Persona | Story | Acceptance Criteria |
|---|---|---|---|
| **US-01** | New Visitor | As a new user, I want to enter my email to create an account so that I don't have to remember another complex password. | Entering a valid email sends a 6-digit code. Submitting the correct code automatically provisions an account and signs me in. |
| **US-02** | Returning User | As a returning user, I want to sign in using my email address so that I can resume my conversations securely. | Entering my registered email sends a 6-digit code. Submitting the code restores my session and redirects to `/app`. |
| **US-03** | Typo / Change Mind | As a user, if I mistype my email address, I want to easily return and correct it without getting stuck. | The code verification screen includes an explicit "Use a different email" action that discards the challenge and returns to the email input. |
| **US-04** | Security-Conscious User | As a security-conscious user, I want to sign out completely so that subsequent users on a shared machine cannot access my account. | Clicking sign out invokes `POST /v1/auth/logout`, revokes the session in PostgreSQL, clears the session cookie, and redirects to `/sign-in`. |
| **US-05** | First-Time Setup | As a newly registered user without a handle, I want to be prompted to set up my username before entering public rooms. | The application detects `profileComplete === false` and directs the user to profile setup before allowing general workspace actions. |

---

## 4. Functional Requirements

1. **Email OTP Challenge Dispatch (`POST /v1/auth/otp`):**
   - The user inputs an email address (max 254 characters).
   - The system validates email syntax and normalizes it to lowercase.
   - The API generates a uniform 6-digit numeric code via `crypto/rand` (cryptographically secure randomness, zero modulo bias).
   - Only `HMAC(secret, challenge_id + code)` is stored in PostgreSQL; the plaintext code is never stored in DB or logs.
   - The API responds with `202 Accepted` and `{ "challengeId": "<uuid>" }`.
   - The response and timing must be identical for registered and unregistered emails (zero account enumeration).

2. **Email OTP Verification (`POST /v1/auth/otp/verify`):**
   - The user inputs the 6-digit code for their active `challengeId`.
   - The system verifies the challenge is unexpired (10-minute TTL), unconsumed, and under the attempt threshold ($\le 5$ wrong attempts).
   - On correct verification:
     - The challenge is marked consumed.
     - The user and email identity are resolved or created in a single atomic transaction.
     - Any existing session presented with the request is revoked (session rotation).
     - A fresh 32-byte opaque session token is generated; its SHA-256 hash is stored in `sessions`.
     - The session cookie is set in the HTTP response (`HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`).
     - Returns `200 OK` with the `User` object.
   - On failure:
     - Increments attempt counter.
     - At 5 wrong attempts, locks the challenge permanently.
     - Returns `401 Unauthorized` with a generic RFC 9457 error message ("The code is invalid or has expired.").

3. **Session Verification (`GET /v1/auth/session`):**
   - Resolves the session cookie against `sessions.token_hash`.
   - Validates sliding idle expiry (14 days) and absolute expiry (30 days).
   - Throttles `last_seen_at` updates to once per 5 minutes to minimize database write load.
   - Derives and returns an HMAC-based `csrfToken` bound to the session ID.

4. **Sign Out (`POST /v1/auth/logout`):**
   - Requires valid session cookie, allowed `Origin`, and valid `X-CSRF-Token`.
   - Marks `sessions.revoked_at = now()`.
   - Sets the cookie with `MaxAge = 0` to delete it from the browser.
   - *Failure Modes:*
     - If the Go API is unavailable, Next.js Server Action expires the cookie in the HTTP response locally (`Set-Cookie: Max-Age=0`), logging that server-side DB revocation was not recorded.
     - If Next.js is down, the request fails and the cookie remains active.
     - If the device is completely offline, client-side JavaScript cannot clear `HttpOnly` cookies; the user is notified to reconnect to log out. Offline cookie deletion is recognized as impossible.

5. **Client UI & Form Interactions (`/sign-in`):**
   - Clean, dark-first F1 aesthetic matching OLED true pitch black (`#000000`).
   - Monospace 6-digit code input with `letter-spacing: 0.3em` and `pattern="[0-9]{6}"`.
   - Dynamic 60-second resend countdown timer.
   - One-click "Use a different email" reset action.
   - Clear loading and submitting states without layout shift.
   - RFC 9457 error alert presentations with `role="alert"`.

---

## 5. Non-Functional Requirements

- **Security & Privacy:**
  - No third-party analytics, tracking pixels, or external scripts.
  - Zero plaintext secrets in code, logs, terminal output, or database rows.
  - Strict Content Security Policy (CSP) with per-request cryptographic nonces generated by Next.js middleware. No inline style attributes (`style="..."`) allowed.
  - Constant-time HMAC and token comparison (`crypto/subtle` in Go) to prevent timing side-channel attacks.
- **Performance:**
  - OTP generation and database insertion under $15\,\text{ms}$.
  - Session verification query under $2\,\text{ms}$ on PostgreSQL.
- **Reliability & Availability:**
  - PostgreSQL transaction isolation (`SERIALIZABLE` or lock-ordered `READ COMMITTED`) to guarantee atomic concurrency under burst conditions.
  - Graceful degradation: If the backend is unreachable, the frontend displays an accessible `<Unavailable />` boundary rather than a raw crash.
- **Accessibility:**
  - WCAG 2.1 AA conformance.
  - Visible `:focus-visible` keyboard focus rings.
  - Explicit ARIA attributes: `aria-invalid`, `aria-describedby`, `role="status"`, `role="alert"`.

---

## 6. Scope Boundaries

| In Scope (Milestone 2) | Out of Scope (Deferred to Future Milestones) |
|---|---|
| Passwordless email OTP authentication | Password registration & credential storage (Milestone 2 dormant) |
| Server-side opaque sessions in PostgreSQL | Google OAuth / Social Login (Milestone 2 dormant) |
| Session rotation on sign-in | WebSockets & real-time presence (Milestone 4) |
| Session revocation & logout | Cloudflare R2 file uploads (Milestone 5) |
| Resend email adapter & local fake outbox | LiveKit audio/video calling (Milestone 6) |
| Next.js route protection (`/app/*` gate) | Push notifications (Milestone 7) |
| Rate limiting per email and per client IP | Paid subscriptions & Stripe billing (Milestone 8) |

---

## 7. Dependencies & Constraints

- **Backend:** Go 1.27.3, Chi router, `jackc/pgx/v5`.
- **Database:** PostgreSQL 17 (Neon in cloud, Docker Compose in local dev).
- **Email Delivery:** Resend API for production transactional email; filesystem-backed outbox (`.local/mail`) for development.
- **Frontend:** Next.js 16.4.3 (App Router), React 19, TypeScript, Turbopack.
- **Governance:** Full compliance with [`AGENTS.md`](file:///home/ck/Projects/holoraa/AGENTS.md) and [`ADR 0009`](file:///home/ck/Projects/holoraa/docs/adr/0009-authentication-and-sessions.md).
