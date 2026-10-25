# Runbook: PostgreSQL Backup and Restore Drill

- **Purpose:** Take a consistent backup and prove it restores, without touching live data.
- **Owner:** TODO(owner): Database Administrator
- **Status:** Draft. Not run against any real database. The exact commands depend on the M7 local setup and the hosting choice.
- **Last Updated:** 2026-10-25

---

## 1. Before you start

- Confirm the target database is the one you intend. Write its name down.
- Confirm there is a current backup before any restore.
- Do not restore into the live database. Restore into a new database with a clear name, check it, then decide what to do.
- Credentials come from your environment or your secrets manager. Never type them into a command you will save.

## 2. Create a backup

```bash
# Replace the placeholders with your environment's values.
# The database connection comes from the environment, not from this file.
pg_dump --format=custom --file "holoraa_backup_$(date +%Y%m%d_%H%M%S).dump" "$HOLORAA_DATABASE_URL"
sha256sum holoraa_backup_*.dump
```

Store the checksum next to the dump. Verify the checksum before any restore.

## 3. Restore into a sandbox database

```bash
createdb holoraa_restore_check
pg_restore --no-owner --dbname "$HOLORAA_RESTORE_URL" holoraa_backup_YYYYMMDD_HHMMSS.dump
```

`HOLORAA_RESTORE_URL` points at `holoraa_restore_check`. Confirm the name before you run the command.

## 4. Check the restore

- Run `goose status` against the sandbox. Every migration should be applied.
- Run the readiness check against a backend pointed at the sandbox. It should return 200.
- Compare row counts for the tables you care about with the source. Record the numbers.

## 5. Clean up

Drop the sandbox database only after the check is recorded. `TODO(owner): record where drill results are stored.`

## 6. Record

For each drill, record the date, the backup checksum, the restore duration, the checks run, and the outcome. A failed drill is an incident. See [incident-response.md](incident-response.md).
