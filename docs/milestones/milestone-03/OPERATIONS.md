# Milestone 3 — User Profiles & Discovery: Operational Runbook

- **Milestone:** M3 (Frontend & Backend Slice 2)
- **Status:** Draft / Updated for Architectural Alignment
- **Target Release:** v2.0-alpha
- **Owner:** Platform & Infrastructure Lead

---

## 1. Environment Configuration

Milestone 3 does not introduce third-party cloud infrastructure or external SaaS dependencies. All profile management, search indexing, and social relationships execute entirely within PostgreSQL and the existing Go backend.

| Variable | Scope | Type | Purpose | Production Example |
|---|---|---|---|---|
| `HOLORAA_DATABASE_URL` | Backend | URL | Neon PostgreSQL connection | `postgres://holoraa_app:...@ep-...neon.tech/holoraa?sslmode=require` |
| `HOLORAA_DEV_DB_PORT` | Local Dev | Integer | Bound host port for local PostgreSQL container | `5433` |
| `HOLORAA_ALLOWED_ORIGINS` | Backend | String | Allowed browser origins for CORS & CSRF | `https://holoraa.com,https://app.holoraa.com` |
| `HOLORAA_ENV` | Both | String | Runtime environment (`development` / `production`) | `production` |

---

## 2. Database Migration Operations

### 2.1 Applying Migration 00003
Migrations are forward-only SQL files managed exclusively by goose:

```bash
# Local development migration
goose -dir backend/db/migrations postgres "$HOLORAA_DATABASE_URL" up

# Verify migration status
goose -dir backend/db/migrations postgres "$HOLORAA_DATABASE_URL" status
```

Expected status output:
```text
Applied At                  Migration
=======================================
...                         00001_baseline.sql
...                         00002_auth_profiles.sql
Pending                     00003_user_discovery_and_follows.sql
```

### 2.2 Neon PostgreSQL Compatibility Verification
- Neon PostgreSQL natively supports the `pg_trgm` extension without requiring superuser permissions.
- In migration 00003, `CREATE EXTENSION IF NOT EXISTS pg_trgm;` is safe to run on Neon Serverless branches.

### 2.3 Rollback Procedure
If migration 00003 encounters an operational regression during deployment:

```bash
# Roll back migration 00003 to state of 00002
goose -dir backend/db/migrations postgres "$HOLORAA_DATABASE_URL" down-to 2
```

> [!WARNING]
> Rolling back migration 00003 drops the `follows` table and trigram search indexes. It does not drop existing user accounts or profiles in `users`.

---

## 3. Search Performance & Index Monitoring

### 3.1 Trigram Index Verification
To verify that the PostgreSQL query planner utilizes the GIN trigram index rather than performing a sequential scan:

```sql
EXPLAIN ANALYZE
SELECT id, username, display_name
FROM users
WHERE username IS NOT NULL
  AND id != '00000000-0000-0000-0000-000000000000'::uuid
  AND (username % 'aanya' OR display_name % 'sharma');
```

Expected plan:
- `Bitmap Index Scan on users_username_trgm_idx`
- `Bitmap Index Scan on users_display_name_trgm_idx`
- No `Seq Scan on users`.

### 3.2 Performance Benchmarking & Measurement
- Latency target: Sub-50ms query execution time under realistic synthetic workloads (10,000–50,000 user rows).
- Benchmark test command:
  ```bash
  cd backend && go test -v -run=BenchmarkSearchUsers ./internal/profile
  ```
- Sub-50ms is treated as an empirical performance target requiring continuous measurement in CI and staging, not an unverified assumption.

### 3.3 Index Maintenance
On high-churn databases, GIN indexes may accumulate dead tuples over time:
```sql
-- Scheduled maintenance during quiet hours
REINDEX INDEX CONCURRENTLY users_username_trgm_idx;
REINDEX INDEX CONCURRENTLY users_display_name_trgm_idx;
```

### 3.4 Rate Limiter Operational Architecture & Multi-Instance Behavior
The user discovery search limiter (`SearchLimiter`) enforces the 60 req/min session quota with the following operational characteristics:
- **Process-Local In-Memory Architecture:** The limiter maintains an atomic sliding-window log (`map[string][]time.Time`) protected by `sync.Mutex` directly in backend process RAM. It does not introduce Redis or external pub-sub dependencies.
- **Memory Bound & Garbage Collection:** For active sessions, timestamps older than the 60-second sliding window are pruned on each request. When total tracked sessions exceed 1,000, opportunistic garbage collection purges inactive sessions whose timestamps are entirely outside the window, ensuring bounded memory footprint.
- **Process Restart Semantics:** Because rate-limit state is kept in-memory, restarting or redeploying the backend process resets all active rate-limiting windows.
- **Multi-Instance Deployment:** In horizontal scale topologies with multiple backend replicas:
  - With sticky sessions (session-affinity load balancing on `__Host-holoraa_session`), a user's requests hit the same instance, maintaining the exact 60 req/min quota.
  - Without sticky sessions, requests distribute across $N$ instances, effectively allowing up to $N \times 60$ req/min in the worst case. Centralized rate limiting via a shared store is intentionally deferred until approved in future architecture milestones.

---

## 4. Incident Response & Troubleshooting

### Scenario A: Search Returns HTTP 429 Too Many Requests
- **Symptom:** User reports search dropdown displays "Search rate-limited. Try again shortly."
- **Root Cause:** More than 60 search requests dispatched within 60 seconds (typically caused by a malfunctioning debounce timer on client).
- **Remediation:** Verify client-side debounce hook is firing at 250ms. Inspect access logs for automated bot scraping.

### Scenario B: 409 Conflict on Profile Setup
- **Symptom:** User claims username was rejected as taken, but search shows no user with that name.
- **Root Cause:**
  1. The username matches a reserved handle (`admin`, `me`, `holoraa`, `support`, etc.).
  2. Another user has claimed the handle with different casing (e.g., `AlexSmith` vs `alexsmith`).
- **Remediation:** Confirm that username is normalized to lowercase before query. Guide user to select a distinctive alternative handle.
