import type { Conversation, Message } from "./flows";
import type {
  ConversationUpdatedPayload,
  MessageCreatedPayload,
  MessageDeliveredPayload,
  MessageReadPayload,
  RealtimeConnectionState,
} from "./realtime-types";

export type MessageDeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface UiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  content: string;
  sequenceNum: number;
  createdAt: string;
  deliveryStatus: MessageDeliveryStatus;
  isOptimistic?: boolean;
  error?: string;
}

export interface PaginationState {
  oldestCursor?: string;
  newestCursor?: string;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
}

export interface MessagingState {
  currentUserId: string | null;
  conversations: Conversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  /** Set when realtime reports a conversation the list does not know; triggers a refetch. */
  conversationsStale: boolean;
  activeConversationId: string | null;
  messages: Record<string, UiMessage[]>;
  messagesLoading: Record<string, boolean>;
  messagesError: Record<string, string | null>;
  pagination: Record<string, PaginationState>;
  connectionState: RealtimeConnectionState;
  connectionError: string | null;
}

export const initialPaginationState: PaginationState = {
  hasMoreOlder: false,
  loadingOlder: false,
};

export const initialMessagingState: MessagingState = {
  currentUserId: null,
  conversations: [],
  conversationsLoading: false,
  conversationsError: null,
  conversationsStale: false,
  activeConversationId: null,
  messages: {},
  messagesLoading: {},
  messagesError: {},
  pagination: {},
  connectionState: "IDLE",
  connectionError: null,
};

/** Compares two ISO timestamps safely for sorting. */
export function compareTimestamps(a?: string | null, b?: string | null): number {
  const timeA = a ? new Date(a).getTime() : 0;
  const timeB = b ? new Date(b).getTime() : 0;
  return timeB - timeA;
}

/** Sorts conversations descending by last message timestamp or updated timestamp. */
export function sortConversationsByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const timeA = a.lastMessage?.createdAt ?? a.updatedAt;
    const timeB = b.lastMessage?.createdAt ?? b.updatedAt;
    return compareTimestamps(timeA, timeB);
  });
}

/** Returns the list with one conversation's unread count set to 0 (same array if nothing changes). */
function clearUnread(conversations: Conversation[], conversationId: string): Conversation[] {
  if (!conversations.some((c) => c.id === conversationId && c.unreadCount > 0)) {
    return conversations;
  }
  return conversations.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c));
}

/** Normalizes a server Message into a UiMessage. */
export function toUiMessage(
  msg: Message,
  currentUserId: string | null,
  overrideStatus?: MessageDeliveryStatus,
): UiMessage {
  let deliveryStatus: MessageDeliveryStatus = "sent";
  if (overrideStatus) {
    deliveryStatus = overrideStatus;
  } else if (msg.senderId === currentUserId) {
    if (msg.readAt) {
      deliveryStatus = "read";
    } else if (msg.deliveredAt) {
      deliveryStatus = "delivered";
    } else {
      deliveryStatus = "sent";
    }
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    clientMessageId: msg.clientMessageId,
    content: msg.content,
    sequenceNum: msg.sequenceNum,
    createdAt: msg.createdAt,
    deliveryStatus,
    isOptimistic: false,
  };
}

/**
 * Reconciles an incoming or confirmed message into an existing message array.
 * Deduplicates by real messageId and clientMessageId.
 * Preserves chronological order (ascending by sequenceNum, falling back to createdAt).
 */
export function reconcileMessages(
  currentList: UiMessage[] = [],
  incoming: UiMessage,
): UiMessage[] {
  // Check if message with this exact real ID already exists
  const existingByIdIndex = currentList.findIndex(
    (m) => m.id === incoming.id && !m.isOptimistic,
  );
  if (existingByIdIndex !== -1) {
    // Already present: update delivery status if advanced
    const updated = [...currentList];
    const existing = updated[existingByIdIndex];
    if (existing) {
      updated[existingByIdIndex] = {
        ...existing,
        ...incoming,
        // Don't downgrade read -> delivered or sent
        deliveryStatus:
          existing.deliveryStatus === "read"
            ? "read"
            : incoming.deliveryStatus,
      };
    }
    return updated;
  }

  // Check if this incoming message matches a pending optimistic message by clientMessageId
  const existingOptimisticIndex = currentList.findIndex(
    (m) => m.clientMessageId === incoming.clientMessageId && m.isOptimistic,
  );

  let updated: UiMessage[];
  if (existingOptimisticIndex !== -1) {
    updated = [...currentList];
    const opt = updated[existingOptimisticIndex];
    if (opt) {
      updated[existingOptimisticIndex] = {
        ...opt,
        ...incoming,
        isOptimistic: false,
        error: undefined,
      };
    }
  } else {
    updated = [...currentList, incoming];
  }

  // Sort ascending by sequenceNum (0 for pending optimistic goes to end), then createdAt
  return updated.sort((a, b) => {
    if (a.sequenceNum > 0 && b.sequenceNum > 0) {
      return a.sequenceNum - b.sequenceNum;
    }
    if (a.sequenceNum > 0 && b.sequenceNum === 0) {
      return -1;
    }
    if (a.sequenceNum === 0 && b.sequenceNum > 0) {
      return 1;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export type MessagingAction =
  | { type: "SET_CURRENT_USER"; userId: string | null }
  | { type: "CONVERSATIONS_LOADING" }
  | { type: "CONVERSATIONS_SUCCESS"; conversations: Conversation[] }
  | { type: "CONVERSATIONS_ERROR"; error: string }
  | { type: "SELECT_CONVERSATION"; conversationId: string | null }
  | { type: "CONVERSATION_MARKED_READ"; conversationId: string }
  | { type: "MESSAGES_LOADING"; conversationId: string }
  | {
      type: "MESSAGES_SUCCESS";
      conversationId: string;
      messages: Message[];
      hasMoreOlder?: boolean;
      oldestCursor?: string;
    }
  | { type: "MESSAGES_ERROR"; conversationId: string; error: string }
  | {
      type: "OLDER_MESSAGES_SUCCESS";
      conversationId: string;
      messages: Message[];
      hasMoreOlder: boolean;
      oldestCursor?: string;
    }
  | {
      type: "OPTIMISTIC_MESSAGE_ENQUEUE";
      conversationId: string;
      optimisticMessage: UiMessage;
    }
  | {
      type: "OPTIMISTIC_MESSAGE_CONFIRMED";
      conversationId: string;
      clientMessageId: string;
      confirmedMessage: Message;
    }
  | {
      type: "OPTIMISTIC_MESSAGE_FAILED";
      conversationId: string;
      clientMessageId: string;
      error: string;
    }
  | {
      type: "REALTIME_MESSAGE_CREATED";
      payload: MessageCreatedPayload;
    }
  | {
      type: "REALTIME_MESSAGE_DELIVERED";
      payload: MessageDeliveredPayload;
    }
  | {
      type: "REALTIME_MESSAGE_READ";
      payload: MessageReadPayload;
    }
  | {
      type: "REALTIME_CONVERSATION_UPDATED";
      payload: ConversationUpdatedPayload;
    }
  | {
      type: "REALTIME_CONNECTION_STATE_CHANGED";
      state: RealtimeConnectionState;
      error: string | null;
    };

export function messagingReducer(
  state: MessagingState,
  action: MessagingAction,
): MessagingState {
  switch (action.type) {
    case "SET_CURRENT_USER":
      return { ...state, currentUserId: action.userId };

    case "CONVERSATIONS_LOADING":
      return { ...state, conversationsLoading: true, conversationsError: null };

    case "CONVERSATIONS_SUCCESS":
      return {
        ...state,
        conversationsLoading: false,
        conversationsError: null,
        conversationsStale: false,
        conversations: sortConversationsByRecent(action.conversations),
      };

    case "CONVERSATIONS_ERROR":
      return {
        ...state,
        conversationsLoading: false,
        conversationsError: action.error,
        // Cleared so a failing refetch cannot loop; focus and reconnect retry later.
        conversationsStale: false,
      };

    case "SELECT_CONVERSATION":
      return {
        ...state,
        activeConversationId: action.conversationId,
        conversations: action.conversationId
          ? clearUnread(state.conversations, action.conversationId)
          : state.conversations,
      };

    case "CONVERSATION_MARKED_READ":
      return { ...state, conversations: clearUnread(state.conversations, action.conversationId) };

    case "MESSAGES_LOADING":
      return {
        ...state,
        messagesLoading: { ...state.messagesLoading, [action.conversationId]: true },
        messagesError: { ...state.messagesError, [action.conversationId]: null },
      };

    case "MESSAGES_SUCCESS": {
      const convId = action.conversationId;
      const normalized = action.messages.map((m) => toUiMessage(m, state.currentUserId));
      // Reconcile with any existing messages (realtime or pending optimistic)
      const existing = state.messages[convId] ?? [];

      let merged = existing;
      for (const msg of normalized) {
        merged = reconcileMessages(merged, msg);
      }

      const oldest =
        action.oldestCursor ??
        (action.messages.length > 0
          ? action.messages[action.messages.length - 1]?.id
          : undefined);

      return {
        ...state,
        messages: { ...state.messages, [convId]: merged },
        messagesLoading: { ...state.messagesLoading, [convId]: false },
        messagesError: { ...state.messagesError, [convId]: null },
        pagination: {
          ...state.pagination,
          [convId]: {
            oldestCursor: oldest,
            hasMoreOlder: action.hasMoreOlder ?? false,
            loadingOlder: false,
          },
        },
      };
    }

    case "MESSAGES_ERROR":
      return {
        ...state,
        messagesLoading: { ...state.messagesLoading, [action.conversationId]: false },
        messagesError: { ...state.messagesError, [action.conversationId]: action.error },
      };

    case "OLDER_MESSAGES_SUCCESS": {
      const convId = action.conversationId;
      const olderNormalized = action.messages.map((m) =>
        toUiMessage(m, state.currentUserId),
      );
      const existing = state.messages[convId] ?? [];

      let merged = existing;
      for (const m of olderNormalized) {
        merged = reconcileMessages(merged, m);
      }

      return {
        ...state,
        messages: { ...state.messages, [convId]: merged },
        pagination: {
          ...state.pagination,
          [convId]: {
            oldestCursor: action.oldestCursor,
            hasMoreOlder: action.hasMoreOlder,
            loadingOlder: false,
          },
        },
      };
    }

    case "OPTIMISTIC_MESSAGE_ENQUEUE": {
      const convId = action.conversationId;
      const currentMessages = state.messages[convId] ?? [];
      const updatedMessages = reconcileMessages(currentMessages, action.optimisticMessage);

      // Also update conversation's lastMessage snippet
      const updatedConvs = state.conversations.map((c) => {
        if (c.id === convId) {
          return {
            ...c,
            updatedAt: action.optimisticMessage.createdAt,
            lastMessage: {
              id: action.optimisticMessage.id,
              senderId: action.optimisticMessage.senderId,
              content: action.optimisticMessage.content,
              createdAt: action.optimisticMessage.createdAt,
            },
          };
        }
        return c;
      });

      return {
        ...state,
        messages: { ...state.messages, [convId]: updatedMessages },
        conversations: sortConversationsByRecent(updatedConvs),
      };
    }

    case "OPTIMISTIC_MESSAGE_CONFIRMED": {
      const convId = action.conversationId;
      const confirmedUi = toUiMessage(
        action.confirmedMessage,
        state.currentUserId,
        "sent",
      );
      const currentMessages = state.messages[convId] ?? [];
      const updatedMessages = reconcileMessages(currentMessages, confirmedUi);

      return {
        ...state,
        messages: { ...state.messages, [convId]: updatedMessages },
      };
    }

    case "OPTIMISTIC_MESSAGE_FAILED": {
      const convId = action.conversationId;
      const currentMessages = state.messages[convId] ?? [];
      const updatedMessages = currentMessages.map((m) => {
        if (m.clientMessageId === action.clientMessageId) {
          return { ...m, deliveryStatus: "failed" as const, error: action.error };
        }
        return m;
      });

      return {
        ...state,
        messages: { ...state.messages, [convId]: updatedMessages },
      };
    }

    case "REALTIME_MESSAGE_CREATED": {
      const p = action.payload;
      const isSelf = state.currentUserId !== null && p.senderId === state.currentUserId;
      const incomingUi: UiMessage = {
        id: p.messageId,
        conversationId: p.conversationId,
        senderId: p.senderId,
        clientMessageId: p.clientMessageId,
        content: p.content,
        sequenceNum: p.sequenceNum,
        createdAt: p.createdAt,
        deliveryStatus: isSelf ? "sent" : "delivered",
        isOptimistic: false,
      };

      const currentMessages = state.messages[p.conversationId] ?? [];
      const updatedMessages = reconcileMessages(currentMessages, incomingUi);

      const conv = state.conversations.find((c) => c.id === p.conversationId);
      if (!conv) {
        // Unknown conversation (e.g. a new request): the provider refetches the list.
        return {
          ...state,
          messages: { ...state.messages, [p.conversationId]: updatedMessages },
          conversationsStale: true,
        };
      }

      // Count it once, only for the peer's messages in a conversation not on screen.
      const alreadySeen =
        conv.lastMessage?.id === p.messageId ||
        currentMessages.some((m) => m.id === p.messageId);
      const countsAsUnread =
        !isSelf && !alreadySeen && state.activeConversationId !== p.conversationId;

      const updatedConvs = state.conversations.map((c) =>
        c.id === p.conversationId
          ? {
              ...c,
              updatedAt: p.createdAt,
              lastMessageSequence: Math.max(c.lastMessageSequence, p.sequenceNum),
              unreadCount: countsAsUnread ? c.unreadCount + 1 : c.unreadCount,
              lastMessage: {
                id: p.messageId,
                senderId: p.senderId,
                content: p.content,
                createdAt: p.createdAt,
              },
            }
          : c,
      );

      return {
        ...state,
        messages: { ...state.messages, [p.conversationId]: updatedMessages },
        conversations: sortConversationsByRecent(updatedConvs),
      };
    }

    case "REALTIME_MESSAGE_DELIVERED": {
      const { conversationId, messageId } = action.payload;
      const currentMessages = state.messages[conversationId];
      if (!currentMessages) return state;

      const updated = currentMessages.map((m) => {
        if (m.id === messageId && m.deliveryStatus === "sent") {
          return { ...m, deliveryStatus: "delivered" as const };
        }
        return m;
      });

      return {
        ...state,
        messages: { ...state.messages, [conversationId]: updated },
      };
    }

    case "REALTIME_MESSAGE_READ": {
      const { conversationId, sequenceNum } = action.payload;
      const currentMessages = state.messages[conversationId];
      if (!currentMessages) return state;

      const updated = currentMessages.map((m) => {
        if (
          m.sequenceNum > 0 &&
          m.sequenceNum <= sequenceNum &&
          (m.deliveryStatus === "sent" || m.deliveryStatus === "delivered")
        ) {
          return { ...m, deliveryStatus: "read" as const };
        }
        return m;
      });

      return {
        ...state,
        messages: { ...state.messages, [conversationId]: updated },
      };
    }

    case "REALTIME_CONVERSATION_UPDATED": {
      const p = action.payload;
      if (!state.conversations.some((c) => c.id === p.conversationId)) {
        return { ...state, conversationsStale: true };
      }
      const updatedConvs = state.conversations.map((c) => {
        if (c.id === p.conversationId) {
          return {
            ...c,
            status: p.status,
            updatedAt: p.updatedAt,
            lastMessage: p.lastMessage ?? c.lastMessage,
          };
        }
        return c;
      });

      return {
        ...state,
        conversations: sortConversationsByRecent(updatedConvs),
      };
    }

    case "REALTIME_CONNECTION_STATE_CHANGED":
      return {
        ...state,
        connectionState: action.state,
        connectionError: action.error,
      };

    default:
      return state;
  }
}
