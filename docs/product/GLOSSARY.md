# Domain Glossary — Holoraa

- **Purpose:** Standard definitions for product terms used in code, APIs, and discussion.
- **Owner:** TODO(owner): Lead Architect
- **Status:** Draft for owner review (v2 reconciliation). Not yet approved.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** These terms are planned. They will appear in the v2 API contracts and database schema as those milestones are built. Numeric limits are proposals until owner approval.

---

## Terms & Concepts

### 1. Conversation
A top-level messaging entity with two or more participants.
- **DM (direct message):** A private conversation between two users.
- **Group:** A private multi-party conversation with a member cap (proposed: 1,024 members).
- **Channel conversation:** A message stream tied to a specific community channel.

### 2. Server (community space)
An organised space, owned by a user or group, containing channels, members, roles, and administrative controls. Comparable to a Discord server.

### 3. Channel
A message or media stream inside a server:
- **Text channel:** Persistent text, image, and document discussion, with threads.
- **Voice channel:** An always-open audio room that members can join and leave freely. Deferred with calls.
- **Announcement channel:** A read-only stream for broadcast notices.

### 4. Room
A persistent virtual hangout with a shareable link. It can have a host-controlled waiting room, where participants are admitted before joining audio or video. Deferred with calls.

### 5. Call
A live or past session between two or more participants. Lifecycle events: `INITIATED`, `RINGING`, `ACTIVE`, `ENDED`, `MISSED`, `REJECTED`. Deferred (post-MVP).

### 6. Member
An association between a user and a server. Holds server-specific data such as nickname, join time, and assigned roles.

### 7. Role & permissions
A set of permission flags assigned to server members, controlling capabilities such as managing channels, removing members, muting audio, and sending announcements. The exact permission model is `TODO(owner)`.
