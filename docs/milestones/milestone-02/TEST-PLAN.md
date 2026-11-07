# Test Plan & Verification Strategy — Milestone 2: Authentication Foundation

- **Project:** Holoraa
- **Milestone:** Milestone 2 — Authentication Foundation
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Review

---

## 1. Unit Test Strategy

### Frontend Unit Tests (Vitest)
Located in `web/src/lib/auth/`:
- **`validation.test.ts`:**
  - Validates email formats: standard addresses, uppercase folding, subdomains, whitespace trimming.
  - Rejects malformed emails: missing `@`, spaces in local part, missing TLD, length $> 254$.
  - Validates 6-digit codes: exactly 6 digits pass; strings with letters, special characters, $< 6$ or $> 6$ digits fail.
  - Profile validation: username regex, reserved handles (`admin`, `api`, `holoraa`, `root`), display name constraints.
- **`cookies.test.ts`:**
  - Evaluates `Set-Cookie` header parsing: extracts token, `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, and `MaxAge`.
  - Verifies cookie name matching for both production (`__Host-holoraa_session`) and local dev (`holoraa_session`).
- **`flows.test.ts`:**
  - Tests `sendCode()`, `verifyCode()`, `loadSession()`, and `signOut()` against mock API client adapters.
  - Verifies RFC 9457 error message translation to user-facing copy without internal leaks.

### Backend Unit Tests (Go)
Located in `backend/internal/auth/` and `backend/internal/mail/`:
- **`codes.go` & `auth_test.go`:**
  - Tests 6-digit code generation uniformity and unbiased distribution.
  - Tests HMAC derivation and constant-time matching.
  - Tests email normalization.
- **`mail_test.go`:**
  - Tests fake provider outbox file creation with permissions `0700` (dir) and `0600` (file).
  - Tests Resend HTTP serialization and header formatting against a mock HTTP test server.

---

## 2. Integration & Database-Backed Test Strategy

Run via `make test-db` against active PostgreSQL:
- **Challenge Lifecycle:**
  - Send code -> Challenge inserted in `email_otp_challenges`.
  - Verify with valid code -> Consumed timestamp set, session created.
  - Verify with invalid code -> `attempts` incremented by 1.
  - 5 invalid attempts -> Challenge locked.
  - Re-use of consumed code -> Fails closed with generic 401.
  - Expiry test -> Challenge older than 10 minutes rejected.
- **Session Lifecycle:**
  - Verify session row created with SHA-256 token hash (raw token absent).
  - Verify sliding idle expiry (14 days) and absolute hard ceiling (30 days).
  - Verify session rotation on new sign-in (prior session revoked).
  - Verify immediate revocation on logout (`revoked_at` populated).
- **Rate Limiting Checks:**
  - Attempting $> 5$ sends per rolling hour to one email -> Returns 429.
  - Attempting $> 20$ sends per rolling hour from one IP -> Returns 429.
  - Attempting $> 30$ failed verifications from one IP -> Returns 429.
  - 60-second cooldown enforcement per email.

---

## 3. API Contract Conformance Tests

Located in `backend/internal/httpapi/contract_auth_test.go`:
- Compares live HTTP API responses against OpenAPI 3.1.1 specification in `contracts/openapi.yaml`.
- Validates schema conformance for:
  - `POST /v1/auth/otp` (202 Accepted schema).
  - `POST /v1/auth/otp/verify` (200 OK schema, Set-Cookie format).
  - `GET /v1/auth/session` (200 OK schema, CSRF token).
  - `POST /v1/auth/logout` (204 No Content).
  - Error responses (RFC 9457 Problem Details schema).

---

## 4. Comprehensive Security Tests & Audit Matrix

| Test Case ID | Target Area | Test Scenario & Procedure | Expected Outcome |
|---|---|---|---|
| **SEC-M2-01** | Secrets in Storage | Query database directly after generating OTP and logging in. | `email_otp_challenges.code_mac` is HMAC binary; `sessions.token_hash` is SHA-256 binary; no plaintext code or session token exists in DB. |
| **SEC-M2-02** | Account Enumeration | Submit `POST /v1/auth/otp` for both registered and unallocated email addresses. | Both return HTTP 202 Accepted with a valid UUID `challengeId` and identical response latency characteristics. |
| **SEC-M2-03** | Origin Enforcement | Submit `POST /v1/auth/otp` with missing or foreign `Origin: http://evil.com`. | Returns HTTP 403 Forbidden Problem Details ("The request origin is not allowed."). |
| **SEC-M2-04** | CSRF Validation | Submit `POST /v1/auth/logout` with mismatched `X-CSRF-Token`. | Returns HTTP 403 Forbidden Problem Details ("The CSRF token is missing or invalid."). |
| **SEC-M2-05A** | Backend Downtime Logout | Next.js Server Action attempts logout while Go API backend is down/unreachable. | Next.js returns `Set-Cookie: __Host-holoraa_session=; Path=/; Max-Age=0` to browser. Browser expires cookie locally. Server-side revocation in DB is logged as unrecorded. |
| **SEC-M2-05B** | Frontend Downtime Logout | User clicks logout while Next.js server is unreachable (502/504 gateway timeout). | Browser network request fails. No cookie-clearing header received. Browser cookie remains set. UI shows network connection error. |
| **SEC-M2-05C** | Client Offline Logout | User device is offline (no network) and clicks logout. | Client-side JavaScript cannot clear `HttpOnly` cookies (`document.cookie` cannot touch them). Cookie remains in browser secure jar until connectivity returns. |
| **SEC-M2-06** | CSRF Timing Resistance | Submit `POST /v1/auth/logout` with incorrect CSRF token of valid length. | Rejection occurs via `crypto/subtle.ConstantTimeCompare` in uniform time; returns `403 Forbidden`. |
| **SEC-M2-07** | Dual-Write / Commit Failure | Simulate database failure occurring immediately after mail dispatch. | Evaluates dual-write hazard: if DB transaction fails, orphaned challenges are prevented or cleaned up. |
| **SEC-M2-08** | Concurrent OTP Dispatch | Submit two simultaneous `POST /v1/auth/otp` requests for the same email. | PostgreSQL advisory locks serialize execution: first request succeeds (202); second triggers 60s cooldown (429). |
| **SEC-M2-09** | Multi-Device Isolation | Authenticate on Device A (Session A). Authenticate on Device B (Session B). Make authenticated request with Session A. | Session A remains completely valid. Logging into Device B rotates only the presented token on Device B; does not terminate Session A. |
| **SEC-M2-10** | Concurrent OTP Verification | Submit two identical `POST /v1/auth/otp/verify` requests simultaneously for one challenge. | `SELECT ... FOR UPDATE` row lock serializes check: exactly one request consumes challenge and issues session (200); second request receives 401. |

---

## 5. Accessibility & Responsive Verification

- **Accessibility Checklist:**
  - Keyboard focus order flows logically through email -> submit -> code input -> verify -> resend.
  - Active visible `:focus-visible` focus ring on all inputs and buttons.
  - Inputs marked with appropriate `inputMode="email"` and `inputMode="numeric"`.
  - Monospace code input carries `autoComplete="one-time-code"`.
  - Error alerts have `role="alert"` and are announced to screen readers.
- **Viewport Responsiveness:**
  - Desktop ($1440\times900\,\text{px}$): Centered floating glass card with balanced typography.
  - Tablet ($768\times1024\,\text{px}$): Clean vertical flow with touch-friendly 44px tap targets.
  - Mobile ($375\times812\,\text{px}$): Full-width responsive card with zero horizontal overflow.
