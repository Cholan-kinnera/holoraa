# Deployment & Operations — Holoraa (v2 draft)

- **Purpose:** Environments, the path from commit to running service, the migration policy, and backup expectations.
- **Owner:** TODO(owner): Platform Lead
- **Status:** Draft for owner review. Production hosting is not chosen.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Local development is planned at M7 (Docker Compose with PostgreSQL only). No deployment exists.

---

## 1. Environments

| Environment | Purpose | Status |
|---|---|---|
| Local | Developer machine. Native Go and Node, or Docker Compose with PostgreSQL. | Planned at M7 |
| Staging | Verify a release before production | `TODO(owner)`: not chosen |
| Production | Real users | `TODO(owner)`: hosting not chosen |

Each environment needs its own database, its own credentials, and its own volumes. Local containers must not reuse legacy containers or volumes.

## 2. Local infrastructure (M7)

- Compose project name, volumes, and host port are set at M7. The port must not conflict with an existing service on the developer's machine.
- The PostgreSQL image and version are confirmed under D4 before use.
- Credentials are generated per developer. They come from the environment, not from a committed file.

## 3. Pipeline (planned, M7)

1. Feature branch, one logical change per commit, Conventional Commits.
2. Pull request. Required checks: formatting, static analysis, tests, build, contract drift, and migration tests from an empty database.
3. Review by the code owner.
4. Merge to the default branch. The owner approves each merge and each push.

`TODO(owner): CI runner image and service containers (D7).`

## 4. Migration policy

Migrations use goose and are forward-only SQL files in `backend/db/migrations/` (AGENTS.md).

1. **Backward-compatible changes first.** A schema change must work with the code currently running. Add nullable columns before code uses them. Do not drop or rename a column in the same release that stops using it.
2. **Run before the new version starts.** Migrations run as a separate step, before new application instances start.
3. **Roll back by moving forward.** Production is not rolled back with down-migrations. A rollback is a new forward migration that reverses the change.
4. **Test from empty.** Every migration runs from an empty database in CI.

`TODO(owner): reconcile with the M2 gate, which requires goose down and up to succeed in tests. Confirm that down-migrations exist only for testing and never run in production.`

## 5. Backups and recovery

- Automated daily backups of the PostgreSQL database, with a retention period `TODO(owner)`.
- Point-in-time recovery is planned for production. Its window is `TODO(owner)`.
- A restore drill is run on a schedule, into a separate sandbox database, not over live data. The schedule and the recovery targets are `TODO(owner)`.

The legacy draft proposed a 1-hour recovery time and a 5-minute recovery point. Those are unverified targets, not commitments. See [../runbooks/database-restore.md](../runbooks/database-restore.md).

## 6. Secrets

- Secrets come only from the environment.
- A secret never appears in a committed file, a log, a screenshot, or a report.
- Rotation is described in [../runbooks/rotating-secrets.md](../runbooks/rotating-secrets.md).

## 7. Open items

- Hosting provider and region (`TODO(owner)`).
- Staging environment (`TODO(owner)`).
- Backup retention and recovery targets (`TODO(owner)`).
- Migration rules reconciled with M2 (section 4).
