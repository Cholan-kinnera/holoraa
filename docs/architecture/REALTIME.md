# Realtime Contract — Holoraa (v2)

- **Purpose:** The realtime plan: connection rules, the event catalogue, and how clients reconnect.
- **Owner:** TODO(owner): Realtime Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Milestone M6 adds only `ping` and `pong`, behind a flag that is off by default. Every other event in this document is planned and needs the auth design first.

---

## 1. Transport

- WebSocket via `github.com/coder/websocket` (decided; pinned at M6 after review).
- The server checks the `Origin` header against an allowlist **before** the upgrade. Origin verification is never disabled (AGENTS.md).
- Connections are accepted only when the realtime flag is on. The flag is off by default.
- Every inbound frame has a size limit. Limits (frame size, queue capacity, deadlines) are decided at M6 under D6.

## 2. Authentication

`TODO(owner): authentication design for WebSocket connections.` Until it is approved:
- Only `ping` and `pong` are accepted.
- No user data flows over the socket.

Protected sockets fail closed. A connection that cannot be authorised is closed without any event.

## 3. Contract format

Events are defined as JSON Schema in `contracts/`. Each message has the shape:

```json
{ "type": "<event name>", "id": "<client or server id>", "data": { } }
```

The exact envelope is confirmed at M4 (D9). Events that are not in the schema are rejected.

## 4. Event catalogue

| Event | Direction | Milestone | Status |
|---|---|---|---|
| `ping` | client → server | M6 | Planned at M6 |
| `pong` | server → client | M6 | Planned at M6 |
| `presence.update` | server → client | Phase 1 | Planned; presence storage is `TODO(owner)` |
| `typing.start`, `typing.stop` | client → server | Phase 1 | Planned |
| `message.send` | client → server | Phase 1 | Planned; depends on auth |
| `message.new` | server → client | Phase 1 | Planned |
| `receipt.read` | client → server | Phase 1 | Planned |

The legacy catalogue used Socket.io event names with dots and colons (`message:send`). The v2 naming (dot-separated) is a proposal, to be confirmed at M4.

## 5. Fan-out

The foundation runs one backend instance, so events are delivered directly to connected sockets. Multi-instance fan-out (for example, through Redis pub/sub) is deferred until the owner approves a feature that needs it (see [ARCHITECTURE.md](ARCHITECTURE.md)).

## 6. Reconnection and catch-up

Planned for Phase 1, not M6.

1. The client reconnects with exponential backoff. The delays are `TODO(owner)`.
2. After reconnecting, the client fetches missed messages over HTTP: `GET /v1/conversations/{id}/messages?after={last_seen_id}`.
3. The client merges the results and then sends any buffered outbound messages. Each outbound message carries a client ID so the server can ignore duplicates.

## 7. Limits and abuse

- Per-socket message rate limit: `TODO(owner)`.
- Connection rate limit per client: `TODO(owner)`.
- Oversized or malformed frames close the connection with an error event, not a crash.

See [THREAT_MODEL.md](../security/THREAT_MODEL.md) for the denial-of-service analysis.
