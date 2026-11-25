// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoundedDeduplicator,
  calculateBackoffWithJitter,
  generateUuid,
  isValidEnvelope,
  resolveWebSocketUrl,
  useRealtimeSocket,
  type UseRealtimeSocketOptions,
  type UseRealtimeSocketReturn,
} from "./useRealtimeSocket";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock WebSocket implementation for deterministic unit testing
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  protocols: string[];
  readyState: number = WebSocket.CONNECTING;
  sentFrames: string[] = [];

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string, protocols: string | string[] = []) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : [protocols];
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentFrames.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }

  // Test helpers to trigger socket events
  mockOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  mockMessage(data: string | object) {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  mockError() {
    this.onerror?.(new Event("error"));
  }
}

function getWs(index = 0): MockWebSocket {
  const ws = MockWebSocket.instances[index];
  if (!ws) throw new Error(`MockWebSocket at index ${index} not found`);
  return ws;
}

function getSentFrame(ws: MockWebSocket, index = 0): string {
  const frame = ws.sentFrames[index];
  if (frame === undefined) throw new Error(`Sent frame at index ${index} not found`);
  return frame;
}

// Test harness component to capture hook return
let latestHookResult: UseRealtimeSocketReturn | null = null;

function TestComponent({ options }: { options?: UseRealtimeSocketOptions }) {
  const result = useRealtimeSocket(options);
  useEffect(() => {
    latestHookResult = result;
  });
  return null;
}

describe("useRealtimeSocket unit tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    latestHookResult = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("calculates exponential backoff with full jitter within bounds", () => {
    const randomHalf = () => 0.5;
    // attempt 0: max = 1000 -> 0.5 * 1001 = 500
    expect(calculateBackoffWithJitter(0, 1000, 30000, randomHalf)).toBe(500);
    // attempt 1: max = 2000 -> 0.5 * 2001 = 1000
    expect(calculateBackoffWithJitter(1, 1000, 30000, randomHalf)).toBe(1000);
    // attempt 2: max = 4000 -> 0.5 * 4001 = 2000
    expect(calculateBackoffWithJitter(2, 1000, 30000, randomHalf)).toBe(2000);
    // attempt 5: max = 30000 (capped) -> 0.5 * 30001 = 15000
    expect(calculateBackoffWithJitter(5, 1000, 30000, randomHalf)).toBe(15000);

    // Random bounds check: 100 trials
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffWithJitter(3, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });

  it("enforces BoundedDeduplicator limits and deduplication", () => {
    const dedup = new BoundedDeduplicator(3);
    expect(dedup.add("msg-1")).toBe(true);
    expect(dedup.add("msg-2")).toBe(true);
    expect(dedup.add("msg-1")).toBe(false); // duplicate!
    expect(dedup.size).toBe(2);

    expect(dedup.add("msg-3")).toBe(true);
    expect(dedup.size).toBe(3);

    // Adding 4th item evicts msg-1 (oldest)
    expect(dedup.add("msg-4")).toBe(true);
    expect(dedup.size).toBe(3);
    expect(dedup.has("msg-1")).toBe(false); // evicted
    expect(dedup.has("msg-2")).toBe(true);
    expect(dedup.has("msg-3")).toBe(true);
    expect(dedup.has("msg-4")).toBe(true);
  });

  it("validates event envelopes accurately", () => {
    expect(isValidEnvelope(null)).toBe(false);
    expect(isValidEnvelope("string")).toBe(false);
    expect(isValidEnvelope({})).toBe(false);
    expect(isValidEnvelope({ v: 2, id: "123", type: "ping", timestamp: "now", payload: {} })).toBe(false); // wrong version
    expect(isValidEnvelope({ v: 1, id: "", type: "ping", timestamp: "now", payload: {} })).toBe(false); // empty id
    expect(isValidEnvelope({ v: 1, id: "123", type: "", timestamp: "now", payload: {} })).toBe(false); // empty type
    expect(isValidEnvelope({ v: 1, id: "123", type: "ping", timestamp: "now", payload: null })).toBe(false); // null payload
    expect(isValidEnvelope({ v: 1, id: "123", type: "ping", timestamp: "now", payload: {} })).toBe(true);
  });

  it("connects successfully using acquired ticket and required subprotocols", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "test-ticket-xyz-123",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    expect(latestHookResult?.state).toBe("ACQUIRING_TICKET");

    // Allow issueTicket promise to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(latestHookResult?.state).toBe("CONNECTING");
    expect(MockWebSocket.instances.length).toBe(1);

    const ws = getWs(0);
    expect(ws.url).toBe("ws://127.0.0.1:8080/v1/realtime/ws");
    expect(ws.protocols).toEqual(["holoraa", "holoraa-ticket.test-ticket-xyz-123"]);

    // Complete handshake
    act(() => {
      ws.mockOpen();
    });

    expect(latestHookResult?.state).toBe("CONNECTED");
    expect(latestHookResult?.error).toBeNull();
  });

  it("handles ticket acquisition failure and schedules reconnect with backoff", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: false,
      message: "Network error requesting ticket",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestHookResult?.state).toBe("RECONNECTING");
    expect(latestHookResult?.error).toBe("Network error requesting ticket");
    expect(MockWebSocket.instances.length).toBe(0);

    // Fast-forward past backoff timer to trigger retry
    issueTicket.mockResolvedValueOnce({
      ok: true,
      ticket: "ticket-second-try",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("stops reconnecting on session expiration", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: false,
      expired: true,
      message: "Your session has ended. Sign in again to continue.",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestHookResult?.state).toBe("DISCONNECTED");
    expect(latestHookResult?.error).toBe("Your session has ended. Sign in again to continue.");

    // Advance time: should NOT reconnect
    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(issueTicket).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("receives connection.ready and updates user metadata and active conversations", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "ready-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    // Server sends connection.ready
    act(() => {
      ws.mockMessage({
        v: 1,
        id: generateUuid(),
        type: "connection.ready",
        timestamp: "2026-11-18T00:00:00Z",
        payload: {
          userId: "user-12345",
          serverTime: "2026-11-18T00:00:00Z",
          activeConversations: ["conv-1", "conv-2"],
        },
      });
    });

    expect(latestHookResult?.userId).toBe("user-12345");
    expect(latestHookResult?.serverTime).toBe("2026-11-18T00:00:00Z");
    expect(latestHookResult?.activeConversations).toEqual(["conv-1", "conv-2"]);
  });

  it("dispatches typed events to subscribers and automatically acknowledges delivery for peer messages", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "ack-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });
    const acknowledgeDelivery = vi.fn().mockResolvedValue({ ok: true });

    act(() => {
      root.render(
        <TestComponent
          options={{
            currentUserId: "alice-id",
            issueTicket,
            acknowledgeDelivery,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    const receivedMessages: unknown[] = [];
    let unsubscribe: () => void = () => {};

    act(() => {
      unsubscribe = latestHookResult!.subscribe("message.created", (payload) => {
        receivedMessages.push(payload);
      });
    });

    // 1. Incoming message from peer (bob-id)
    const peerMessage = {
      v: 1,
      id: generateUuid(),
      type: "message.created",
      timestamp: "2026-11-18T00:00:00Z",
      payload: {
        messageId: "msg-bob-1",
        conversationId: "conv-1",
        senderId: "bob-id",
        clientMessageId: generateUuid(),
        content: "Hello Alice!",
        sequenceNum: 1,
        createdAt: "2026-11-18T00:00:00Z",
      },
    };

    act(() => {
      ws.mockMessage(peerMessage);
    });

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toEqual(peerMessage.payload);

    // Auto-ack verification:
    // 1. Sent frame over WebSocket
    expect(ws.sentFrames.length).toBe(1);
    const sentAck = JSON.parse(getSentFrame(ws, 0));
    expect(sentAck.type).toBe("message.delivered");
    expect(sentAck.payload).toEqual({
      conversationId: "conv-1",
      messageId: "msg-bob-1",
    });

    // 2. Called Server Action acknowledgeDelivery
    expect(acknowledgeDelivery).toHaveBeenCalledWith("conv-1", "msg-bob-1");

    // 2. Duplicate incoming message: should be suppressed
    act(() => {
      ws.mockMessage(peerMessage);
    });

    // No duplicate dispatch or duplicate ack
    expect(receivedMessages.length).toBe(1);
    expect(ws.sentFrames.length).toBe(1);
    expect(acknowledgeDelivery).toHaveBeenCalledTimes(1);

    // 3. User's own message (alice-id): should NOT be auto-acknowledged
    const ownMessage = {
      v: 1,
      id: generateUuid(),
      type: "message.created",
      timestamp: "2026-11-18T00:00:00Z",
      payload: {
        messageId: "msg-alice-own",
        conversationId: "conv-1",
        senderId: "alice-id", // Same as currentUserId
        clientMessageId: generateUuid(),
        content: "My own message",
        sequenceNum: 2,
        createdAt: "2026-11-18T00:00:00Z",
      },
    };

    act(() => {
      ws.mockMessage(ownMessage);
    });

    expect(receivedMessages.length).toBe(2);
    // Still only 1 frame sent over WS and 1 acknowledgeDelivery call (none added for own message)
    expect(ws.sentFrames.length).toBe(1);
    expect(acknowledgeDelivery).toHaveBeenCalledTimes(1);

    // 4. Unsubscribe verification
    act(() => {
      unsubscribe();
    });

    act(() => {
      ws.mockMessage({
        v: 1,
        id: generateUuid(),
        type: "message.created",
        timestamp: "2026-11-18T00:00:00Z",
        payload: {
          messageId: "msg-bob-2",
          conversationId: "conv-1",
          senderId: "bob-id",
          clientMessageId: generateUuid(),
          content: "Second message",
          sequenceNum: 3,
          createdAt: "2026-11-18T00:00:00Z",
        },
      });
    });

    // Handler not called after unsubscribe
    expect(receivedMessages.length).toBe(2);
  });

  it("handles heartbeat ping/pong and detects missed pong timeout", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "hb-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            heartbeatIntervalMs: 30000,
            heartbeatTimeoutMs: 10000,
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    expect(ws.sentFrames.length).toBe(0);

    // Fast-forward 30s to trigger heartbeat ping
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(ws.sentFrames.length).toBe(1);
    const ping = JSON.parse(getSentFrame(ws, 0));
    expect(ping.type).toBe("ping");

    // Server responds with pong
    act(() => {
      ws.mockMessage({
        v: 1,
        id: generateUuid(),
        type: "pong",
        timestamp: "2026-11-18T00:00:30Z",
        payload: {},
      });
    });

    // Connection remains healthy
    expect(latestHookResult?.state).toBe("CONNECTED");

    // Fast-forward another 30s for 2nd ping
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(ws.sentFrames.length).toBe(2);

    // This time, server does NOT respond with pong! Fast forward 10s (heartbeat timeout)
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Socket was closed due to missed pong
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(latestHookResult?.state).toBe("RECONNECTING");
  });

  it("resets retry attempt counter only after stable connection threshold", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "stable-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            stableConnectionThresholdMs: 5000,
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    // Advance 6000ms (> 5000ms threshold)
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Connection closes now
    act(() => {
      ws.close(1006, "Abnormal closure");
    });

    expect(latestHookResult?.state).toBe("RECONNECTING");

    // Since it was stable, next reconnect attempt starts from base backoff
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("cleans up active socket and timers on unmount", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "unmount-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Unmount
    act(() => {
      root.unmount();
    });

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("provides functional outbound frame helpers: sendMessage, markDelivered, markRead, sendTyping", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "helper-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    // 1. sendMessage
    const sentMsgOk = latestHookResult!.sendMessage("conv-1", "client-msg-uuid", "Hello world");
    expect(sentMsgOk).toBe(true);
    const sentMsgFrame = JSON.parse(getSentFrame(ws, 0));
    expect(sentMsgFrame.type).toBe("message.send");
    expect(sentMsgFrame.payload).toEqual({
      conversationId: "conv-1",
      clientMessageId: "client-msg-uuid",
      content: "Hello world",
    });

    // 2. markDelivered
    const sentDelivOk = latestHookResult!.markDelivered("conv-1", "msg-uuid");
    expect(sentDelivOk).toBe(true);
    const sentDelivFrame = JSON.parse(getSentFrame(ws, 1));
    expect(sentDelivFrame.type).toBe("message.delivered");
    expect(sentDelivFrame.payload).toEqual({
      conversationId: "conv-1",
      messageId: "msg-uuid",
    });

    // 3. markRead
    const sentReadOk = latestHookResult!.markRead("conv-1", "msg-uuid");
    expect(sentReadOk).toBe(true);
    const sentReadFrame = JSON.parse(getSentFrame(ws, 2));
    expect(sentReadFrame.type).toBe("message.read");
    expect(sentReadFrame.payload).toEqual({
      conversationId: "conv-1",
      messageId: "msg-uuid",
    });

    // 4. sendTyping (started and stopped)
    latestHookResult!.sendTyping("conv-1", true);
    const typingStartedFrame = JSON.parse(getSentFrame(ws, 3));
    expect(typingStartedFrame.type).toBe("typing.started");

    latestHookResult!.sendTyping("conv-1", false);
    const typingStoppedFrame = JSON.parse(getSentFrame(ws, 4));
    expect(typingStoppedFrame.type).toBe("typing.stopped");
  });

  it("handles manual disconnect and reconnect", async () => {
    const issueTicket = vi.fn().mockResolvedValue({
      ok: true,
      ticket: "manual-ticket",
      wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
    });

    act(() => {
      root.render(
        <TestComponent
          options={{
            issueTicket,
            webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
          }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const ws = getWs(0);
    act(() => {
      ws.mockOpen();
    });

    expect(latestHookResult?.state).toBe("CONNECTED");

    // Explicit disconnect
    act(() => {
      latestHookResult!.disconnect();
    });

    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(latestHookResult?.state).toBe("DISCONNECTED");

    // Fast forward: should NOT auto-reconnect
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });
    expect(issueTicket).toHaveBeenCalledTimes(1);

    // Explicit reconnect
    act(() => {
      latestHookResult!.reconnect();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("handles React StrictMode without keeping duplicate active sockets", async () => {
    let ticketCounter = 0;
    const issueTicket = vi.fn().mockImplementation(async () => {
      ticketCounter++;
      return {
        ok: true,
        ticket: `strict-ticket-${ticketCounter}`,
        wsUrl: "ws://127.0.0.1:8080/v1/realtime/ws",
      };
    });

    act(() => {
      root.render(
        <StrictMode>
          <TestComponent
            options={{
              issueTicket,
              webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
            }}
          />
        </StrictMode>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // In StrictMode, initial effect runs, cleans up, and remounts.
    // Verify that at most one socket is open and any older instances are closed.
    const openSockets = MockWebSocket.instances.filter((s) => s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN);
    expect(openSockets.length).toBe(1);

    // Open the active socket
    act(() => {
      openSockets[0]?.mockOpen();
    });

    expect(latestHookResult?.state).toBe("CONNECTED");
  });

  describe("Same-Origin Relative WebSocket URL Resolution", () => {
    it("resolves relative path to ws:// on HTTP page origins", () => {
      const url = resolveWebSocketUrl("/v1/realtime/ws", {
        protocol: "http:",
        host: "localhost:3000",
      });
      expect(url).toBe("ws://localhost:3000/v1/realtime/ws");
    });

    it("resolves relative path to wss:// on HTTPS page origins", () => {
      const url = resolveWebSocketUrl("/v1/realtime/ws", {
        protocol: "https:",
        host: "holoraa.com",
      });
      expect(url).toBe("wss://holoraa.com/v1/realtime/ws");
    });

    it("preserves explicit absolute ws:// and wss:// URLs", () => {
      const explicitWs = "ws://127.0.0.1:8080/v1/realtime/ws";
      const explicitWss = "wss://custom.socket.server/ws";
      expect(resolveWebSocketUrl(explicitWs, { protocol: "http:", host: "localhost:3000" })).toBe(explicitWs);
      expect(resolveWebSocketUrl(explicitWss, { protocol: "http:", host: "localhost:3000" })).toBe(explicitWss);
    });

    it("defaults to /v1/realtime/ws when url is null or empty", () => {
      expect(resolveWebSocketUrl(null, { protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/v1/realtime/ws");
      expect(resolveWebSocketUrl("", { protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/v1/realtime/ws");
    });

    it("connects to resolved same-origin URL when issueTicket returns relative wsUrl", async () => {
      const issueTicket = vi.fn().mockResolvedValue({
        ok: true,
        ticket: "ticket-relative-1",
        wsUrl: "/v1/realtime/ws",
      });

      act(() => {
        root.render(
          <TestComponent
            options={{
              issueTicket,
              webSocketFactory: (url, protocols) => new MockWebSocket(url, protocols) as unknown as WebSocket,
            }}
          />,
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(MockWebSocket.instances.length).toBe(1);
      const socket = MockWebSocket.instances[0]!;
      // In JSDOM, window.location.host is localhost (or similar), protocol is http:
      expect(socket.url).toMatch(/^ws:\/\/localhost(:\d+)?\/v1\/realtime\/ws$/);
      expect(socket.protocols).toContain("holoraa-ticket.ticket-relative-1");
    });
  });
});
