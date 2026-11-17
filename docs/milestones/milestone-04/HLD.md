# High-Level Design (HLD) — Milestone 4: Direct Messaging & Real-Time Events

- **Milestone:** M4 — Direct Messaging & Real-Time Events
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Approval
- **Author:** Senior Backend Architect, Application Security Engineer, Full-Stack Engineer

---

## 1. System Topology & Architecture Overview

Holoraa v2 is architected as a modular Go backend monolith paired with a Next.js App Router Backend-for-Frontend (BFF). Milestone 4 adds a high-throughput, low-latency bidirectional real-time subsystem using Go WebSockets while maintaining PostgreSQL as the immutable, transactional source of truth.

```mermaid
flowchart TD
    Browser["Next.js Web Client (Browser)"]
    BFF["Next.js BFF (Server Actions)"]

    subgraph GoBackend ["Go Modular Monolith (Strict Single Instance in M4)"]
        ChiRouter["Chi HTTP Router (/v1)"]
        WSHub["Realtime WebSocket Hub (github.com/coder/websocket)"]
        AuthSvc["internal/auth (Session & Tickets)"]
        MsgSvc["internal/messaging (Conversations & Rules)"]
        OutboxWorker["internal/messaging/outbox (At-Least-Once Dispatcher)"]
    end

    Postgres[("Neon PostgreSQL 17 (Source of Truth)")]

    %% HTTP / REST Flow
    Browser -->|"1. User Actions / Navigation"| BFF
    BFF -->|"2. Authenticated REST + Session Cookie"| ChiRouter
    ChiRouter --> AuthSvc
    ChiRouter --> MsgSvc

    %% WebSocket Flow
    Browser -->|"3. Ticket Exchange (POST /v1/realtime/ticket)"| BFF
    BFF -->|"4. Issue Signed Ticket"| ChiRouter
    Browser -->|"5. WS Upgrade (/v1/realtime/ws, Sec-WebSocket-Protocol: holoraa-ticket.<t>)"| WSHub

    %% Persistence & Fan-out
    MsgSvc -->|"6. Atomic Tx (Message + Outbox Event)"| Postgres
    OutboxWorker -->|"7. Claim Outbox (SKIP LOCKED)"| Postgres
    OutboxWorker -->|"8. Event Dispatch"| WSHub
    WSHub -->|"9. Push Event (ws frame)"| Browser
    Browser -->|"10. Client Delivery ACK (message.delivered)"| WSHub
```

---

## 2. Key Architectural Decisions (ADRs)

### 2.1 DEC-M4-01: WebSocket Engine Selection (`github.com/coder/websocket`)
- **Context:** The backend requires a robust WebSocket library that integrates cleanly with Go's standard library `context.Context`, avoids memory leaks, and provides strict RFC 6455 compliance.
- **Decision:** Adopt `github.com/coder/websocket` (formerly `nhooyr.io/websocket`).
- **Rationale:**
  - Modern, zero-dependency, idiomatic Go.
  - Native `context.Context` cancellation across read/write loops.
  - Zero goroutine leakage during abrupt socket disconnects.
  - Sub-10 KiB per-socket memory footprint, well within server memory budgets.

### 2.2 DEC-M4-02: Single-Use Cryptographic WebSocket Tickets
- **Context:** Browser WebSocket API (`new WebSocket(url)`) does not support custom HTTP request headers (such as `Authorization: Bearer ...`). Passing the long-lived `__Host-holoraa_session` cookie in WebSocket query parameters risks shoulder-surfing, proxy logging, and URL leakage.
- **Decision:** Authenticate WebSocket upgrades using short-lived (60s), single-use cryptographic tickets issued via an authenticated REST endpoint (`POST /v1/realtime/ticket`).
- **Security & Safety Specification:**
  1. **Token Generation:** Generated using `crypto/rand` (32 bytes hex-encoded = 256 bits of entropy).
  2. **Hash-Only Storage:** Stored in PostgreSQL `ws_tickets` solely as a SHA-256 digest (`ticket_hash = sha256(ticket)`). Plaintext tickets are never persisted.
  3. **Atomic Single-Use Consumption:**
     ```sql
     DELETE FROM ws_tickets
     WHERE ticket_hash = sha256($1) AND expires_at > now()
     RETURNING user_id;
     ```
     Because `DELETE ... RETURNING` executes atomically, concurrent or repeated upgrade attempts with the same ticket fail immediately with 401 Unauthorized.
  4. **Exclusive Subprotocol Transport & Zero Query Credentials:** Tickets are accepted **exclusively** via the `Sec-WebSocket-Protocol` header (`holoraa, holoraa-ticket.<ticket>`). Query-string credentials (`?ticket=`, `?session=`) and session cookies are strictly rejected for upgrade authentication. The server responds only with `Sec-WebSocket-Protocol: holoraa` and never echoes or logs the ticket.
  5. **Leakage Mitigation:**
     - Transport is strictly TLS encrypted (WSS).
     - Tickets have a strict 60-second TTL.
     - Single-use consumption invalidates the token immediately on upgrade.
     - Query strings and raw tickets are excluded from structured logs and URLs.

### 2.3 DEC-M4-03: Transactional Outbox Guarantees & Reconciliation
- **Context:** Decoupling message persistence from WebSocket fanout is necessary to prevent message loss during process crashes. However, distributed event delivery cannot promise "exactly-once" delivery across network boundaries.
- **Decision:** Implement a **Transactional Outbox with At-Least-Once Publication**.
- **Guarantees & Semantics:**
  - **Atomic Persistence:** The message row and the outbox event row commit within the **exact same PostgreSQL transaction**.
  - **At-Least-Once Publication:** The outbox worker dispatches events to active WebSocket connections. When frames are successfully written to socket buffers, the worker marks `status = 'published'` and `published_at = now()`. The outbox worker does **not** claim or record message delivery; client delivery is tracked separately on `messages.delivered_at`.
  - **Fencing Tokens & Lease Expiry Invariant:** Each claim assigns a fresh `claim_token (UUID)`. Updates to mark `published` require matching `claimed_by`, `claim_token`, and `lease_expires_at > now()`. If a worker's lease expired before completion, it must **not** mark the event published (even if unclaimed), preventing split-brain publication races with concurrent claiming sweeps.
  - **Idempotent Client Consumption:** The client tracks received event UUIDs and message sequence numbers. Duplicate events received over WebSocket are discarded by the client without corrupting local state.
  - **Worker Crash & Lease Expiration Recovery:** The dispatcher claims rows where `status IN ('pending', 'processing') AND (status = 'pending' OR lease_expires_at < now())`. Expired leases are reclaimed automatically by subsequent worker sweeps without manual intervention or restarts.
  - **Poison-Event Isolation:** Outbox rows track `attempts`. If an event fails processing 5 times (e.g. malformed payload), it is marked `status = 'poison'`, logged with high severity, and excluded from active sweeps, preventing queue stalling.
  - **Reconciliation Source of Truth:** PostgreSQL is the ultimate source of truth. If a WebSocket frame is dropped, client reconnection triggers a keyset reconciliation query (`GET /v1/conversations/{id}/messages?after={last_known_id}`) to reconcile missing history.

### 2.4 DEC-M4-04: Single-Instance WebSocket Limitations & Topology
- **Context:** Milestone 4 implements an in-memory connection registry (`internal/realtime/hub.go`). An in-memory hub is strictly process-local; it cannot broadcast events to users connected to other server nodes.
- **Decision:** M4 is explicitly scoped and deployed as a **single Go process instance**.
- **Guardrails & Constraints:**
  - Deployment configurations (Docker Compose, Render, fly.io) must set `replicas: 1`. Horizontal auto-scaling must be disabled.
  - **Zero Multi-Instance Claims:** The system does not claim or permit multi-instance execution in M4.
  - **Deployment Restart Behaviour:** During a new deployment or server restart:
    1. Active WebSocket connections receive a `1001 Going Away` close frame.
    2. Clients initiate reconnection using exponential backoff with full jitter (1s to 30s).
    3. Reconnecting clients request a fresh ticket, reconnect to the newly booted instance, and execute keyset catch-up.
  - **Prerequisites for Multi-Instance (M7):** Before running multiple instances, a distributed broker (Redis Pub/Sub or NATS) must be introduced to distribute WebSocket broadcasts across all node instances, along with distributed presence tracking.

### 2.5 DEC-M4-05: Delivery & Read Receipt Lifecycle
- **Context:** A successful server-side WebSocket write only proves that bytes entered the OS network socket buffer; it does **not** prove that the recipient's device received or rendered the message.
- **Decision:** Enforce clear, decoupled lifecycle states:
  1. **Sent (`sent`):** The message transaction has committed to PostgreSQL with a per-conversation monotonic `sequence_num`. Confirmed to the sender via server `message.ack`. (Single gray tick).
  2. **Delivered (`delivered`):** The recipient client application receives the frame and explicitly returns a `message.delivered` event containing `{ messageId, conversationId }`. The server persists `messages.delivered_at = now()` and notifies the sender. (Double gray ticks).
  3. **Read (`read`):** The recipient satisfies the **Documented Visibility Policy**:
     - The conversation window is active and focused.
     - The browser tab is visible (`document.visibilityState === 'visible'`).
     - The message has been scrolled into the viewport for at least 500ms, or the user interacted with the thread.
     The recipient client sends `message.read` with the highest visible message ID. The server advances `conversation_members.last_read_sequence` (private watermark) and, if receipts are enabled, advances `conversation_members.receipt_sequence` and broadcasts `message.read` to the sender. (Double coral ticks).
  - **Read Receipt Definition (Option B: Incoming Messages Newly Marked Read):**
    - Holoraa strictly implements **Option B**: read receipts represent actual incoming messages newly marked read by the recipient.
    - When a user advances their viewport over their *own* sent messages, only their private read watermark (`last_read_sequence`) advances; `receipt_sequence` is not modified and **zero `message.read` outbox events are emitted**.
    - When a user reads *incoming* peer messages while read receipts are enabled, `messages.read_at` is set, `receipt_sequence` advances to the latest incoming message read, and a `message.read` outbox event is emitted covering the sequence range (`fromSequenceNum` to `sequenceNum`).
    - Duplicate reads, reads while receipts are disabled, or reads where no incoming messages are unread emit **zero outbox events**.
  - **Decoupled Dual Watermarks (Private vs Peer-Visible):**
    - **Private Read Watermark:** Tracks private read progress (`last_read_sequence`, `last_read_message_id`, `last_read_at`). Used for local unread counts and multi-device sync.
    - **Peer-Visible Receipt Watermark:** Tracks disclosed progress (`receipt_sequence`, `receipt_message_id`, `receipt_at`, `receipt_baseline_sequence`). Used exclusively for peer delivery ticks.
    - **Baseline Invariant:** Disabling receipts freezes the peer watermark. Re-enabling receipts pins `receipt_baseline_sequence = last_read_sequence` strictly on a false-to-true transition. Repeated enable calls do not reset the baseline. The next receipt only discloses messages with `sequence_num > receipt_baseline_sequence`. Messages read during the disabled window are **never retroactively disclosed**.
  - **Sequence Invariant CHECK Constraints:**
    - `conversation_members` enforces 5 database-level invariants:
      1. `last_read_sequence >= 0`
      2. `receipt_sequence >= 0`
      3. `receipt_baseline_sequence >= 0`
      4. `receipt_sequence <= last_read_sequence`
      5. `receipt_baseline_sequence <= last_read_sequence`
  - **Watermark Monotonicity & FK Constraint:** Read pointers are strictly monotonic (`sequence_num > last_read_sequence`). Database composite foreign keys `(conversation_id, last_read_message_id)` and `(conversation_id, receipt_message_id)` reference `messages (conversation_id, id) ON DELETE SET NULL (...)`, safely nullifying only the read pointers when a message is deleted while preserving the member row. `read_at` is nullable on `messages` until a real peer receipt occurs.
  - **Persistent Privacy Controls & Hierarchical Lock Ordering:** Users can disable read receipts through persistent setting `user_settings.read_receipts_enabled`. Both read advancement (`POST /v1/conversations/{id}/read`) and setting toggle (`PATCH /v1/me/settings`) follow a strict hierarchical lock order:
    1. Lock `user_settings` for acting user (`FOR UPDATE` with safe upsert).
    2. Lock `conversation_members` for acting user (`FOR UPDATE`).
    3. Apply mutations and commit.
    This eliminates stale-setting reads and race conditions across concurrent sessions.
  - **Conversation Identity Immutability & Permission Model:**
    - Database BEFORE UPDATE triggers (`a0_enforce_conversation_immutability` and `a0_enforce_conversation_member_immutability`) strictly reject updates to `conversations.id, type, user_a_id, user_b_id, initiated_by, created_at` and `conversation_members.conversation_id, user_id, joined_at`.
    - Role `holoraa_app` is granted column-level UPDATE on `conversations` exclusively for `(status, last_message_sequence, updated_at)` and on `conversation_members` exclusively for watermark columns. DELETE on `conversation_members` is completely revoked to prevent independent membership deletion.
  - **Membership and Message Sender Integrity:**
    - `conversations.initiated_by` is constrained by database `CHECK (initiated_by = user_a_id OR initiated_by = user_b_id)`.
    - `conversation_members` is constrained by trigger `trg_check_conversation_member` ensuring only `user_a_id` or `user_b_id` can ever join a direct conversation.
    - Deferred constraint triggers `trg_conversation_members_conv` and `trg_conversation_members_mem` validate at commit time that direct conversations contain exactly two members across both OLD and NEW identities.
    - `messages` enforces sender membership at the database level via composite foreign key `(conversation_id, sender_id) REFERENCES conversation_members (conversation_id, user_id) ON DELETE CASCADE`. Non-members cannot send messages to any conversation under any circumstance.

### 2.6 DEC-M4-06: Message Request & Directional Blocking Policy
- **Context:** Unrestricted DMs encourage spam and harassment. Following another user does not imply consent to receive unsolicited messages.
- **Decision:**
  - **Conversation States:** `conversations.status` strictly tracks the 1:1 message request state machine: `pending` (message request), `accepted` (active conversation), and `declined` (rejected request). Blocking is decoupled from conversation status and evaluated dynamically from the authoritative `blocks` table.
  - **Mutual Follow Bypass:** If User A and User B mutually follow each other, a new conversation initializes directly as `accepted`.
  - **Non-Mutual Message Requests:** If User A initiates a chat with User B without mutual follows, the conversation initializes as `pending`. User B must explicitly accept the request before regular messaging begins. User A cannot send additional messages while the request is pending (strict 1-message limit).
  - **Pair-Level Advisory Serialization:** All conversation creation, sends, and block operations acquire a transaction-scoped advisory lock derived deterministically from `LEAST(user_a, user_b)` and `GREATEST(user_a, user_b)`. This eliminates races between blocking and conversation creation even when no conversation record pre-exists.
  - **Authoritative Directional Blocking:**
    - The `blocks` table is authoritative for who blocked whom (`blocker_id`, `blocked_id`).
    - If B is blocked by A: B cannot send messages; attempts reject with HTTP 403 Forbidden (`"You cannot message this user."`).
    - If A is the blocker: A cannot send messages without unblocking first; attempts reject with HTTP 403 Forbidden (`"You have blocked this user. Unblock to message."`).
    - If A unblocks B: `DELETE FROM blocks WHERE blocker_id = A AND blocked_id = B`. The conversation immediately resumes in its exact prior state (`pending`, `accepted`, or `declined`) with zero state-restoration ambiguity.
    - Blocking is bidirectional for event delivery: when a block exists in either direction, zero presence pips or typing indicators are transmitted between the users.
    - **Terminal Declined Policy (MVP):** A `declined` canonical conversation is terminal for both participants in the MVP. Neither participant can silently reopen, accept, or send messages in that conversation, and mutual follows do not override a `declined` state. `POST /v1/conversations/direct` returns HTTP `403 Forbidden` when the existing canonical conversation is `declined`. `GET /v1/conversations` and `GET /v1/conversations/{id}` continue exposing the `declined` status to both participants. Any future re-request capability requires a separately designed explicit lifecycle.
    - Pre-block history is preserved as an immutable, frozen read-only archive for both users.
    - Blocking and unblocking operations are idempotent (`ON CONFLICT DO NOTHING`).

---

## 3. End-to-End Sequence Workflows

### 3.1 WebSocket Handshake & Ticket Exchange

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser Client
    participant BFF as Next.js BFF
    participant API as Go Chi API (:8080)
    participant Hub as Go WebSocket Hub
    participant DB as PostgreSQL 17

    Client->>BFF: Request ticket (issueRealtimeTicketAction)
    BFF->>API: POST /v1/realtime/ticket (Cookie: __Host-holoraa_session)
    API->>API: Verify session & generate 32-byte crypto random token
    API->>DB: INSERT INTO ws_tickets (ticket_hash, user_id, expires_at)
    API-->>BFF: 201 Created { ticket, expiresIn: 60 }
    BFF-->>Client: { ticket }

    Client->>Hub: GET /v1/realtime/ws (Sec-WebSocket-Protocol: holoraa, holoraa-ticket.{ticket})
    Hub->>Hub: Verify Origin matches HOLORAA_ALLOWED_ORIGINS
    Hub->>DB: Atomically DELETE FROM ws_tickets WHERE ticket_hash = sha256(ticket) RETURNING user_id
    alt Ticket Valid & Not Expired
        Hub-->>Client: 101 Switching Protocols
        Hub->>Hub: Register connection to user_id in-memory channel
        Hub-->>Client: WS Frame: event "connection.ready"
    else Ticket Invalid, Consumed, or Expired
        Hub-->>Client: 401 Unauthorized (Close Code 4401)
    end
```

---

### 3.2 Real-Time Message Transmission & Delivery Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Sender)
    participant AliceWS as Alice WebSocket
    participant API as Go API / Hub
    participant DB as PostgreSQL 17
    participant BobWS as Bob WebSocket
    actor Bob as Bob (Recipient)

    Alice->>Alice: Enqueue message bubble (optimistic: pending clock icon)
    Alice->>AliceWS: WS Frame: event "message.send" { convId, clientMsgId, content }
    AliceWS->>API: Validate payload (UTF-8, 1-4000 chars, no control codes)

    rect rgb(20, 20, 30)
        Note over API,DB: Single Atomic PostgreSQL Transaction
        API->>DB: Verify membership, status = 'accepted', and zero blocks
        API->>DB: INSERT INTO messages (id, conv_id, sender_id, client_msg_id, content)
        API->>DB: INSERT INTO outbox_events (event_type, payload, target_user_ids)
        API->>DB: UPDATE conversations SET updated_at = now()
    end

    API-->>AliceWS: WS Frame: event "message.ack" { clientMsgId, messageId, sequenceNum }
    Alice->>Alice: Transition bubble to "sent" (single gray tick)

    Note over API,BobWS: At-Least-Once Outbox Dispatch
    API->>BobWS: WS Frame: event "message.created" { message }
    BobWS->>BobWS: Deduplicate by message.id & render in active thread
    BobWS->>API: WS Frame: event "message.delivered" { messageId, conversationId }

    API->>DB: UPDATE messages SET delivered_at = now() WHERE id = $messageId
    API->>AliceWS: WS Frame: event "message.status" { messageId, status: "delivered" }
    Alice->>Alice: Transition bubble to "delivered" (double gray ticks)

    Note over Bob,BobWS: Visibility Policy Satisfied (Focused for >= 500ms)
    Bob->>BobWS: Reads message in viewport
    BobWS->>API: WS Frame: event "message.read" { conversationId, messageId }
    API->>DB: UPDATE conversation_members SET last_read_message_id = $messageId
    API->>AliceWS: WS Frame: event "message.status" { messageId, status: "read" }
    Alice->>Alice: Transition bubble to "read" (double coral ticks)
```

---

## 4. Controlled Performance Acceptance Criteria

| Metric | Controlled Test Target (p50) | Controlled Test Target (p95) | Controlled Test Target (p99) | Test Harness / Methodology |
|---|---|---|---|---|
| **Database Transaction Commit** | ≤ 15 ms | ≤ 35 ms | ≤ 80 ms | Go benchmark running concurrent message inserts with pgxpool. |
| **Outbox Dispatch Latency** | ≤ 20 ms | ≤ 50 ms | ≤ 120 ms | Measured from DB commit timestamp to WebSocket write frame timestamp. |
| **End-to-End Delivery ACK** | ≤ 60 ms | ≤ 140 ms | ≤ 300 ms | Two simulated clients on loopback network measuring send-to-delivered roundtrip. |
| **Keyset Cursor Pagination (50 msgs)**| ≤ 8 ms | ≤ 20 ms | ≤ 50 ms | Keyset SQL execution against a populated conversation table (10,000 rows). |
| **Throughput Capacity** | 50 msgs/sec | 100 msgs/sec | 150 msgs/sec peak | Sustained over 10 minutes across 500 concurrent connections on single instance. |

*Real-world observations will be separately collected via client telemetry and Prometheus histograms to record WAN mobile network conditions.*
