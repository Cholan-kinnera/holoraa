# ADR 0005: LiveKit for WebRTC Audio, Video, and Screen Sharing

- **Status:** Accepted (legacy decision, 2026-10-20). Deferred for v2 under AGENTS.md. **Owner to confirm** whether it remains Accepted, is amended, or is superseded when calls are scheduled.
- **Date:** 2026-10-20 (legacy)
- **Deciders:** Lead Architect (legacy)
- **Consulted:** Solo Maintainer (legacy)
- **Carried into v2:** 2026-10-25, text unchanged apart from this header. Not re-decided for v2.

---

## Context and Problem Statement
Holoraa includes voice/video calling, group rooms, and screen sharing. Implementing a WebRTC media stack requires deciding between full mesh P2P, a custom SFU (Selective Forwarding Unit), or a modern media server infrastructure.

## Decision Drivers
- Group calling performance without exponential upload bandwidth costs on client devices.
- IP privacy (preventing direct peer-to-peer IP address leakage).
- Developer-friendly client SDKs for Next.js and future mobile apps (React Native).

## Considered Options
1. **LiveKit (Self-hosted or Cloud SFU)**
2. Custom WebRTC Full Mesh P2P
3. Janus / Mediasoup (Low-level media engines)
4. Agora / Daily.co (Proprietary vendor APIs)

## Decision Outcome
Chosen option: **LiveKit**, because:
- Open-source, production-proven SFU written in Go with low latency and automated simulcast/dynacast.
- Provides excellent TypeScript client libraries (`@livekit/components-react`).
- Protects user privacy by routing all media through the SFU instead of exposing participant IP addresses.
- Can be self-hosted via Docker or used with LiveKit Cloud without changing client code.

### Consequences
- Positive: High-quality audio/video scaling to 50+ participants; developer velocity; screen share support.
- Negative: Requires deploying and managing an SFU infrastructure or paying for cloud minutes when voice features launch in Phase 5.
