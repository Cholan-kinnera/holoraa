/**
 * WebSocket event contract.
 * Both the API gateway and the web client import from here
 * to guarantee type-safe, consistent event names and payloads.
 *
 * Phase 0: only ping/pong scaffold. Chat events added in Phase 1.
 */

// ── Event Names ─────────────────────────────────────────────

export const WS_EVENTS = {
  // Connection lifecycle
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',

  // Presence (scaffold — logic added in Phase 1)
  PRESENCE_UPDATE: 'presence:update',

  // Typing indicator (scaffold)
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ── Event Payloads ──────────────────────────────────────────

export interface WsPingPayload {
  timestamp: number;
}

export interface WsPongPayload {
  timestamp: number;
  serverTime: number;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

export interface WsPresencePayload {
  userId: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
}

export interface WsTypingPayload {
  userId: string;
  conversationId: string;
}

// ── Event Map (for type-safe handlers) ──────────────────────

export interface WsEventMap {
  [WS_EVENTS.PING]: WsPingPayload;
  [WS_EVENTS.PONG]: WsPongPayload;
  [WS_EVENTS.ERROR]: WsErrorPayload;
  [WS_EVENTS.PRESENCE_UPDATE]: WsPresencePayload;
  [WS_EVENTS.TYPING_START]: WsTypingPayload;
  [WS_EVENTS.TYPING_STOP]: WsTypingPayload;
}
