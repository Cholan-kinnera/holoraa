# Runbook: Incident Response

- **Purpose:** How to detect, triage, mitigate, and learn from an incident.
- **Owner:** TODO(owner): On-call maintainer
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25

---

## 1. Severity

| Level | Meaning | Response target | Resolution target |
|---|---|---|---|
| SEV-1 | Service down, or data at risk | 15 minutes | 2 hours |
| SEV-2 | Major feature degraded | 1 hour | 6 hours |
| SEV-3 | Minor defect | 24 hours | Next release |

These targets are proposals. The owner confirms them before they are commitments.

## 2. First checks (SEV-1 or SEV-2)

1. Check liveness and readiness of the backend:
   ```bash
   curl -i "$HOLORAA_API_URL/v1/health"
   curl -i "$HOLORAA_API_URL/v1/ready"
   ```
   A failing readiness check with healthy liveness usually means the database is unreachable.
2. Check the logs for the request IDs of failing requests. Logs are redacted. Do not paste raw request content into an incident note.
3. Check resources: CPU, memory, and disk space on the host.
4. Mitigate:
   - If a deployment caused it, roll back to the last known good version. Roll back with a forward fix, not a down-migration (see [DEPLOYMENT.md](../engineering/DEPLOYMENT.md)).
   - If the database is unreachable, check its health and connection limits before restarting anything.

## 3. Security incidents

If you suspect a credential or personal-data exposure:
1. Contain it first: revoke or rotate the credential (see [rotating-secrets.md](rotating-secrets.md)).
2. Do not delete the evidence. Preserve logs and the affected commit or file.
3. Decide with the owner whether to notify users or authorities. `TODO(owner): notification obligations, see PRIVACY_AND_COMPLIANCE.md`.

## 4. After the incident

Within 48 hours of resolving a SEV-1 or SEV-2 incident, write a blameless review:
1. Timeline of events, in UTC.
2. Root cause, found by asking "why" until a process or system cause is named.
3. Action items, each with an owner and a due date.

File the action items as issues in the repository.
