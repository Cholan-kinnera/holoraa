# Security Threat Model — Holoraa (v2)

- **Purpose:** Threats to Holoraa, the mitigations planned for each, and the security standard the project targets.
- **Owner:** TODO(owner): Security Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** The M0 skeleton has no network surface. Every mitigation below is planned at the milestone or feature named, unless noted otherwise.

---

## 1. Target standard

Holoraa targets **OWASP ASVS Level 2** for an application that handles personal communications and user-generated media. `TODO(owner): confirm the target level and the date of the first ASVS review.`

## 2. Non-negotiable rules (from AGENTS.md)

- Authentication and authorisation are not implemented until the owner approves the design. Placeholder token checks are never presented as authentication.
- Protected routes and sockets fail closed.
- The WebSocket origin is checked against an allowlist before upgrade. Origin verification is never disabled.
- Every external input has a size limit and is validated at the boundary.
- HTTP errors use RFC 9457 Problem Details. Internal error detail is never returned to clients.
- Secrets come only from the environment. No secret, password, token, or real `.env` file is committed.
- Logs contain no personal data, tokens, cookies, or request bodies. Redact by default.

## 3. STRIDE analysis

| Threat | Component | Scenario | Planned mitigation | Milestone or dependency |
|---|---|---|---|---|
| Spoofing | API and sockets | A caller claims to be another user | Identity is taken only from a verified credential, never from the request body. | Auth design (blocked) |
| Tampering | Data in transit | A network attacker changes messages | HTTPS only. HSTS and other security headers set by middleware. | M2 (headers), deployment (TLS) |
| Repudiation | Moderation and reports | A user denies a harmful action | Append-only audit records for moderation actions. Timestamps set by the server. | Phase 4 |
| Information disclosure | Database and object storage | A user reads another conversation | Every query checks membership in SQL. Object links are short-lived signed URLs. | Phase 1 and Phase 3. Expiry (15 min in the legacy draft) is `TODO(owner)`. |
| Denial of service | API and sockets | A bot floods requests or frames | Rate limits per client and per socket. Frame size limits. | M2 (HTTP), M6 (sockets). Limits `TODO(owner)`. |
| Elevation of privilege | Community roles | A member runs an admin action | Permission checks on the server before every privileged action. | Phase 2 |

## 4. Abuse cases

### 4.1 Script injection through messages
- **Vector:** a message contains script or hostile markup.
- **Mitigation:** the web client renders message text as plain text by default. If Markdown is added, it is sanitised before display. A strict Content Security Policy blocks inline script.
- **Milestone:** M5 for the CSP. Phase 1 for message rendering.

### 4.2 Bulk account creation
- **Vector:** scripted sign-ups used to spam invitations.
- **Mitigation (candidates, to be chosen):** rate limits on sign-up, a bot challenge, and limits on messages from new accounts.
- **Dependency:** the auth design. `TODO(owner)`.

### 4.3 Token theft and session hijacking
- **Vector:** a stolen access token or session cookie.
- **Candidate mitigations:** short-lived access tokens, secure HTTP-only cookies, and refresh-token rotation with family revocation on reuse.
- **Dependency:** these are candidates only. The auth design decides them.

### 4.4 Realtime flooding
- **Vector:** a client sends frames faster than the server can handle.
- **Mitigation:** per-socket rate limit, a bounded outbound queue, and a deadline on writes. Numeric limits are decided at M6 under D6.

## 5. Secrets and credentials

- Development credentials are generated per developer. They are never copied from documentation or committed files.
- Only variable names may appear in `.env.example`. Values are never committed.
- A committed credential is treated as exposed, even if it is a development placeholder. Rotate it and record the rotation. Do not reuse it.
- The rotation runbook is in [../runbooks/rotating-secrets.md](../runbooks/rotating-secrets.md).

## 6. Review triggers

Update this document when any of these happen:
- a new external input or network endpoint is added,
- the auth design is approved,
- a new storage, realtime, or calling component is added,
- a security incident occurs.

`TODO(owner): name who reviews changes to this document. CODEOWNERS is set up at M8.`
