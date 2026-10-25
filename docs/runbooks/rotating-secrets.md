# Runbook: Rotating Secrets and Credentials

- **Purpose:** Replace a credential on a schedule, or immediately after exposure, without losing data.
- **Owner:** TODO(owner): Security Officer
- **Status:** Draft. The secrets inventory is incomplete until the auth design (JWT or session secrets) and the storage choice are approved.
- **Last Updated:** 2026-10-25

---

## 1. Secrets inventory

| Secret | Used for | Rotation (proposed) | Impact if exposed |
|---|---|---|---|
| Database password | PostgreSQL connection | Every 180 days, and on any exposure | Direct access to all data |
| Auth signing key (name `TODO(owner)`) | Signing sessions or tokens | `TODO(owner)`, after the auth design | Forged sessions |
| Object-storage keys (when added) | Uploads and downloads | `TODO(owner)` | Access to stored media |

Each secret comes from the environment. None is stored in the repository.

## 2. Immediate rotation after exposure

Treat any credential found in a committed file or a log as exposed, including a development placeholder. Do not reuse it.

1. Generate a new value with a cryptographically secure generator. Do not write it in a shared note.
2. Change the credential at its source (for example, the database role password).
3. Update the value in your environment or secrets manager.
4. Restart the services that use it.
5. Confirm the old value no longer works.
6. Record the date, the scope, and who performed the rotation. Never record the value.

## 3. Scheduled rotation for a signing key (after auth is approved)

A zero-downtime approach keeps two keys valid for a short overlap:
1. Add the new key as the primary signing key. Keep the old key as a secondary that is still accepted for verification.
2. Wait for the longest token lifetime to pass.
3. Remove the old key.

The lifetimes and overlap window are `TODO(owner)`, decided with the auth design.

## 4. Revoking sessions

If a user's session may be compromised, revoke that user's sessions. The mechanism is part of the auth design. `TODO(owner)`. Do not invent a shortcut that deletes sessions for all users.

## 5. Checks

- No secret appears in a committed file. Run a secret scanner before each push.
- No secret appears in logs. Redaction is tested (see [OBSERVABILITY.md](../engineering/OBSERVABILITY.md)).
