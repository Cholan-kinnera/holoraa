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

#### TC-DB-04: Duplicate Client Message ID Suppression & Idempotency
- **Scenario:** Alice sends a message with `client_message_id = "abc-123"`. The server commits the row. Due to a simulated network glitch, Alice's client retries with the same `client_message_id`.
- **Expectation:** Under Step 3 of message ingestion, the query detects the existing `(conversation_id, sender_id, client_message_id)`. The transaction immediately returns the existing message without incrementing `conversations.last_message_sequence` or inserting a second outbox event. Exactly one message row exists, and `last_message_sequence` remains unchanged.

#### TC-DB-05: Monotonic Read Watermark Advancement
- **Scenario:** Bob's client has marked message sequence 10 as read. An out-of-order or duplicate request arrives attempting to mark message sequence 8 as read.
- **Expectation:** The database query rejects the regression (`WHERE sequence_num > current_read_sequence`). The read watermark remains at sequence 10.

#### TC-PAG-01: Pagination Cursor Validation & Boundary Enforcement
- **Scenario:**
  1. *Non-existent Cursor:* Client requests `GET /v1/conversations/{id}/messages?before=00000000-0000-0000-0000-000000000000`.
  2. *Cross-Conversation Cursor:* Client requests messages for Conversation A passing a `before` cursor ID that belongs to Conversation B.
  3. *Conflicting Cursors:* Client requests messages providing both `before={uuid1}` and `after={uuid2}`.
  4. *Soft-Deleted Message Cursor:* Message $M$ is marked soft-deleted (`deleted_at = now()`). Client requests `GET /v1/conversations/{id}/messages?before={M.id}`.
- **Expectation:**
  1. Sub-cases 1 and 2 return RFC 9457 HTTP `400 Bad Request` with code `INVALID_CURSOR` (`"The specified cursor message does not exist in this conversation."`). Silent fallback to newest messages is strictly rejected.
  2. Sub-case 3 returns RFC 9457 HTTP `400 Bad Request` with code `INVALID_CURSOR_COMBINATION` (`"Cannot specify both 'before' and 'after' cursors."`).
  3. Sub-case 4 succeeds with HTTP `200 OK`. The server uses $M$'s immutable `sequence_num` as the pagination anchor, returning older active messages (`deleted_at IS NULL`) while excluding $M$ itself.

---

### 3.2 Outbox Reliability & Worker Fault Injection

#### TC-OUT-01: At-Least-Once Delivery & Worker Crash Recovery
- **Scenario:** Insert 10 messages into PostgreSQL. Simulate the outbox worker crashing immediately after writing frames to WebSockets, before executing `UPDATE outbox_events SET status = 'published'`. Restart the worker.
- **Expectation:** The restarted worker claims the unacknowledged rows (`WHERE status = 'processing' AND lease_expires_at < now()`) and re-dispatches them. Client-side deduplication discards the redundant frames without corrupting UI state.

#### TC-OUT-02: Poison-Event Isolation (Dead-Letter Handling)
- **Scenario:** Inject an outbox event with a deliberately malformed payload that triggers an unhandled JSON error in the dispatcher.
- **Expectation:** The dispatcher attempts delivery 5 times with exponential backoff. Upon reaching attempt 5, the event status transitions to `'poison'`, an operational error is logged, and subsequent pending events continue processing without queue stalling.

#### TC-OUT-03: Outbox Claiming Concurrency Across Multiple Worker Goroutines (`SKIP LOCKED`)
- **Scenario:** Seed 50 pending outbox events. Launch 5 concurrent worker goroutines, each executing `ClaimOutboxBatchWithLease` with batch size 10.
- **Expectation:**
  - `FOR UPDATE SKIP LOCKED` guarantees disjoint subsets: each of the 50 events is claimed by exactly one worker.
  - Zero lock contention or deadlock errors.
  - Each worker receives distinct `claim_token` UUIDs.
  - Total events transitioned to `status = 'processing'` equals exactly 50.

#### TC-OUT-04: Fencing Token Rejection for Stale Worker Completion
- **Scenario:** Worker 1 claims an outbox batch, receiving `claim_token = T1` with a 30-second lease. Worker 1 pauses (simulated GC pause or hung network write) for 35 seconds. Worker 2 claims the expired row, generating new `claim_token = T2`. Worker 1 wakes up and attempts `UPDATE outbox_events SET status = 'published' WHERE id = E AND claimed_by = W1 AND claim_token = T1`.
- **Expectation:** Worker 1's update matches 0 rows and fails closed. Worker 2 successfully publishes the event with token `T2`. No state corruption or duplicate outbox completion occurs.

#### TC-OUT-05: Expired Lease Rejection When Unclaimed (Strict Invariant `lease_expires_at > now()`)
- **Scenario:** Worker 1 claims Event $E$ with `claim_token = T1` and lease expiring at $T_0$. Worker 1 pauses for 35 seconds. At $T_0 + 5\text{s}$, before any replacement worker has claimed $E$, Worker 1 attempts `MarkOutboxPublished` with `WHERE id = E AND claimed_by = W1 AND claim_token = T1 AND lease_expires_at > now()`.
- **Expectation:** Because `lease_expires_at > now()` evaluates to false, the update matches 0 rows (`rows_affected = 0`). Worker 1 detects the lapsed lease, logs an operational warning, and does not record publication. Event $E$ remains in `status = 'processing'` with expired lease until reclaimed by the next active sweep.

---

### 3.3 Real-Time WebSocket & Ticket Security Test Cases

#### TC-WS-01: Single-Use Ticket Atomic Consumption & Subprotocol Negotiation
- **Scenario:** Alice calls `POST /v1/realtime/ticket` to obtain token `T`. Alice initiates a WebSocket connection passing header `Sec-WebSocket-Protocol: holoraa, holoraa-ticket.T`. Concurrently in another thread, Eve attempts to connect using the exact same ticket `T`.
- **Expectation:**
  - Exactly one connection succeeds (`101 Switching Protocols`). The server response header strictly contains `Sec-WebSocket-Protocol: holoraa` (never echoing the secret ticket token).
  - Eve's concurrent attempt fails handshake with HTTP 401 Unauthorized.
  - The database row for `sha256(T)` in `ws_tickets` is deleted atomically via `DELETE ... RETURNING user_id`.

#### TC-WS-02: Ticket Expiration & Replay Defense
- **Scenario:**
  1. Alice obtains token `T` with a 60-second TTL. Alice waits 61 seconds before attempting a WebSocket connection.
  2. Bob connects with token `T_bob`, disconnects, and immediately attempts to reconnect using the same token `T_bob`.
- **Expectation:**
  1. The expired ticket query `WHERE ticket_hash = sha256(T) AND expires_at > now()` matches 0 rows; connection rejected with HTTP 401 Unauthorized.
  2. Replay attempt matches 0 rows (already consumed); connection rejected with HTTP 401 Unauthorized.

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

#### TC-SEC-06: Read Receipt Privacy Suppression & Decoupled Watermarks
- **Scenario:** Bob disables read receipts via `PATCH /v1/me/settings {"readReceiptsEnabled": false}`. Alice sends messages 1, 2, 3 to Bob. Bob views the messages in active focus for ≥ 500ms.
- **Expectation:** Bob's private read watermark in `conversation_members` (`last_read_sequence = 3`) advances locally, but `receipt_sequence` remains 0 and no `message.read` outbox event is created. Alice's client displays double gray ticks (`delivered`), never coral ticks (`read`).

#### TC-PRIV-01: Baseline Isolation Across Disable/Re-enable Cycles
- **Scenario:**
  1. *Enabled Read:* Alice sends M1, M2. Bob reads M2 with receipts enabled.
     - Verification: Bob's `last_read_sequence = 2`, `receipt_sequence = 2`. Alice receives `message.read` for M1 and M2; double coral ticks displayed.
  2. *Disabled Reads:* Bob disables receipts (`PATCH /v1/me/settings {"readReceiptsEnabled": false}`). Alice sends M3, M4, M5. Bob views messages in focus.
     - Verification: Bob's `last_read_sequence = 5`. `receipt_sequence` remains 2. `messages.read_at` remains `NULL` for M3, M4, M5. Zero outbox events emitted. Alice observes double gray ticks for M3, M4, M5.
  3. *Re-enabling Receipts:* Bob re-enables receipts (`PATCH /v1/me/settings {"readReceiptsEnabled": true}`).
     - Verification: `receipt_baseline_sequence` is atomically set to `last_read_sequence = 5`.
  4. *Post-Re-enable Read:* Alice sends M6 ($seq = 6$). Bob reads M6.
     - Verification:
       - Bob's `last_read_sequence = 6`, `receipt_sequence = 6`.
       - `messages.read_at` is updated ONLY for M6 (`WHERE sequence_num > 5 AND sequence_num <= 6`).
       - `messages.read_at` for M3, M4, M5 remains strictly `NULL`.
       - Outbox event `message.read` emits `fromSequenceNum = 6, sequenceNum = 6`.
       - Alice's client observes double coral ticks on M1, M2, and M6, but double gray ticks (NEVER coral) on M3, M4, M5! Disabled-period messages are **never retroactively disclosed**.

#### TC-PRIV-02: Repeated Disable and Re-enable Cycles
- **Scenario:** Repeat the disable/re-enable sequence across 3 consecutive cycles (Cycle 1: M1-M6, Cycle 2: M7-M10, Cycle 3: M11-M15).
- **Expectation:** Each re-enable establishes a new baseline at the latest private watermark. In all cycles, messages read while disabled permanently maintain `read_at IS NULL` and are never disclosed in subsequent peer receipts.

#### TC-PRIV-03: Repeated Enable Requests & Baseline Preservation
- **Scenario:** Bob disables receipts, reads messages up to seq 4, and re-enables receipts (`receipt_baseline_sequence` becomes 4). Bob's private read watermark advances to 5. Bob issues a duplicate `PATCH /v1/me/settings {"readReceiptsEnabled": true}`.
- **Expectation:** The transaction evaluates `read_receipts_enabled IS DISTINCT FROM true` (which matches 0 rows). `receipt_baseline_sequence` remains strictly at 4 and is **not reset** to 5. When Alice sends M6 and Bob reads it, progress is measured against baseline 4, preserving correct disclosure.

#### TC-CONC-04: Read and Disable Racing
- **Scenario:** Goroutine 1 calls `POST /v1/conversations/{id}/read` while Goroutine 2 concurrently calls `PATCH /v1/me/settings {"readReceiptsEnabled": false}`.
- **Expectation:** Both transactions acquire hierarchical locks starting with `user_settings` (`FOR UPDATE`). PostgreSQL serializes the execution. If Disable acquires the lock first, the read evaluates with `read_receipts_enabled = false` and emits 0 outbox events. If Read acquires the lock first, the receipt emits before the disable takes effect. Zero deadlock errors occur.

#### TC-CONC-05: Read and Re-Enable Racing
- **Scenario:** Goroutine 1 calls `POST /v1/conversations/{id}/read` while Goroutine 2 concurrently calls `PATCH /v1/me/settings {"readReceiptsEnabled": true}`.
- **Expectation:** Both transactions serialize on `user_settings`. If Re-Enable acquires the lock first, baseline is set to the prior private watermark, and the subsequent read discloses progress relative to that baseline. If Read acquires the lock first, it executes under disabled status (advancing only the private watermark), and the subsequent Re-Enable captures the newly advanced private watermark as the fresh baseline, guaranteeing zero leakage.

#### TC-CONC-06: Multiple Simultaneous Reads in One Conversation
- **Scenario:** User Bob opens conversation on two tabs simultaneously. Tab 1 issues read for sequence 10; Tab 2 concurrently issues read for sequence 12.
- **Expectation:** Both transactions serialize on `(conversation_id, user_id)` in `conversation_members`. The watermarks advance monotonically to 12. `messages.read_at` and outbox events commit with exact non-overlapping sequence intervals without duplicate receipt events.

#### TC-CONC-07: Reads in Different Conversations During Setting Change
- **Scenario:** Bob participates in Conversation A and Conversation B. Goroutine 1 reads in Conversation A, Goroutine 2 reads in Conversation B, and Goroutine 3 issues `PATCH /v1/me/settings {"readReceiptsEnabled": true}`.
- **Expectation:** Because Setting Update locks `user_settings` first, both conversation read transactions block until the setting change completes and baseline pinning is established. All conversations evaluate the newly pinned baselines consistently with zero deadlock.

#### TC-INT-01: Valid Conversation & Member Creation
- **Scenario:** Alice initiates direct conversation with Bob.
- **Expectation:** Conversation created with `user_a_id = LEAST(A, B)`, `user_b_id = GREATEST(A, B)`, `initiated_by = A`. Exactly two rows inserted into `conversation_members` (one for A, one for B). Both members have `last_read_sequence = 0`, `receipt_sequence = 0`, `receipt_baseline_sequence = 0`.

#### TC-INT-02: Third-Party Membership Insertion Rejection
- **Scenario:** Rogue query attempts `INSERT INTO conversation_members (conversation_id, user_id) VALUES (conv_alice_bob, charlie_id)`.
- **Expectation:** Database trigger `check_conversation_member_trigger` fires `BEFORE INSERT`, verifies Charlie is neither `user_a_id` nor `user_b_id`, and aborts transaction with `check_violation` (`"user is not authorized to join direct conversation"`). Zero third-party rows can ever exist in `conversation_members`.

#### TC-INT-03: Incomplete Conversation Creation Rejection (Exactly-Two-Member Invariant)
- **Scenario:** Transaction attempts to create a conversation between Alice and Bob but inserts only Alice into `conversation_members` before committing.
- **Expectation:** PostgreSQL deferred constraint trigger `trg_conversation_members_conv` evaluates at transaction commit, verifies `COUNT(*) == 1` (not 2), and aborts the transaction with `check_violation` (`"direct conversation must have exactly two members"`). The conversation cannot be committed in an incomplete state.

#### TC-INT-04: Independent Member Deletion Rejection
- **Scenario:** Rogue query attempts `DELETE FROM conversation_members WHERE conversation_id = conv_id AND user_id = bob_id`.
- **Expectation:** PostgreSQL deferred constraint trigger `trg_conversation_members_mem` evaluates at commit, detects `COUNT(*) == 1` for the active conversation, and aborts the transaction with `check_violation`. Members cannot be independently deleted from active conversations.

#### TC-INT-05: Non-Member Message Insertion Rejection
- **Scenario:** Attacker attempts direct database or API insertion: `INSERT INTO messages (conversation_id, sender_id, ...) VALUES (conv_alice_bob, charlie_id, ...)`.
- **Expectation:** Database composite foreign key `fk_messages_sender_member (conversation_id, sender_id) REFERENCES conversation_members (conversation_id, user_id)` evaluates immediately and rejects the insert with `foreign_key_violation`. Non-members cannot insert messages into conversations they do not belong to.

#### TC-INT-06: Invalid Initiator Rejection
- **Scenario:** Attacker attempts `INSERT INTO conversations (user_a_id, user_b_id, initiated_by) VALUES (A, B, C)`.
- **Expectation:** Database check constraint `CHECK (initiated_by = user_a_id OR initiated_by = user_b_id)` raises `check_violation` immediately.

#### TC-INT-07: Concurrent Conversation Creation Serialization
- **Scenario:** Alice and Bob concurrently initiate direct conversations with each other in separate goroutines.
- **Expectation:** Both transactions acquire deterministic pair advisory lock `pg_advisory_xact_lock(hash(LEAST(A,B), GREATEST(A,B)))`. Exactly one conversation is created; the second goroutine receives the existing conversation without error or duplicate keys.

#### TC-INT-08: Membership Consistency After User Deletion
- **Scenario:** User Bob deletes their account (`DELETE FROM users WHERE id = bob_id`).
- **Expectation:** PostgreSQL cascades deletion to `conversation_members`, `conversations`, and `messages`. Zero dangling references remain. Referential integrity is 100% preserved.

#### TC-INT-09: Conversation Identity Column Immutability
- **Scenario:** Attacker or errant query attempts `UPDATE conversations SET user_a_id = user_c_id WHERE id = conv_id` or mutates `id`, `type`, `user_b_id`, `initiated_by`, or `created_at`.
- **Expectation:** Database trigger `a0_enforce_conversation_immutability` evaluates `BEFORE UPDATE` and raises `feature_not_supported` (SQLSTATE `0A000`, `"cannot update immutable conversation identity columns"`). Identity columns are strictly immutable.

#### TC-INT-10: Conversation Member Identity Column Immutability & Migration Rejection
- **Scenario:** Attacker or errant query attempts to move a member between conversations (`UPDATE conversation_members SET conversation_id = conv_b_id WHERE user_id = member_id`) or mutates `user_id` or `joined_at`.
- **Expectation:** Database trigger `a0_enforce_conversation_member_immutability` evaluates `BEFORE UPDATE` and raises `feature_not_supported` (SQLSTATE `0A000`, `"cannot update immutable conversation member identity columns"`). Moving members across conversations is strictly prevented.

#### TC-INT-11: Conversation Member Sequence Invariant CHECK Constraints
- **Scenario:** Queries attempt to set invalid sequence watermarks:
  1. Negative sequences: `last_read_sequence = -1`, `receipt_sequence = -1`, or `receipt_baseline_sequence = -1`.
  2. Receipt sequence exceeds read sequence: `receipt_sequence = 6, last_read_sequence = 5`.
  3. Receipt baseline exceeds read sequence: `receipt_baseline_sequence = 6, last_read_sequence = 5`.
- **Expectation:** PostgreSQL raises `check_violation` (SQLSTATE `23514`) for all 5 sub-cases. The database strictly enforces the 5 sequence invariants.

#### TC-INT-12: Runtime Role Column-Level Permission Audit (`holoraa_app`)
- **Scenario:** Queries executed as runtime database user `holoraa_app`:
  1. Attempt `UPDATE conversations SET user_a_id = ...`.
  2. Attempt `UPDATE conversation_members SET user_id = ...`.
  3. Attempt `DELETE FROM conversation_members WHERE ...`.
  4. Attempt `UPDATE conversations SET status = 'accepted', last_message_sequence = 12 ...`.
  5. Attempt `UPDATE conversation_members SET last_read_sequence = 12 ...`.
- **Expectation:**
  - Sub-cases 1, 2, and 3 fail immediately with `42501 permission denied`.
  - Sub-cases 4 and 5 succeed. The application role is strictly restricted to mutable columns.

#### TC-REC-04: Option B Incoming-Message Gated Read Receipts & Own-Message Read Suppression
- **Scenario:** Alice sends Msg 1 (seq 1) and Msg 2 (seq 2). Bob sends Msg 3 (seq 3).
  1. Alice reads up to Msg 3.
  2. Alice performs a duplicate read of Msg 3.
  3. Alice sends Msg 4 (seq 4) and reads up to Msg 4 (her own message).
  4. Bob disables receipts, Alice sends Msg 5 (seq 5), and Bob reads Msg 5.
  5. Bob re-enables receipts, sends repeated enable PATCH, Alice sends Msg 6 (seq 6), and Bob reads Msg 6.
- **Expectation:**
  1. Reading Msg 3 emits exactly 1 `message.read` outbox event with `fromSequenceNum = 3, sequenceNum = 3`. Alice's own messages (1, 2) remain `read_at IS NULL`.
  2. Duplicate read of Msg 3 emits 0 outbox events.
  3. Reading own message 4 advances Alice's private watermark (`last_read_sequence = 4`), leaves `receipt_sequence = 3`, marks 0 messages read, and emits 0 outbox events. CHECK constraints are satisfied.
  4. Bob reading while disabled advances private watermark to 5, leaves receipt sequence at 0, and emits 0 outbox events.
  5. Re-enabling pins baseline to 5. Repeated enable call leaves baseline at 5. Reading Msg 6 emits 1 outbox event with `fromSequenceNum = 6, sequenceNum = 6`. Msg 5 permanently retains `read_at IS NULL` (zero retroactive disclosure).

#### TC-CONC-01: Concurrent Block and Direct Conversation Creation (Nonexistent Conversation)
- **Scenario:** Alice and Bob have no existing conversation. In Goroutine 1, Alice calls `POST /v1/conversations/direct` with Bob. Simultaneously in Goroutine 2, Bob calls `POST /v1/users/alice/block`.
- **Expectation:** Both transactions acquire the deterministic 64-bit pair advisory lock `pg_advisory_xact_lock(hash(LEAST(A,B), GREATEST(A,B)))`. If the block transaction acquires the lock first, the block commits. When the conversation transaction executes, its block check detects the block and fails closed with HTTP 403 Forbidden (`RELATIONSHIP_BLOCKED`), creating zero conversation rows.

#### TC-CONC-02: Concurrent Block and Message Send Serialization (Existing Conversation)
- **Scenario:** Alice and Bob have an existing conversation. In Goroutine 1, Bob calls `POST /v1/users/alice/block`. Simultaneously in Goroutine 2, Alice posts a message to Bob (`POST /v1/conversations/{id}/messages`).
- **Expectation:** Both transactions serialize on the pair advisory lock and conversation row lock (`FOR UPDATE`). If the block transaction commits first, the message transaction blocks, evaluates updated block status upon release, and aborts with HTTP 403 Forbidden (`RELATIONSHIP_BLOCKED`). Under zero concurrency interleavings can a message bypass a committed block.

#### TC-CONC-03: Concurrent Duplicate Message Submission (Idempotency Under Load)
- **Scenario:** Alice initiates 10 concurrent HTTP requests (`POST /v1/conversations/{id}/messages`) across 10 goroutines, all submitting the exact same payload with identical `client_message_id = "test-uuid"`.
- **Expectation:**
  - The first transaction acquires the conversation row lock, checks idempotency (not found), increments `last_message_sequence` from $N$ to $N+1$, and inserts the message with `sequence_num = N+1` and the outbox event.
  - The subsequent 9 concurrent transactions acquire the lock in turn. At Step 3 (idempotency check), each detects the pre-existing row with `(conversation_id, sender_id, client_message_id)`.
  - All 9 transactions return the original message immediately without incrementing `conversations.last_message_sequence` and without inserting duplicate outbox events.
  - Verification:
    1. Exactly 1 row exists in `messages` with `client_message_id = "test-uuid"`.
    2. `conversations.last_message_sequence` equals exactly $N+1$.
    3. Exactly 1 outbox event exists for this message.
    4. All 10 callers receive successful responses (HTTP 201/200) containing identical message ID, content, and sequence number. Zero 500 errors or deadlocks.

#### TC-CONC-04: Multi-Session Concurrent Settings Toggle vs Read Transaction
- **Scenario A (Fresh Statement Snapshot on False-to-True Re-enable):**
  - Session 1 begins a read transaction, locks `user_settings` (Level 1), locks `conversation_members` (Level 2), and advances `last_read_sequence` from $N$ to $N+k$.
  - Concurrently, Session 2 attempts a false-to-true re-enable (`read_receipts_enabled = true`). Session 2 executes `SELECT ... FOR UPDATE` on `user_settings` and blocks waiting for Session 1.
  - Session 1 commits after a simulated delay (e.g. 800ms).
  - Session 2 acquires the lock, detects previous value was false, and executes the separate SQL statement `UPDATE conversation_members SET receipt_baseline_sequence = last_read_sequence`.
  - Under `READ COMMITTED`, this separate statement obtains a fresh statement snapshot and reads the newly committed `last_read_sequence = N+k`.
  - **Expectation:** `receipt_baseline_sequence` is pinned exactly to $N+k$ (the newly committed value), eliminating stale-snapshot pinning.
- **Scenario B (Concurrent Read During Receipt Disable):**
  - Session 1 begins a setting transaction to disable read receipts (`false`), holding the Level 1 row lock.
  - Concurrently, Session 2 initiates a read transaction on an unread incoming message.
  - Session 2 blocks on the Level 1 lock, then evaluates against the freshly committed setting (`read_receipts_enabled = false`).
  - **Expectation:** Session 2 advances the private read watermark (`last_read_sequence`) for unread badge tracking, but marks zero messages in `messages.read_at` and emits zero `message.read` outbox events.
- **Scenario C (Two Concurrent Setting Updates):**
  - Session 1 requests `read_receipts_enabled = true` while Session 2 concurrently requests `read_receipts_enabled = false`.
  - Both serialize on the Level 1 `user_settings` row lock.
  - **Expectation:** Transactions serialize cleanly without deadlocks. Final setting state is deterministic based on commit order, and baseline is pinned if and only if the winning transaction executed a real false-to-true transition. Repeated enable requests (`true` $\to$ `true`) never reset the baseline.

#### TC-CONC-05: Multi-Session Concurrent Reads in Same Conversation
- **Scenario:** Two concurrent client sessions for the same user (e.g. mobile app and web browser) submit read watermark updates for the same conversation.
- **Expectation:** Both transactions acquire Level 1 and Level 2 row locks. Transactions serialize cleanly; `last_read_sequence` advances monotonically without lost updates or race conditions.

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
