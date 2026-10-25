# Privacy, Data Protection & Compliance — Holoraa (v2 draft)

- **Purpose:** What personal data Holoraa stores, why, how long, and how people exercise their rights.
- **Owner:** TODO(owner): Legal & Privacy Counsel
- **Status:** Draft for owner review. **Not reviewed by counsel.** Legal bases, retention periods, and the jurisdictional analysis all need legal review before any public launch.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Nothing is implemented. The data described here does not exist in v2 yet.

---

## 1. Principles

- Private by default. Data is collected only when a feature needs it.
- No advertising, no tracking pixels, no sale or sharing of user data (AGENTS.md; vision).
- Logs contain no personal data by default.

## 2. Data inventory (draft)

| Category | Fields (draft) | Purpose | Storage | Retention (draft) |
|---|---|---|---|---|
| Account identity | Username, sign-in identifier, credential data | Sign-in | PostgreSQL | `TODO(owner)`. The legacy draft said "life of account plus 30 days". This conflicts with section 4. |
| Profile | Display name, avatar, bio | Shown to other users | PostgreSQL and object storage | Until the user deletes it |
| Messages | Message body, attachments, reactions | Delivering conversations | PostgreSQL and object storage | Until the conversation or account is deleted (`TODO(owner)` for group behaviour) |
| Operational logs | Request ID, route, status, duration | Reliability and security | Log store (format and location `TODO(owner)`) | Draft: 14 days |
| Safety records | Reports, blocks | Safety review | PostgreSQL | Draft: 180 days, then deleted or anonymised |

Logs never contain IP addresses, cookies, tokens, or request bodies unless the owner approves a specific, justified exception. `TODO(owner)`.

## 3. Legal bases (to be confirmed by counsel)

The legacy draft mapped each category to a GDPR Article 6 basis. Those mappings are carried forward as **proposals only**: account data to contract, profile data to consent, and safety data to legal obligation or legitimate interest. Counsel confirms each one.

## 4. Deletion (draft; needs owner decision)

- **Inconsistency to resolve:** the inventory above says account data is kept for the life of the account plus 30 days. The legacy erasure flow said a 7-day cancellation grace period, after which identity fields are anonymised. These cannot both be right.
  `TODO(owner): choose one grace period and update both places.`
- Secrets, sessions, and active tokens are revoked immediately on deletion (proposal).
- Anonymised identity uses a neutral placeholder name (for example, "Deleted user"), not a value that could identify the person.
- Object-storage files linked to the account are removed (proposal). The deletion job and its tests are a Phase 4 deliverable.

## 5. Rights of access and portability (planned, Phase 4)

- Users can request an export of their data. Export format and delivery timing are `TODO(owner)`.
- The legacy draft proposed a 48-hour target. This is unverified.

## 6. Age policy (decision required, not hard-coded)

India's Digital Personal Data Protection Act 2023 defines a child as anyone under 18, and it requires verifiable parental consent for a child's data. The legacy draft flagged this and said not to hard-code a threshold of 13. That flag is retained.

- `TODO(owner): legal review of the age threshold and the consent mechanism before public registration in any jurisdiction.`
- No age question is built until this decision is made.

## 7. Other jurisdictions

GDPR applies if people in the EU use the service. An EU representative is required in some cases. `TODO(owner): determine whether an EU representative is needed.`

## 8. Open items

- Choose the grace period (section 4).
- Confirm legal bases and retention periods (sections 2 and 3).
- Decide the age threshold and consent flow (section 6).
- Decide the log retention window and log content rules.
