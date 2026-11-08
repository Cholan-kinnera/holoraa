# Product Requirements Document (PRD) — Milestone 4: Direct Messaging & Real-Time Events

- **Milestone:** M4 — Direct Messaging & Real-Time Events
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Approval
- **Author:** Senior Backend Architect, Application Security Engineer, Full-Stack Engineer
- **Target Launch:** Production-Quality MVP

---

## 1. Executive Summary & Product Vision

Holoraa is one minimal, private social space to talk, hang out, and share with the people who matter.

Following the completion of **M1 (Workspace Foundation)**, **M2 (Authentication Foundation)**, and **M3 (Profiles & User Discovery)**, **Milestone 4 introduces live one-to-one messaging**.

Milestone 4 elevates Holoraa from an authenticated profile and discovery directory into an active, real-time communication platform. It delivers focused, zero-clutter 1:1 direct messaging powered by Go WebSockets, transactional PostgreSQL persistence, an at-least-once transactional outbox engine, and explicit client-side delivery and read acknowledgements.

---

## 2. Problem Statement & Core Value Proposition

### 2.1 The Problem
Modern messaging platforms suffer from either:
1. **Attention extraction & notification spam:** Vanishing messages, read ticks used as pressure mechanics, and algorithmic feed intrusions.
2. **Fragile delivery claims:** Systems that claim "instant delivery" by relying on volatile in-memory queues without transactional guarantees, dropping messages during worker restarts or producing silent client-side state divergence.

### 2.2 Holoraa's Value Proposition in M4
- **Calm, Chronological Communication:** Linear 1:1 message history without algorithmic sorting, vanity metrics, or artificial engagement hooks.
- **Durable Transactional Persistence:** PostgreSQL is the sole source of truth. Messages and outbox events commit atomically.
- **At-Least-Once Delivery with Idempotency:** The backend guarantees at-least-once outbox publication; the client guarantees idempotent consumption via client-generated message UUIDs.
- **Architected for Future Privacy:** Clean separation between transport metadata and message payload, ensuring smooth integration of client-side End-to-End Encryption (E2EE) in future milestones without schema rewrites.
- **Fail-Closed Access Control:** Strict authorization on every REST request, WebSocket connection, subscription, and message event.

---

## 3. Scope Boundaries

### 3.1 In-Scope (Milestone 4 Deliverables)
1. **Canonical 1:1 Direct Conversations:** Deterministic pairing between two authenticated users (`user_a_id < user_b_id`) with conversation state handling (`pending` message requests and `accepted` active chats).
2. **Message Request Policy:**
   - Following does not automatically permit unrestricted messaging.
   - Initial messages from non-mutual or unknown connections create a message request (`pending` state).
   - Recipient can Accept or Decline/Block. Accepting moves the conversation to `accepted`.
3. **Real-Time WebSockets:** Single-instance Go WebSocket engine using `github.com/coder/websocket`, single-use ticket authentication, origin validation, and 30-second ping/pong heartbeats.
4. **Message Persistence:** UTF-8 text messages (1–4,000 characters) committed to PostgreSQL with monotonic sequence numbers and keyset cursor pagination.
5. **Client Idempotency:** Client-generated `client_message_id` (UUIDv4) preventing duplicate database rows on network retries.
6. **Transactional Outbox Engine:** Guaranteed at-least-once message dispatch from PostgreSQL to the WebSocket broadcast hub with worker crash recovery, exponential retry backoff, and poison-event isolation.
7. **Explicit Delivery & Read Semantics:**
   - **Sent:** Transaction committed to PostgreSQL.
   - **Delivered:** Recipient client application explicitly sends `message.delivered` ACK back to the server over WebSocket or REST.
   - **Read:** Recipient satisfies visibility criteria (focused window, active tab, message visible in viewport for ≥ 500ms) and advances a monotonic read watermark (`message.read`).
8. **Bidirectional User Blocking:** Complete server-side enforcement across REST, WebSocket subscriptions, message delivery, and presence.
9. **Single-Instance Deployment Specification:** Explicit operational constraints ensuring M4 runs strictly as a single-instance backend until a distributed event broker is introduced in M7.
10. **Frontend Workspace Integration:** Integration with `ContextDrawer` (conversation list) and `MainStage` (chat thread, optimistic send bubbles, retry actions, connection status, and unread counts).

### 3.2 Explicitly Out-of-Scope (Deferred to Future Milestones)
- **Group Chats & Communities:** Deferred to post-M4 milestones.
- **Media Uploads & Image Attachments:** Presigned Cloudflare R2 uploads belong to **Milestone 5**.
- **Voice / Video Lounges:** WebRTC calling with LiveKit belongs to **Milestone 6**.
- **Push Notifications:** APNs / Web Push services belong to **Milestone 7**.
- **Distributed Multi-Instance WebSocket Scaling:** Multi-node WebSocket fanout via Redis Pub/Sub belongs to **Milestone 7**.
- **Client-Side End-to-End Encryption (E2EE):** Transport security (TLS 1.3) and strict DB isolation are enforced in M4. Client-side key distribution and cryptographic ratchets will be implemented in a dedicated security milestone following independent review.

---

## 4. User Personas & Core Workflows

### 4.1 Primary User Journeys

#### Journey 1: Initiating a Direct Message Request
1. Alice discovers Bob (`@bob`) via Search (`⌘K`) or his profile modal.
2. Alice clicks "Message".
3. The Next.js BFF calls `POST /v1/conversations/direct` with Bob's username.
4. The Go backend checks mutual follow and block status. If they are not mutual connections, the conversation is initialized in `status = 'pending'`.
5. Alice types her first message ("Hi Bob, would love to connect about the project") and sends it.
6. Bob sees Alice's message in his "Message Requests" drawer with options to **Accept** or **Decline/Block**.
7. Once Bob accepts, the conversation transitions to `status = 'accepted'` and full two-way messaging unlocks.

#### Journey 2: Real-Time Chat & State Lifecycle
1. Alice sends a message to Bob in an accepted conversation.
2. **Optimistic UI:** Alice's client immediately renders the message with a hollow clock icon (`pending`).
3. **Commit (Sent):** Message is committed to PostgreSQL along with an outbox event. Server returns `message.ack` to Alice. Alice's UI transitions the icon to a single gray tick (`sent`).
4. **Delivery ACK (Delivered):** Bob's active WebSocket client receives `message.created` and immediately returns a client-level `message.delivered` event. The server broadcasts `message.status` to Alice. Alice's UI transitions to double gray ticks (`delivered`).
5. **Read Watermark (Read):** Bob has the chat open and focused; the message remains in his viewport for ≥ 500ms. Bob's client sends `message.read` with the message ID. The server advances Bob's read watermark and notifies Alice. Alice's UI transitions to double coral ticks (`read`).

#### Journey 3: Disconnect, Keyset Catch-up & Reconnection
1. Bob experiences a temporary network drop (e.g., enters an elevator).
2. Alice sends two messages while Bob is offline.
3. The Go backend commits the messages and stores pending outbox rows for Bob.
4. Bob's network restores. His web client detects socket disconnect, obtains a fresh single-use ticket via `POST /v1/realtime/ticket`, and reconnects.
5. Upon reconnect, Bob's client sends a synchronization query `GET /v1/conversations/{id}/messages?after={last_known_id}`.
6. The missed messages load in strict chronological order, unread badges update, and Bob's client sends a batch delivery ACK for all received messages.

#### Journey 4: Blocking & Boundary Enforcement
1. Alice blocks Charlie via `POST /v1/users/charlie/block`.
2. The server creates an immutable blocking record in `blocks`.
3. Charlie's active WebSocket connection is immediately detached from any shared conversation channels with Alice.
4. If Charlie attempts `POST /v1/conversations/{id}/messages` or sends a WebSocket frame, the backend rejects it with HTTP 403 Forbidden (Problem Details: `"You cannot message this user."`).
5. Alice receives no events, presence updates, or indication of Charlie's attempts.
6. Existing message history remains stored but frozen; neither user can append new messages.

---

## 5. Functional Requirements (FR)

| ID | Capability | Specification |
|---|---|---|
| **FR-01** | **Canonical Direct Pairing** | Exactly one conversation can exist between two users, enforced via `CHECK (user_a_id < user_b_id)` and `UNIQUE (user_a_id, user_b_id)`. |
| **FR-02** | **Message Request Policy** | Direct conversations have states `pending` and `accepted`. First-time conversations from non-mutual contacts require recipient acceptance before continuous messaging is permitted. |
| **FR-03** | **Message Validation** | Messages accept UTF-8 text from 1 to 4,000 characters. Control characters (except newlines `\n` and tabs `\t`) and null bytes are sanitized. |
| **FR-04** | **Idempotent Ingestion** | Every send requires a UUIDv4 `client_message_id`. Submitting the same ID within the conversation returns the existing record without inserting duplicate rows. |
| **FR-05** | **Transactional Outbox** | Messages and outbox events must commit in the same database transaction. The outbox dispatcher provides at-least-once event delivery with worker crash recovery. |
| **FR-06** | **Client-Level Delivery ACKs** | Delivery is marked only when the recipient client explicitly acknowledges receipt via `message.delivered`. Server socket writes do not constitute client delivery. |
| **FR-07** | **Monotonic Read Watermarks** | Read positions are updated per member via `POST /v1/conversations/{id}/read` carrying `message_id`. Read watermarks must be strictly monotonic (cannot move backwards). |
| **FR-08** | **Keyset Pagination** | `GET /v1/conversations/{id}/messages` supports keyset pagination using `(created_at, id)` tuples to prevent page drift. |
| **FR-09** | **Single-Use WebSocket Tickets** | WebSocket connections require short-lived (60s), single-use cryptographic tickets issued via authenticated REST (`POST /v1/realtime/ticket`). Stored only as SHA-256 hashes. |
| **FR-10** | **Bidirectional Blocking** | When a block exists in either direction, conversation initiation, message sending, delivery receipts, typing indicators, and presence updates are blocked. |
| **FR-11** | **Rate Limiting** | Outbound messages are capped at 30 messages/minute per user. New conversation requests are capped at 5 requests/hour. WebSocket connection attempts are capped at 10/minute per IP/session. |

---

## 6. Non-Functional Requirements (NFR)

### 6.1 Measurable Performance Criteria (Controlled Test Environment)
*Environment: Co-located backend, PostgreSQL, and benchmark harness on loopback/LAN with RTT < 5ms.*

| Metric | Target (p50) | Target (p95) | Target (p99) | Measurement Point |
|---|---|---|---|---|
| **Message Commit Latency** | ≤ 15 ms | ≤ 35 ms | ≤ 80 ms | HTTP/WS receive to PostgreSQL transaction commit |
| **Outbox Dispatch Latency** | ≤ 20 ms | ≤ 50 ms | ≤ 120 ms | PostgreSQL commit to WebSocket broadcast frame write |
| **E2E Send-to-Delivered ACK** | ≤ 60 ms | ≤ 140 ms | ≤ 300 ms | Sender dispatch to sender receiving `message.status(delivered)` |
| **Keyset Query Latency (50 msgs)** | ≤ 8 ms | ≤ 20 ms | ≤ 50 ms | `GET /v1/conversations/{id}/messages` query execution |
| **Sustained Throughput** | 50 msgs/sec | 100 msgs/sec | 150 msgs/sec peak | Across 500 concurrent active WebSocket connections |

*Note: Real-world WAN observations will vary according to client carrier latency, physical distance, and mobile radio wake-up times.*

### 6.2 Reliability & Fault Tolerance
- **At-Least-Once Outbox Delivery:** Background outbox worker retries unacknowledged events with exponential backoff (`min(100ms * 2^attempts, 10s)`).
- **Poison-Event Isolation:** Events failing after 5 attempts are marked `status = 'poison'` and trigger an operational alert, preventing queue stalling.
- **Client Recovery:** Client queues unsent messages in memory during disconnections and resynchronizes missed messages via keyset cursor upon reconnect.

### 6.3 Single-Instance Deployment Topology
- **M4 Topology:** Strictly single Go process instance. The in-memory WebSocket connection registry is process-local and does not communicate across nodes.
- **Guardrail:** Infrastructure configurations (Docker Compose, Render, fly.io) must pin `replicas: 1` during M4. Multi-instance scaling is explicitly blocked until M7 introduces Redis Pub/Sub.

### 6.4 Security & Privacy
- **IDOR Protection:** Every query enforces conversation membership (`WHERE conversation_id = $1 AND EXISTS (SELECT 1 FROM conversation_members WHERE user_id = $caller)`).
- **CSWSH Defense:** WebSocket handshakes enforce strict HTTP `Origin` header validation against `HOLORAA_ALLOWED_ORIGINS`.
- **Payload Limits:** Maximum message length 4,000 characters; maximum WebSocket incoming frame size 16 KiB.
