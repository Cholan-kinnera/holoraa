# HTTP API Conventions — Holoraa (v2)

- **Purpose:** Conventions every Holoraa HTTP endpoint follows: URLs, errors, pagination, rate limits, and idempotency.
- **Owner:** TODO(owner): API Platform Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** The contract is planned in `contracts/` (OpenAPI 3.1.1, milestone M4). Only the M0 binary exists. No HTTP endpoint is implemented yet.

---

## 1. Source of truth

The HTTP contract is the OpenAPI 3.1.1 document in `contracts/`. This page explains the conventions. If a rule here and the contract disagree, the contract is corrected in the same change. Generated code is committed, and CI fails if regenerating produces any diff (AGENTS.md).

## 2. URLs and versioning

- All endpoints live under `/v1/`.
- Breaking changes create a new major path (`/v2/`). Backward-compatible additions stay in `/v1/`.
- The public host is `TODO(owner): production API host`. Local development uses the host and port set at M7.

## 3. Errors: RFC 9457 Problem Details

Every error response uses `Content-Type: application/problem+json` and the fields defined by [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457).

```json
{
  "type": "https://holoraa.app/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/v1/example"
}
```

Rules:
- Internal error detail, stack traces, SQL, and driver messages are never returned to clients. Log them server-side with the request ID instead.
- Validation errors may add an `errors` array with `field` and `message`. Limit its size.
- The `type` URI namespace is `TODO(owner): confirm the domain that owns error type URIs`. The legacy draft used `holoraa.app`, which is not verified as owned for this purpose.

## 4. Input validation

- Every external input has a size limit and is validated at the boundary (AGENTS.md).
- Request body and header limits are set in the foundation middleware (M2). Exact numbers are `TODO(owner)` until approved.
- Unknown JSON fields are rejected on write endpoints. Confirm this at M4.

## 5. Pagination

Collections use cursor pagination, not offset.

- Query parameters: `limit` (default 25, maximum 100) and `cursor` (opaque).
- Response: `data` (array), `nextCursor` (string or null), `hasMore` (boolean).

Cursors are opaque to clients. The server may change their format within a major version only if old cursors keep working.

## 6. Rate limiting

Planned, not implemented. The response headers follow the IETF rate-limit header draft:

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | Requests allowed in the current window |
| `RateLimit-Remaining` | Requests left in the window |
| `RateLimit-Reset` | Seconds until the window resets |
| `Retry-After` | On `429`, seconds to wait |

The limits, window sizes, and storage backend are `TODO(owner)`. The storage backend must not require Redis unless the owner approves it.

## 7. Idempotency

Non-idempotent writes (for example, sending a message) accept an `Idempotency-Key` header with a UUID.

- The server stores the key with the response for a window of `TODO(owner): duration`.
- Storage is PostgreSQL by default. Redis is deferred (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- A repeated key with the same request returns the stored result. A repeated key with a different body returns a 422 Problem Details error.

## 8. Health endpoints (foundation)

| Endpoint | Purpose | Success | Failure |
|---|---|---|---|
| `GET /v1/health` | Liveness. No dependencies. | 200 | Process not responding |
| `GET /v1/ready` | Readiness. Checks PostgreSQL. | 200 | 503 Problem Details |

## 9. Authentication

Not designed. Protected endpoints will fail closed (401 or 403, Problem Details) once the auth design is approved. Until then no endpoint is protected because none carries user data.

`TODO(owner): authentication design, which decides the header or cookie scheme and the error codes.`
