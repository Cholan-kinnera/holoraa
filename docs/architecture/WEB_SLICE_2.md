# Web slice 2: sign-in, profile, and application shell

- **Status:** Planned and in progress on `feat/auth-profiles`. Not merged.
- **Depends on:** [AUTH_AND_PROFILES.md](AUTH_AND_PROFILES.md) (slice 1 API) and the landing page and design system (commits `c18f3b7` to `98ef23d`).
- **Contract:** `contracts/openapi.yaml` (`/v1/auth/*`, `/v1/me`). The browser never calls the API.

## 1. Approach

The API is reached only from the Next.js server, as the existing `lib/api/client.ts` already requires.

- **Reads** happen in Server Components. A server-side `GET /v1/auth/session` call forwards the browser's session cookie and returns the user and the CSRF token. An expired or missing session redirects to `/sign-in`.
- **Writes** happen in Server Actions: send code, verify code, sign out, and update profile. Each action calls the API server-side.
- **Cookies.** The API's `Set-Cookie` on verify and logout is parsed and re-applied with Next's `cookies()`. Attributes come from the API header; the web layer adds none of its own.
- **Origin.** A Server Action passes the browser's `Origin` header on to the API, so the API's origin allowlist still applies.
- **CSRF.** For profile writes, the action reads the CSRF token from the session call and sends it as `X-CSRF-Token`. The token never reaches client JavaScript.
- **No CORS.** No API route is exposed to the browser, and no new API endpoint is added.

## 2. Routes

| Route | Type | Behaviour |
|---|---|---|
| `/sign-in` | Server page + client form | Step 1: email. Step 2: six-digit code and challenge. Errors and rate-limit wait shown. `?expired=1` shows a session-expired notice. |
| `/app` | Server layout (session gate) | Requires a session; redirects to `/sign-in` otherwise. Redirects to `/app/profile?setup=1` when `profileComplete` is false. |
| `/app` | Server page | Chat layout. Conversation list is empty. The composer is disabled and labelled. |
| `/app/profile` | Server page + client form | View and edit username, display name, bio, avatar URL. Setup banner when incomplete. |

## 3. States

- **Loading:** pending state on every form (`useActionState` pending), and a skeleton for the profile. No layout shift.
- **Error:** fixed messages mapped from status codes. Raw API or network text is never shown. A 503 means "could not send the code; nothing was recorded".
- **Empty:** no conversations, and no profile fields filled in.
- **Expired session:** an action or page that receives 401 clears the cookie and redirects to `/sign-in?expired=1`.
- **API unreachable:** a plain "Holoraa cannot be reached right now" page. The app does not show signed-in content without a confirmed session.

## 4. Messaging honesty

Message persistence and delivery are not implemented. The chat layout is a shell:

- No contacts or conversations are invented. The list shows an empty state.
- The composer is disabled, with the label "Messaging is in development".
- No copy says messages are sent, delivered, or private-by-proof.

## 5. Security and privacy

- User-generated text (display name, bio, usernames) is rendered as React text only. No `dangerouslySetInnerHTML`.
- The CSP stays nonce-based. No inline `style` attributes are rendered on the server.
- Server logs do not include cookies, codes, emails, or request bodies.

## 6. Known blocker before any production deployment

**Shared client address.** The API takes the client address from the connection (`RemoteAddr`) and never reads forwarded headers (D11). With the web app acting as the API client, every user shares the web server's address. The per-address limits (20 sends per hour, 30 failed verifications per 15 minutes) would then apply to all users together. This is acceptable for local development only. A validated trusted-proxy policy must be decided before any production deployment (owner decision D11). This slice does not work around it.

## 7. Tests

- **Unit:** `Set-Cookie` parsing; status-to-message mapping; the client-side email and username checks, which mirror the server rules and never replace them.
- **Server action logic:** with an injected `fetch`, the forwarded `Origin` and `X-CSRF-Token` headers, cookie re-application, and the 401 path.
- **Server render:** the sign-in form, the empty chat shell, and the profile form. Escaping: a display name containing markup renders as text.
- **jsdom:** the mobile navigation and profile menu (open, Escape, focus return, reduced motion).
- **E2E (manual, recorded):** sign in with the code from `.local/mail`, edit the profile, sign out, and confirm `/app` redirects afterwards.

## 8. Out of scope

Messaging, contacts, Google sign-in, avatar upload, account deletion, and any trusted-proxy handling.
