# Observability & Reliability — Holoraa (v2 draft)

- **Purpose:** What the system records, what it must never record, and the reliability targets it is measured against.
- **Owner:** TODO(owner): Site Reliability Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Nothing beyond the M0 version output is observable yet. Logging arrives at M1, and the health endpoints at M2.

---

## 1. Logging

- Logs are structured (one JSON object per line). The logging approach is `TODO(owner)`. The Go standard library `log/slog` is the likely candidate, but no decision records it yet.
- Each request gets a request ID. The ID is returned to the client and recorded in logs, so a report can be matched to a log line.
- Log level comes from configuration (M1).

### Never logged

Per AGENTS.md, logs contain no personal data, tokens, cookies, or request bodies. The redaction rule applies to all logs, not just request logs:
- authorisation and cookie headers,
- any field named like a password, token, secret, or key,
- request and response bodies,
- IP addresses, unless the owner approves a specific justified exception (see [PRIVACY_AND_COMPLIANCE.md](../security/PRIVACY_AND_COMPLIANCE.md)).

Redaction is tested. A test sends a request with sensitive values and checks that they do not appear in the log output.

## 2. Health

- `GET /v1/health` is liveness. It is never blocked by a dependency.
- `GET /v1/ready` checks PostgreSQL. A failure returns 503, with no internal detail in the body.

## 3. Metrics (planned, Phase 3)

Candidate metrics, to be confirmed when instrumentation is added:
- request count and latency, by method, route, and status,
- database query duration, by operation,
- realtime connection count (once M6 exists).

Labels must not contain user identifiers or message content. The metrics format and endpoint are `TODO(owner)`.

## 4. Tracing (planned, Phase 3)

Distributed tracing is planned. The standard, the collector, and the sampling rate are `TODO(owner)`.

## 5. Reliability targets (proposed, not measured)

| Target | Proposed value | Window |
|---|---|---|
| API availability | 99.5% | 30 days |
| Message delivery latency (p95) | under 500 ms | 1 hour |
| REST response time (p99) | under 250 ms | 1 hour |
| Call connection success | 98.5% | 24 hours (applies only when calls ship) |

Each target needs a named alert and a named response before it is treated as a commitment. `TODO(owner)`.

## 6. Incidents

Response levels and the process are in [../runbooks/incident-response.md](../runbooks/incident-response.md).
