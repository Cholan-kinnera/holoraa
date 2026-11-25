/**
 * Realtime WebSocket types matching the Holoraa backend protocol
 * and contracts in contracts/events/*.json.
 */

export const REALTIME_SUBPROTOCOL_BASE = "holoraa" as const;
export const REALTIME_TICKET_SUBPROTOCOL_PREFIX = "holoraa-ticket." as const;

export type RealtimeConnectionState =
  | "IDLE"
  | "ACQUIRING_TICKET"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED";

export interface RealtimeEnvelope<T = unknown> {
  v: 1;
  id: string;
  type: string;
  timestamp: string;
  payload: T;
}

export interface ConnectionReadyPayload {
  userId: string;
  serverTime: string;
  activeConversations: string[];
}

export interface MessageCreatedPayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  content: string;
  sequenceNum: number;
  createdAt: string;
}

export interface MessageDeliveredPayload {
  conversationId: string;
  messageId: string;
}

export interface MessageReadPayload {
  conversationId: string;
  userId: string;
  messageId: string;
  sequenceNum: number;
  fromSequenceNum?: number;
  readAt: string;
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  status: "pending" | "accepted" | "declined";
  updatedAt: string;
  lastMessage?: {
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
  } | null;
}

export interface PresenceUpdatedPayload {
  userId: string;
  status: string;
  lastSeenAt: string;
}

export interface TypingPayload {
  conversationId: string;
  userId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  clientMessageId?: string;
}

export interface RealtimeEventMap {
  "connection.ready": ConnectionReadyPayload;
  "message.created": MessageCreatedPayload;
  "message.delivered": MessageDeliveredPayload;
  "message.read": MessageReadPayload;
  "conversation.updated": ConversationUpdatedPayload;
  "presence.updated": PresenceUpdatedPayload;
  "typing.started": TypingPayload;
  "typing.stopped": TypingPayload;
}

export type RealtimeEventType = keyof RealtimeEventMap;

export interface InboundPingFrame {
  v: 1;
  id: string;
  type: "ping";
  payload: Record<string, never>;
}

export interface InboundDeliveredFrame {
  v: 1;
  id: string;
  type: "message.delivered";
  payload: {
    conversationId: string;
    messageId: string;
  };
}

export interface InboundReadFrame {
  v: 1;
  id: string;
  type: "message.read";
  payload: {
    conversationId: string;
    messageId: string;
  };
}

export interface InboundSendFrame {
  v: 1;
  id: string;
  type: "message.send";
  payload: {
    conversationId: string;
    clientMessageId: string;
    content: string;
  };
}

export interface InboundTypingFrame {
  v: 1;
  id: string;
  type: "typing.started" | "typing.stopped";
  payload: {
    conversationId: string;
  };
}

export type InboundFrame =
  | InboundPingFrame
  | InboundDeliveredFrame
  | InboundReadFrame
  | InboundSendFrame
  | InboundTypingFrame;
