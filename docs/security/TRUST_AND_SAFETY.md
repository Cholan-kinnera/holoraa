# Trust & Safety — Holoraa (v2 draft)

- **Purpose:** How people protect themselves from harassment, how reports are handled, and what content is prohibited.
- **Owner:** TODO(owner): Trust & Safety Lead
- **Status:** Draft for owner review. Not approved.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Nothing is implemented. Blocking, muting, and reporting arrive in Phases 1 and 4, after the auth design.

---

## 1. User safety tools

### Blocking (Phase 1 or later; depends on auth)
- A blocked user cannot start a direct message, call, or invitation with the blocker.
- In shared spaces, a blocked user's messages are collapsed, with an option to view them.
- The blocker's presence and profile changes are hidden from the blocked user.

### Muting (Phase 1 or later)
- A user can mute a conversation or channel for a chosen duration, or until unmuted.
- Muted conversations produce no notifications and no unread counts.

Duration options are `TODO(owner)`. The legacy draft listed 1 hour, 8 hours, and 1 week.

## 2. Reporting (Phase 4)

1. A user reports a message or a person. The report is stored with the reporter's identity kept private.
2. Reports go to a moderation queue. Reviewers can dismiss a report with a reason, or act on it.
3. Actions can be a warning, a time-limited restriction, or a ban. The affected user is told which policy applies.
4. The affected user can appeal. A second reviewer who did not take the first action handles the appeal.
5. The reporter is told the outcome in general terms.

Reviewer tooling and staffing are `TODO(owner)`.

## 3. Server moderation roles (Phase 2)

Server owners can give moderators these permissions:
- **Remove members** (they can rejoin with a new invitation).
- **Ban members** (exclude the account from rejoining). Whether bans also record a network identifier is `TODO(owner)`. That needs a privacy review.
- **Manage messages** (delete messages and remove spam).
- **Mute in voice** (only when calls exist).

Every permission check runs on the server.

## 4. Content policy

Holoraa prohibits:
1. Child sexual abuse material and any sexual content involving minors. Zero tolerance. Reports go to the appropriate authorities. The reporting obligations and the process are `TODO(owner): legal review`.
2. Violent extremism, terrorism, and coordination of hate groups.
3. Non-consensual intimate imagery and doxxing.
4. Coordinated harassment, hate speech, and credible threats of violence.
5. Malware, phishing, and financial scams.

## 5. Open items

- Reviewer tooling, staffing, and response times.
- Appeal timelines.
- Whether bans record any identifier, and how that is handled under the privacy document.
- Legal review of the reporting obligations in section 4.
