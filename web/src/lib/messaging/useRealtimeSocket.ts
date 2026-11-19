"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  issueRealtimeTicketAction,
  markMessageDeliveredAction,
} from "@/app/app/messages/actions";
import {
  REALTIME_SUBPROTOCOL_BASE,
  REALTIME_TICKET_SUBPROTOCOL_PREFIX,
  type ConnectionReadyPayload,
  type InboundFrame,
  type MessageCreatedPayload,
  type RealtimeConnectionState,
  type RealtimeEnvelope,
  type RealtimeEventMap,
  type RealtimeEventType,
} from "./realtime-types";

/** Generates an RFC 4122 v4 UUID with fallback for test environments. */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Calculates exponential backoff with full jitter: random(0, min(maxMs, baseMs * 2^attempt)) */
export function calculateBackoffWithJitter(
  attempt: number,
  baseMs = 1000,
  maxMs = 30000,
  randomFn = Math.random,
): number {
  const cap = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  return Math.floor(randomFn() * (cap + 1));
}

/** Runtime event envelope validator matching contracts/events/*.json */
export function isValidEnvelope(obj: unknown): obj is RealtimeEnvelope {
  if (!obj || typeof obj !== "object") return false;
  const env = obj as Record<string, unknown>;
  if (env.v !== 1) return false;
  if (typeof env.id !== "string" || env.id.trim().length === 0) return false;
  if (typeof env.type !== "string" || env.type.trim().length === 0) return false;
  if (typeof env.timestamp !== "string" || env.timestamp.trim().length === 0) return false;
  if (!env.payload || typeof env.payload !== "object") return false;
  return true;
}

/** Bounded FIFO deduplication set of maximum 500 items. */
export class BoundedDeduplicator {
  private readonly maxItems: number;
  private readonly idSet = new Set<string>();
  private readonly idQueue: string[] = [];

  constructor(maxItems = 500) {
    this.maxItems = maxItems;
  }

  has(id: string): boolean {
    return this.idSet.has(id);
  }

  add(id: string): boolean {
    if (this.idSet.has(id)) {
      return false;
    }
    this.idSet.add(id);
    this.idQueue.push(id);
    if (this.idQueue.length > this.maxItems) {
      const oldest = this.idQueue.shift();
      if (oldest !== undefined) {
        this.idSet.delete(oldest);
      }
    }
    return true;
  }

  clear(): void {
    this.idSet.clear();
    this.idQueue.length = 0;
  }

  get size(): number {
    return this.idSet.size;
  }
}

export interface UseRealtimeSocketOptions {
  enabled?: boolean;
  currentUserId?: string | null;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  stableConnectionThresholdMs?: number;
  autoAcknowledgeDelivery?: boolean;
  /** Injectable ticket issuer (defaults to issueRealtimeTicketAction). */
  issueTicket?: () => Promise<{
    ok: boolean;
    ticket?: string;
    wsUrl?: string;
    message?: string;
    expired?: boolean;
  }>;
  /** Injectable delivery acknowledgment (defaults to markMessageDeliveredAction). */
  acknowledgeDelivery?: (conversationId: string, messageId: string) => Promise<unknown>;
  /** Injectable WebSocket constructor for testing or custom environments. */
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  onEvent?: (event: RealtimeEnvelope) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: RealtimeConnectionState) => void;
}

export type GenericEventHandler = (
  payload: unknown,
  envelope: RealtimeEnvelope<unknown>,
) => void;

export type RealtimeEventHandler<K extends RealtimeEventType> = (
  payload: RealtimeEventMap[K],
  envelope: RealtimeEnvelope<RealtimeEventMap[K]>,
) => void;

export interface UseRealtimeSocketReturn {
  state: RealtimeConnectionState;
  error: string | null;
  userId: string | null;
  serverTime: string | null;
  activeConversations: string[];
  subscribe: <K extends RealtimeEventType>(
    type: K,
    handler: RealtimeEventHandler<K>,
  ) => () => void;
  sendMessage: (conversationId: string, clientMessageId: string, content: string) => boolean;
  markDelivered: (conversationId: string, messageId: string) => boolean;
  markRead: (conversationId: string, messageId: string) => boolean;
  sendTyping: (conversationId: string, isTyping: boolean) => boolean;
  reconnect: () => void;
  disconnect: () => void;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10000;
const DEFAULT_BASE_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30000;
const DEFAULT_STABLE_CONNECTION_THRESHOLD_MS = 5000;

export function useRealtimeSocket(options: UseRealtimeSocketOptions = {}): UseRealtimeSocketReturn {
  const {
    enabled = true,
    currentUserId = null,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    baseReconnectDelayMs = DEFAULT_BASE_RECONNECT_DELAY_MS,
    maxReconnectDelayMs = DEFAULT_MAX_RECONNECT_DELAY_MS,
    stableConnectionThresholdMs = DEFAULT_STABLE_CONNECTION_THRESHOLD_MS,
    autoAcknowledgeDelivery = true,
    issueTicket = issueRealtimeTicketAction,
    acknowledgeDelivery = markMessageDeliveredAction,
    webSocketFactory,
    onEvent,
    onError,
    onStateChange,
  } = options;

  const [state, setState] = useState<RealtimeConnectionState>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [activeConversations, setActiveConversations] = useState<string[]>([]);

  // Refs for stable identity across renders
  const stateRef = useRef<RealtimeConnectionState>("IDLE");
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<GenericEventHandler>>>(new Map());
  const deduplicatorRef = useRef<BoundedDeduplicator>(new BoundedDeduplicator(500));
  const reconnectAttemptRef = useRef(0);
  const generationRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const isManuallyDisconnectedRef = useRef(false);

  // Timers
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableConnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callbacks ref to prevent stale closures
  const callbacksRef = useRef({
    onEvent,
    onError,
    onStateChange,
    issueTicket,
    acknowledgeDelivery,
    webSocketFactory,
    currentUserId,
    autoAcknowledgeDelivery,
  });

  useEffect(() => {
    callbacksRef.current = {
      onEvent,
      onError,
      onStateChange,
      issueTicket,
      acknowledgeDelivery,
      webSocketFactory,
      currentUserId,
      autoAcknowledgeDelivery,
    };
  });

  const updateState = useCallback((newState: RealtimeConnectionState, newError: string | null = null) => {
    stateRef.current = newState;
    setState(newState);
    if (newError !== undefined) {
      setError(newError);
    }
    callbacksRef.current.onStateChange?.(newState);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatIntervalTimerRef.current !== null) {
      clearInterval(heartbeatIntervalTimerRef.current);
      heartbeatIntervalTimerRef.current = null;
    }
    if (heartbeatTimeoutTimerRef.current !== null) {
      clearTimeout(heartbeatTimeoutTimerRef.current);
      heartbeatTimeoutTimerRef.current = null;
    }
    if (stableConnectionTimerRef.current !== null) {
      clearTimeout(stableConnectionTimerRef.current);
      stableConnectionTimerRef.current = null;
    }
  }, []);

  const cleanupSocket = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }, [clearTimers]);

  // Forward declaration for mutual recursion
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const handleIncomingMessage = useCallback((raw: string) => {
    // Reset heartbeat timeout timer on any server activity
    if (heartbeatTimeoutTimerRef.current !== null) {
      clearTimeout(heartbeatTimeoutTimerRef.current);
      heartbeatTimeoutTimerRef.current = null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Ignore unparseable frames safely
      return;
    }

    if (!isValidEnvelope(parsed)) {
      return;
    }

    const envelope = parsed;

    // Handle connection.ready
    if (envelope.type === "connection.ready") {
      const readyPayload = envelope.payload as ConnectionReadyPayload;
      if (readyPayload.userId) {
        setUserId(readyPayload.userId);
      }
      if (readyPayload.serverTime) {
        setServerTime(readyPayload.serverTime);
      }
      if (Array.isArray(readyPayload.activeConversations)) {
        setActiveConversations(readyPayload.activeConversations);
      }
    }

    // Handle pong frame (heartbeat response)
    if (envelope.type === "pong") {
      // Heartbeat acknowledged, already cleared timeout above
      return;
    }

    // Handle message.created with deduplication and auto-ack
    if (envelope.type === "message.created") {
      const msg = envelope.payload as MessageCreatedPayload;
      if (!msg.messageId || !msg.conversationId) {
        return;
      }

      // Check deduplication
      const isNew = deduplicatorRef.current.add(msg.messageId);
      if (!isNew) {
        // Suppress duplicate message dispatch
        return;
      }

      // Automatic delivery acknowledgment for incoming peer messages
      const isOwnMessage =
        callbacksRef.current.currentUserId !== null &&
        callbacksRef.current.currentUserId !== undefined &&
        msg.senderId === callbacksRef.current.currentUserId;

      if (!isOwnMessage && callbacksRef.current.autoAcknowledgeDelivery) {
        // 1. Send delivery receipt frame over WebSocket if connected
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ackFrame: InboundFrame = {
            v: 1,
            id: generateUuid(),
            type: "message.delivered",
            payload: {
              conversationId: msg.conversationId,
              messageId: msg.messageId,
            },
          };
          try {
            wsRef.current.send(JSON.stringify(ackFrame));
          } catch {
            // Non-fatal if WS send buffer failed
          }
        }

        // 2. Also trigger Server Action acknowledgment for persistence
        callbacksRef.current
          .acknowledgeDelivery(msg.conversationId, msg.messageId)
          .catch(() => {
            // Non-fatal; HTTP retry or WS ack handled by backend
          });
      }
    }

    // Global callback
    callbacksRef.current.onEvent?.(envelope);

    // Dispatch to typed subscribers
    const handlers = subscribersRef.current.get(envelope.type);
    if (handlers && handlers.size > 0) {
      for (const handler of Array.from(handlers)) {
        try {
          handler(envelope.payload, envelope);
        } catch (err) {
          if (err instanceof Error) {
            callbacksRef.current.onError?.(err);
          }
        }
      }
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalTimerRef.current !== null) {
      clearInterval(heartbeatIntervalTimerRef.current);
    }
    heartbeatIntervalTimerRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      const pingFrame: InboundFrame = {
        v: 1,
        id: generateUuid(),
        type: "ping",
        payload: {},
      };

      try {
        wsRef.current.send(JSON.stringify(pingFrame));
      } catch {
        // Send failure implies broken connection
        wsRef.current.close(4000, "Heartbeat ping failed");
        return;
      }

      // Start timeout timer for pong response
      if (heartbeatTimeoutTimerRef.current !== null) {
        clearTimeout(heartbeatTimeoutTimerRef.current);
      }
      heartbeatTimeoutTimerRef.current = setTimeout(() => {
        if (wsRef.current) {
          // Missed pong response: close and trigger reconnection
          wsRef.current.close(4001, "Heartbeat timeout: missed pong");
        }
      }, heartbeatTimeoutMs);
    }, heartbeatIntervalMs);
  }, [heartbeatIntervalMs, heartbeatTimeoutMs]);

  const connect = useCallback(async () => {
    if (isUnmountedRef.current || isManuallyDisconnectedRef.current) {
      return;
    }

    const currentGen = ++generationRef.current;
    cleanupSocket();
    updateState("ACQUIRING_TICKET", null);

    // 1. Acquire single-use ticket
    let ticketResult: {
      ok: boolean;
      ticket?: string;
      wsUrl?: string;
      message?: string;
      expired?: boolean;
    };
    try {
      ticketResult = await callbacksRef.current.issueTicket();
    } catch {
      ticketResult = { ok: false, message: "Failed to request realtime ticket." };
    }

    // Abort if unmounted or if another connect() call superseded this generation
    if (isUnmountedRef.current || generationRef.current !== currentGen) {
      return;
    }

    if (!ticketResult.ok || !ticketResult.ticket) {
      const isExpired =
        ticketResult.expired === true ||
        ticketResult.message?.toLowerCase().includes("session") ||
        ticketResult.message?.toLowerCase().includes("sign in");

      if (isExpired) {
        // Terminal session expiration: do not retry
        updateState("DISCONNECTED", ticketResult.message || "Your session has ended. Sign in again to continue.");
        return;
      }

      updateState("RECONNECTING", ticketResult.message || "Failed to acquire realtime ticket.");
      scheduleReconnectRef.current();
      return;
    }

    const { ticket, wsUrl } = ticketResult;

    // 2. Resolve WebSocket endpoint URL
    let resolvedUrl: string;
    if (wsUrl) {
      resolvedUrl = wsUrl;
    } else if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      resolvedUrl = `${protocol}//${window.location.host}/v1/realtime/ws`;
    } else {
      resolvedUrl = "ws://127.0.0.1:8080/v1/realtime/ws";
    }

    // 3. Subprotocols: negotiate base 'holoraa' while carrying ticket token in 'holoraa-ticket.<token>'
    const subprotocols = [
      REALTIME_SUBPROTOCOL_BASE,
      `${REALTIME_TICKET_SUBPROTOCOL_PREFIX}${ticket}`,
    ];

    updateState("CONNECTING", null);

    let socket: WebSocket;
    try {
      if (callbacksRef.current.webSocketFactory) {
        socket = callbacksRef.current.webSocketFactory(resolvedUrl, subprotocols);
      } else {
        socket = new WebSocket(resolvedUrl, subprotocols);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create WebSocket.";
      updateState("RECONNECTING", msg);
      scheduleReconnectRef.current();
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      if (generationRef.current !== currentGen || isUnmountedRef.current) {
        socket.close();
        return;
      }
      updateState("CONNECTED", null);
      startHeartbeat();

      // Reset retry count after stable connection threshold
      stableConnectionTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current = 0;
      }, stableConnectionThresholdMs);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (generationRef.current !== currentGen || isUnmountedRef.current) {
        return;
      }
      if (typeof event.data === "string") {
        handleIncomingMessage(event.data);
      }
    };

    socket.onerror = () => {
      if (generationRef.current !== currentGen || isUnmountedRef.current) {
        return;
      }
      const err = new Error("WebSocket connection error");
      callbacksRef.current.onError?.(err);
    };

    socket.onclose = (event: CloseEvent) => {
      if (generationRef.current !== currentGen || isUnmountedRef.current) {
        return;
      }
      clearTimers();
      wsRef.current = null;

      // Normal closure or manual disconnect: terminal
      if (event.code === 1000 || isManuallyDisconnectedRef.current) {
        updateState("DISCONNECTED", null);
        return;
      }

      // Check if closed due to auth failure (4401 or backend unauthorized)
      if (event.code === 4401 || event.reason?.toLowerCase().includes("session")) {
        updateState("DISCONNECTED", "Your session has ended. Sign in again to continue.");
        return;
      }

      updateState("RECONNECTING", event.reason || "Realtime connection closed unexpectedly.");
      scheduleReconnectRef.current();
    };
  }, [
    cleanupSocket,
    clearTimers,
    handleIncomingMessage,
    startHeartbeat,
    updateState,
    stableConnectionThresholdMs,
  ]);

  const scheduleReconnect = useCallback(() => {
    if (isUnmountedRef.current || isManuallyDisconnectedRef.current) {
      return;
    }
    const attempt = reconnectAttemptRef.current++;
    const delay = calculateBackoffWithJitter(
      attempt,
      baseReconnectDelayMs,
      maxReconnectDelayMs,
    );

    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [baseReconnectDelayMs, maxReconnectDelayMs, connect]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // Mount / enable lifecycle
  useEffect(() => {
    isUnmountedRef.current = false;
    isManuallyDisconnectedRef.current = false;

    if (enabled) {
      connect();
    } else {
      cleanupSocket();
      if (stateRef.current !== "IDLE") {
        setTimeout(() => {
          updateState("IDLE", null);
        }, 0);
      }
    }

    return () => {
      isUnmountedRef.current = true;
      generationRef.current += 1;
      cleanupSocket();
    };
  }, [enabled, connect, cleanupSocket, updateState]);

  // Outbound frame dispatch helper
  const sendInboundFrame = useCallback((frame: InboundFrame): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      wsRef.current.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }, []);

  const sendMessage = useCallback(
    (conversationId: string, clientMessageId: string, content: string): boolean => {
      return sendInboundFrame({
        v: 1,
        id: generateUuid(),
        type: "message.send",
        payload: {
          conversationId,
          clientMessageId,
          content,
        },
      });
    },
    [sendInboundFrame],
  );

  const markDelivered = useCallback(
    (conversationId: string, messageId: string): boolean => {
      return sendInboundFrame({
        v: 1,
        id: generateUuid(),
        type: "message.delivered",
        payload: {
          conversationId,
          messageId,
        },
      });
    },
    [sendInboundFrame],
  );

  const markRead = useCallback(
    (conversationId: string, messageId: string): boolean => {
      return sendInboundFrame({
        v: 1,
        id: generateUuid(),
        type: "message.read",
        payload: {
          conversationId,
          messageId,
        },
      });
    },
    [sendInboundFrame],
  );

  const sendTyping = useCallback(
    (conversationId: string, isTyping: boolean): boolean => {
      return sendInboundFrame({
        v: 1,
        id: generateUuid(),
        type: isTyping ? "typing.started" : "typing.stopped",
        payload: {
          conversationId,
        },
      });
    },
    [sendInboundFrame],
  );

  const subscribe = useCallback(
    <K extends RealtimeEventType>(
      type: K,
      handler: RealtimeEventHandler<K>,
    ): (() => void) => {
      let set = subscribersRef.current.get(type);
      if (!set) {
        set = new Set<GenericEventHandler>();
        subscribersRef.current.set(type, set);
      }
      set.add(handler as unknown as GenericEventHandler);

      return () => {
        const currentSet = subscribersRef.current.get(type);
        if (currentSet) {
          currentSet.delete(handler as unknown as GenericEventHandler);
          if (currentSet.size === 0) {
            subscribersRef.current.delete(type);
          }
        }
      };
    },
    [],
  );

  const reconnect = useCallback(() => {
    isManuallyDisconnectedRef.current = false;
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  const disconnect = useCallback(() => {
    isManuallyDisconnectedRef.current = true;
    cleanupSocket();
    updateState("DISCONNECTED", null);
  }, [cleanupSocket, updateState]);

  return {
    state,
    error,
    userId,
    serverTime,
    activeConversations,
    subscribe,
    sendMessage,
    markDelivered,
    markRead,
    sendTyping,
    reconnect,
    disconnect,
  };
}
