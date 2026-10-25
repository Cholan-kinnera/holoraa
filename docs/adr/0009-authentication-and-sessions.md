# ADR 0009: Authentication and server-managed sessions

- **Status:** Proposed. The owner gave the direction on 2026-10-25 and asked for the decisions below to be implemented. Only the owner sets the status; set it to Accepted after review.
- **Date:** 2026-10-25
- **Deciders:** Owner (solo maintainer)
- **Consulted:** None beyond the owner.
- **Resolves:** DEC-007 (authentication strategy), which was open in the legacy decision register. The legacy file is not adopted into v2 (see AGENTS.md).

---

## Context and Problem Statement

Holoraa needs user accounts before any private data can be stored. AGENTS.md requires an owner-approved design first. The owner's direction is email one-time codes first, then Google sign-in, with server-side sessions and no managed identity provider.

## Decision Drivers

- Users must be able to sign in without a password.
- Sessions must be revocable, and a database leak must not yield usable session tokens.
- The design must not reveal which email addresses have accounts.
- Abuse (code spam and guessing) must be limited per account and per client.
- The stack stays small: Go, PostgreSQL, and no Redis (ADR 0006 is deferred).

## Considered Options

1. **Managed identity provider** (Auth0, Clerk, Supabase Auth). Fast to start, but it adds a third party to the trust boundary and to every login path, and the owner has not chosen a vendor.
2. **Stateless JWT access tokens.** Hard to revoke, and the signing key becomes a high-value secret.
3. **Server-managed sessions in PostgreSQL with an opaque random token.** Revocable, simple to audit, and needs no new infrastructure. *(Selected.)*

## Decision Outcome

Chosen option: **3, server-managed sessions**, with these rules.

### Email one-time codes

- Six digits, generated with `crypto/rand` (uniform, no modulo bias).
- Lifetime 10 minutes. Single use. Five wrong attempts lock the challenge.
- Only an HMAC of the code, keyed by `HOLORAA_AUTH_SECRET` and bound to the challenge ID, is stored. The plain code is never stored or logged.
- Resend cooldown 60 seconds per email. At most five sends per email per rolling hour.
- IP-level limit: at most 20 sends per client IP per rolling hour, and at most 30 failed verifications per client IP per rolling 15 minutes. **These two IP numbers are proposed defaults for owner review. They are not yet approved.**
- The send response is the same for existing and unknown accounts, so it reveals nothing about account existence. Rate-limit responses (429) depend only on the email string or the client IP, never on whether an account exists.

### Sessions

- The token is 32 random bytes, encoded in base64url. Only its SHA-256 hash is stored.
- Idle expiry 14 days, sliding (refreshed on use, written at most every five minutes). Absolute expiry 30 days from creation.
- A new session is issued on every successful sign-in, and any session presented with that request is revoked (rotation).
- Logout revokes the current session.

### Cookies

- Production: name `__Host-holoraa_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` attribute.
- Local development over plain HTTP: `HOLORAA_COOKIE_SECURE=false`, with the name `holoraa_session`. This is for local use only, and production must not set it.

### CSRF

- Every state-changing request must carry an allowed `Origin` header (from `HOLORAA_ALLOWED_ORIGINS`).
- Requests authenticated by a session must also send `X-CSRF-Token`. The token is an HMAC of the session ID, keyed by `HOLORAA_AUTH_SECRET`, and is returned by `GET /v1/auth/session`.

### Client address

- The server uses the connection's remote address. It does not trust `X-Forwarded-For`. A reverse proxy in production needs a trusted-proxy setting, which is an open item below.
- Stored addresses are HMACs, not raw IPs.

### Google sign-in (later slice)

- OAuth 2.0 / OIDC with ID-token verification, `state` and `nonce`.
- Never link an account on an unverified email. Linking is a deliberate, authenticated action.

## Consequences

- Positive: revocation is immediate, no new infrastructure, and no third party sees credentials.
- Negative: every authenticated request reads the session row. Each sign-in writes rows. Retention needs a purge job.
- Risk: the auth secret is a single point of compromise. Rotating it invalidates every outstanding code and CSRF token, and sessions remain valid because they are stored as hashes. The rotation procedure belongs in the runbook.

## Open items (owner decisions)

- Approve or amend the proposed IP limits (20 sends per hour, 30 failed verifications per 15 minutes).
- Trusted-proxy setting and the production reverse-proxy topology.
- Retention periods for expired challenges and sessions (proposed: challenges one day after expiry, sessions 30 days after expiry).
- Resend sender domain and the production `from` address.
- Google OAuth client registration (slice 3).

## Links

- [docs/architecture/AUTH_AND_PROFILES.md](../architecture/AUTH_AND_PROFILES.md): the low-level design for this decision.
- [AGENTS.md](../../AGENTS.md): "Security and privacy" and "Scope boundaries".
