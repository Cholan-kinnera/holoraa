# Test Plan — Milestone 4: Direct Messaging & Real-Time Events

- **Milestone:** M4 — Direct Messaging & Real-Time Events
- **Document Version:** 1.1.0
- **Status:** Proposed for Owner Approval
- **Author:** Senior Backend Architect, Application Security Engineer, QA Specialist

---

## 1. Testing Philosophy & Quality Gates

In accordance with [`AGENTS.md`](file:///home/ck/Projects/holoraa/AGENTS.md):
- **Real Services, Zero Mocking:** Database tests execute against real PostgreSQL 17 scratch databases created by `internal/testdb`.
- **Race Detection Mandate:** Every Go test runs with `-race -count=1`. Any data race fails the build immediately.
- **Contract Fidelity:** OpenAPI 3.1.1 and JSON Schema drift checks must report 0 diffs.
- **Strict Evidence Reporting:** Tests must be executed and evidenced with terminal outputs before declaring gate completion.

---

## 2. Test Execution Matrix

| Level | Tooling | Focus Areas | Target Pass Rate |
|---|---|---|---|
| **Go Unit Tests** | Standard `testing` package | Ticket hashing, payload sanitization, envelope validation, rate limiters. | 100% |
| **Go DB Integration Tests** | `testdb` + real PostgreSQL | Transactional message + outbox commit, canonical pair constraints, keyset pagination. | 100% |
| **WebSocket Concurrency** | `testing` + goroutines | Multi-client broadcast, duplicate `client_message_id` suppression, ticket expiry, heartbeat keep-alive. | 100% |
| **Frontend Client Tests** | Vitest + React Testing Library | Hook state machine, optimistic bubble rendering, retry on error, accessibility. | 100% |
| **End-to-End (E2E)** | Dual-browser automated run | Two authenticated sessions (Alice & Bob) exchanging live messages, disconnects, and reads. | 100% |

---

## 3. Specific Test Scenarios

### 3.1 Database & Concurrency Test Cases

#### TC-DB-01: Canonical Direct Conversation Idempotency & Concurrency
- **Scenario:** Alice initiates a conversation with Bob (`POST /v1/conversations/direct`). Simultaneously in a separate goroutine, Bob initiates a conversation with Alice.
- **Expectation:** Both requests resolve to the exact same `conversation_id`. PostgreSQL creates exactly one row in `conversations` with `user_a_id = LEAST(Alice, Bob)` and `user_b_id = GREATEST(Alice, Bob)`. No duplicate conversation or deadlock occurs.

#### TC-DB-02: Message Transactional Outbox Atomic Commit
- **Scenario:** Alice sends a message. Simulate an intentional database trigger failure during outbox insertion.
- **Expectation:** The entire transaction rolls back. Neither the message nor the outbox row exists in PostgreSQL. The caller receives HTTP 500 Problem Details.

#### TC-DB-03: Keyset Cursor Pagination Under Concurrent Writes
- **Scenario:** Seed a conversation with 150 messages. Query the first 50 messages, retrieve cursor `(created_at, id)`, and query the next 50 while a new message is inserted concurrently.
- **Expectation:** Keyset query returns exactly the next 50 messages in strict sequence. No message is skipped, duplicated, or dropped across page boundaries.

#### TC-DB-04: Duplicate Client Message ID Suppression
- **Scenario:** Alice sends a message with `client_message_id = "abc-123"`. The server commits the row. Due to a simulated network glitch, Alice's client retries with the same `client_message_id`.
- **Expectation:** PostgreSQL raises a unique constraint violation (`uq_messages_client_id`). The service catches this, retrieves the previously committed message, and returns `200 OK` with the existing `message.id`. Exactly one message row exists.

#### TC-DB-05: Monotonic Read Watermark Advancement
- **Scenario:** Bob's client has marked message sequence 10 as read. An out-of-order or duplicate request arrives attempting to mark message sequence 8 as read.
- **Expectation:** The database query rejects the regression (`WHERE sequence_num > current_read_sequence`). The read watermark remains at sequence 10.

---

### 3.2 Outbox Reliability & Worker Fault Injection

#### TC-OUT-01: At-Least-Once Delivery & Worker Crash Recovery
- **Scenario:** Insert 10 messages into PostgreSQL. Simulate the outbox worker crashing immediately after writing frames to WebSockets, before executing `UPDATE outbox_events SET status = 'delivered'`. Restart the worker.
- **Expectation:** The restarted worker claims the unacknowledged rows (`WHERE status = 'processing' AND created_at < now() - interval '10s'`) and re-dispatches them. Client-side deduplication discards the redundant frames without corrupting UI state.

#### TC-OUT-02: Poison-Event Isolation (Dead-Letter Handling)
- **Scenario:** Inject an outbox event with a deliberately malformed payload that triggers an unhandled JSON error in the dispatcher.
- **Expectation:** The dispatcher attempts delivery 5 times with exponential backoff. Upon reaching attempt 5, the event status transitions to `'poison'`, an operational error is logged, and subsequent pending events continue processing without queue stalling.

#### TC-OUT-03: Outbox Claiming Concurrency (`SKIP LOCKED`)
- **Scenario:** Launch two concurrent outbox claiming workers against 100 pending outbox events.
- **Expectation:** `FOR UPDATE SKIP LOCKED` ensures each worker receives disjoint subsets of the pending queue. No event is locked or double-claimed simultaneously.

---

### 3.3 Real-Time WebSocket & Ticket Security Test Cases

#### TC-WS-01: Single-Use Ticket Atomic Consumption
- **Scenario:** Alice calls `POST /v1/realtime/ticket` to obtain token `T`. Alice initiates a WebSocket connection with `?ticket=T`. Concurrently in another thread, Eve attempts to connect with `?ticket=T`.
- **Expectation:** Exactly one connection succeeds (`101 Switching Protocols`). The other attempt receives HTTP 401 Unauthorized (`Close Code 4401`). The database `ws_tickets` row is deleted.

#### TC-WS-02: Ticket Expiration & Replay Rejection
- **Scenario:** Alice obtains token `T` with a 60-second TTL. Alice waits 61 seconds before attempting a WebSocket connection.
- **Expectation:** The query `WHERE ticket_hash = sha256(T) AND expires_at > now()` matches 0 rows. Connection rejected with HTTP 401.

#### TC-WS-03: Cross-Site WebSocket Hijacking (CSWSH) Defense
- **Scenario:** An attacker initiates a WebSocket upgrade from an unauthorized origin (`Origin: https://evil.example.com`).
- **Expectation:** Handshake checks `Origin` against `HOLORAA_ALLOWED_ORIGINS` before protocol upgrade. Connection rejected with HTTP 403 Forbidden.

#### TC-WS-04: Heartbeat Idle Timeout & Socket Teardown
- **Scenario:** Client connects successfully. Client stops sending `ping` frames for 60 seconds.
- **Expectation:** The server-side 60s read deadline triggers. Server sends a clean close frame (`StatusGoingAway`), tears down reader/writer goroutines, and unregisters the socket from the hub.

---

### 3.4 Message Request Policy & Security Boundaries

#### TC-SEC-01: Non-Mutual Message Request Gating
- **Scenario:** Alice (who does not mutually follow Bob) sends a direct message to Bob.
- **Expectation:** Conversation is created in `status = 'pending'`. Alice cannot send a second message until Bob accepts. Bob receives the request in his requests list. Once Bob calls `POST /v1/conversations/{id}/accept`, status transitions to `'accepted'` and normal messaging unlocks.

#### TC-SEC-02: IDOR Conversation Isolation
- **Scenario:** Eve (authenticated user) attempts `GET /v1/conversations/{id}/messages` or sends a message to a conversation between Alice and Bob.
- **Expectation:** Server checks membership: `WHERE conversation_id = $id AND user_id = $caller`. Because Eve is not a member, request is rejected with HTTP 404 / 403 Problem Details (`"Conversation not found or access denied."`).

#### TC-SEC-03: Bidirectional Blocking Enforcement
- **Scenario:** Alice blocks Bob via `POST /v1/users/bob/block`. Bob attempts:
  1. `POST /v1/conversations/direct` with Alice.
  2. `POST /v1/conversations/{id}/messages` in their pre-existing conversation.
  3. Sending a WebSocket message frame.
- **Expectation:** All attempts reject with HTTP 403 Forbidden (`"You cannot message this user."`). Alice receives zero events, indicators, or presence updates from Bob.

#### TC-SEC-04: Frozen Archive Policy on Block
- **Scenario:** Alice blocks Bob. Both Alice and Bob inspect their conversation history from before the block.
- **Expectation:** Historical messages remain readable in read-only mode. The message composer is disabled with a notice `"You cannot message this user."`

#### TC-SEC-05: Rate Limiting & Payload Defense
- **Scenario:** Client sends 35 messages within 10 seconds or sends a 10,000-character payload.
- **Expectation:** Messages 1-30 commit; messages 31+ reject with HTTP 429 Problem Details (`"Too many messages. Slow down."`). The 10,000-character payload rejects with HTTP 400 Problem Details (`"Message exceeds 4000 character limit."`).

---

## 4. Controlled Performance Acceptance Protocol

### 4.1 Benchmark Setup
- **Server:** 1 instance of Go API backend (M4 topology constraint).
- **Database:** PostgreSQL 17 on dedicated SSD container / host.
- **Network:** Loopback / Local GigE LAN with baseline RTT < 2ms.
- **Tooling:** Go parallel load generator using `coder/websocket`.

### 4.2 Benchmark Criteria & Gates

| Benchmark Metric | Target Threshold | Measured Result (Gate) |
|---|---|---|
| **Commit Latency (p50)** | ≤ 15 ms | *Must pass in CI/local run* |
| **Commit Latency (p95)** | ≤ 35 ms | *Must pass in CI/local run* |
| **Commit Latency (p99)** | ≤ 80 ms | *Must pass in CI/local run* |
| **Outbox Fan-out Latency (p95)** | ≤ 50 ms | *Must pass in CI/local run* |
| **End-to-End Delivery ACK (p95)**| ≤ 140 ms | *Must pass in CI/local run* |
| **Sustained Throughput** | 50 msgs/sec for 10 mins (500 conns) | *Must pass in CI/local run* |

---

## 5. Dual-Account Real-Device Verification Protocol

Before M4 final release, execute this manual verification protocol:

1. **Setup:**
   - Account A (`alice`) on Desktop Chrome.
   - Account B (`bob`) on Mobile Safari (separate network/IP).
2. **Message Request:** Alice sends message to Bob. Bob verifies the message appears in "Message Requests". Bob accepts the request.
3. **Live Typing & Chat:** Alice types; Bob observes `typing.indicator` in real-time. Alice sends "Meeting at 3pm".
4. **Delivery & Read States:**
   - Alice observes single tick (`sent`).
   - Bob's phone receives frame; Bob's client sends ACK; Alice observes double gray ticks (`delivered`).
   - Bob views the thread for ≥ 500ms; Alice observes double coral ticks (`read`).
5. **Reconnection & Keyset Recovery:** Bob sets phone to Airplane Mode. Alice sends 2 messages. Bob turns off Airplane Mode. Bob's phone reconnects, performs keyset catch-up, and displays both messages in order.
6. **Block Verification:** Alice blocks Bob. Bob tries to send a message. Bob receives an error toast; Alice receives nothing.
