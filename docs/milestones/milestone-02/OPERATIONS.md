# Operations & Runbook — Milestone 2: Authentication Foundation

- **Project:** Holoraa
- **Milestone:** Milestone 2 — Authentication Foundation
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Review

---

## 1. Environment Variables Specification

### Go Backend API (`.env` in local dev / Render Environment in production)

| Variable Name | Required | Example / Default | Description & Security Policy |
|---|---|---|---|
| `HOLORAA_ENV` | Yes | `development` / `production` | Production mode fails closed: enforces secure cookies, refuses fake mailer, and mandates real provider. |
| `HOLORAA_HTTP_ADDR` | Yes | `127.0.0.1:8080` (dev), `0.0.0.0:10000` (Render) | Host address and port for the API server to bind to. |
| `HOLORAA_LOG_LEVEL` | No | `info` (`debug` in dev) | Logging verbosity for structured `slog` output. |
| `HOLORAA_DATABASE_URL` | Yes | `postgresql://...` | Connection URI for PostgreSQL / Neon with connection pool parameters. |
| `HOLORAA_AUTH_SECRET` | Yes | 32+ character random string | Secret HMAC key used for code MACs, CSRF tokens, and client IP hashing. **Never logged.** |
| `HOLORAA_ALLOWED_ORIGINS`| Yes | `http://localhost:3000` (dev), `https://holoraa.vercel.app` | Comma-separated list of browser origins permitted to submit state-changing requests. |
| `HOLORAA_TRUSTED_PROXIES`| Conditional | `10.0.0.0/8,172.16.0.0/12` | CIDR blocks of reverse proxies (Render / CDN) permitted for `X-Forwarded-For` right-to-left parsing. |
| `HOLORAA_COOKIE_SECURE` | Yes | `false` (dev), `true` (prod) | When `true`, uses `__Host-holoraa_session` with `Secure` flag. In production, `false` is refused. |
| `HOLORAA_MAIL_PROVIDER` | Yes | `fake` (dev), `resend` (prod) | Selects delivery backend. Production strictly refuses `fake`. |
| `HOLORAA_MAIL_OUTBOX_DIR`| Dev only | `.local/mail` | Local directory where fake email files are written. Mode 0700/0600, git-ignored. |
| `HOLORAA_MAIL_FROM` | Prod only | `Holoraa <auth@holoraa.com>` | Verified sender address configured at Resend. |
| `HOLORAA_RESEND_API_KEY` | Prod only | `re_...` | Resend API secret token. **Never logged or committed.** |

### Next.js Frontend (`web/.env.local` in local dev / Vercel Environment in production)

| Variable Name | Required | Example / Default | Description |
|---|---|---|---|
| `HOLORAA_API_URL` | Yes | `http://127.0.0.1:8080` (dev), `https://holoraa-api.onrender.com` | Base URL of the Go backend API. Read by Server Components and Server Actions. |
| `NODE_ENV` | Yes | `development` / `production` | Directs CSP policy generation (permits local eval during development HMR). |

---

## 2. Local Development & Safe Email Testing Setup

### Safe Email Testing in Development
To guarantee that local testing cannot accidentally expose user codes or connect to live production infrastructure:
1. `HOLORAA_MAIL_PROVIDER=fake` is enforced by default in `.env`.
2. When an OTP code is requested, `mail.Fake` writes a single text file into `.local/mail/`:
   ```bash
   # Inspect generated codes locally in real time:
   cat .local/mail/*.txt | tail -n 10
   ```
3. The directory `.local/mail/` is created with permissions `0700` (read/write only by the developer's user account) and each mail file is created with `0600`.
4. `.local/mail/` is explicitly git-ignored in `.gitignore`.

---

## 3. Database Migration Procedures

Goose is the only authorized migration tool.

```bash
# Check current migration status:
make migrate-status

# Apply forward migrations to target database:
make migrate-up

# Roll back the most recent migration (development only):
make migrate-down
```

### Neon Production Migration Rule
- Production migrations are executed forward-only.
- Prior to running `make migrate-up` against Neon in production, create a point-in-time branch or snapshot of the database using the Neon Console.

---

## 4. Production Deployment Guidelines

### Go Backend (Render Web Services)
1. **Service Type:** Web Service (Docker or native Go environment).
2. **Build Command:** `make build` -> outputs `./bin/api`.
3. **Start Command:** `./bin/api serve`.
4. **Health Check Path:** `/v1/ready` (verifies both API responsiveness and PostgreSQL connectivity).
5. **Cold Start & Resource Management:**
   - Free-tier Render instances sleep after 15 minutes of inactivity. For prototype testing, cold starts take ~30–50s. The health check must have a 60s timeout configured.
   - Configure `HOLORAA_TRUSTED_PROXIES` to include Render's egress IP ranges so client IP rate-limiting functions accurately.

### Next.js Frontend (Vercel or Render Static/Node)
1. **Framework Preset:** Next.js.
2. **Root Directory:** `web/`.
3. **Build Command:** `npm run build`.
4. **Environment Variables:** Set `HOLORAA_API_URL` to the public HTTPS URL of the Render Go backend.

---

## 5. Rollback Procedures

If an unrecoverable failure occurs post-deployment:
1. **Frontend Rollback:** In Vercel or Render console, revert to the previous successful deployment instantly with one click.
2. **Backend Rollback:** Revert the Git ref and redeploy the previous binary.
3. **Database Safeguard:** Schema changes in `00002_auth_profiles.sql` are additive and backward-compatible with existing baseline tables. No column drops or destructive modifications are executed.

---

## 6. Operational Semantics of Sign-Out Under Failure Scenarios

Because `HttpOnly` cookies cannot be accessed or cleared by client-side JavaScript, cookie clearing is contingent on receiving an HTTP response with `Set-Cookie: ...; Max-Age=0`:

1. **Go Backend Down, Next.js Up:**
   - Next.js Server Action attempts to call `POST /v1/auth/logout`.
   - The Go API call fails or times out.
   - Next.js catches the error, calls `clearSessionCookies()`, and responds with `Set-Cookie: __Host-holoraa_session=; Path=/; Max-Age=0`.
   - The browser deletes the cookie locally.
   - *Operational note:* The session row in PostgreSQL was not revoked. It remains valid until its 14-day idle or 30-day absolute expiration passes.
2. **Next.js Server Down:**
   - Browser request to the Server Action fails with a network/proxy error (502/504).
   - No HTTP response reaches the browser.
   - The cookie remains intact on the user's machine. The UI displays an error notice.
3. **User Device Completely Offline:**
   - The user has no internet access.
   - Client JS cannot touch `HttpOnly` cookies.
   - Cookie expiration is impossible while offline.
   - When the user reconnects, the next session check or sign-out action will succeed.

---

## 7. Secret Key (`HOLORAA_AUTH_SECRET`) Rotation Runbook

If `HOLORAA_AUTH_SECRET` is rotated in production:
1. **Impact on In-Flight Codes:** All unconsumed OTP challenges become immediately invalid (their stored HMACs will not match the new key). Users must request a new code.
2. **Impact on CSRF Tokens:** All existing CSRF tokens fail verification. Next.js server components will fetch fresh CSRF tokens on the next page render via `GET /v1/auth/session`.
3. **Impact on Active Sessions:** Active sessions **remain valid**. Session tokens are stored as raw `SHA-256(token)` digests, independent of `HOLORAA_AUTH_SECRET`. Secret rotation does not cause mass user logouts.
4. **Impact on Rate Limiting:** Existing IP and email hashes in `auth_events` become unmatchable under the new key, resetting hourly windows.
