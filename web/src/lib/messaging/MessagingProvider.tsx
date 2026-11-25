"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  acceptMessageRequestAction,
  declineMessageRequestAction,
  getConversationsAction,
  getMessagesAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/app/app/messages/actions";
import type { User } from "@/lib/auth/flows";
import type { Conversation, Message } from "./flows";
import {
  generateUuid,
  useRealtimeSocket,
  type UseRealtimeSocketOptions,
} from "./useRealtimeSocket";
import {
  initialMessagingState,
  messagingReducer,
  sortConversationsByRecent,
  type MessagingState,
  type UiMessage,
} from "./state";

export interface MessagingContextValue extends MessagingState {
  activeConversation: Conversation | null;
  activeMessages: UiMessage[];
  pendingRequestsCount: number;
  selectConversation: (conversationId: string | null) => void;
  hydrateConversationMessages: (
    conversationId: string,
    messages: Message[],
    hasMoreOlder?: boolean,
    oldestCursor?: string,
  ) => void;
  loadConversationMessages: (conversationId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
  ) => Promise<{ ok: boolean; clientMessageId?: string; error?: string }>;
  retryMessage: (
    conversationId: string,
    clientMessageId: string,
  ) => Promise<void>;
  acceptRequest: (conversationId: string) => Promise<{ ok: boolean; error?: string }>;
  declineRequest: (conversationId: string) => Promise<{ ok: boolean; error?: string }>;
  markAsRead: (conversationId: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
  reconnectRealtime: () => void;
}

const MessagingContext = createContext<MessagingContextValue | null>(null);

/** Minimum gap between focus-triggered conversation refetches. */
const FOCUS_REFETCH_MIN_MS = 15_000;

export interface MessagingProviderProps {
  user: User;
  children: ReactNode;
  initialConversations?: Conversation[];
  /** Optional socket configuration for testing or environment overrides. */
  socketOptions?: Partial<UseRealtimeSocketOptions>;
}

export function MessagingProvider({
  user,
  children,
  initialConversations,
  socketOptions,
}: MessagingProviderProps) {
  const [state, dispatch] = useReducer(messagingReducer, {
    ...initialMessagingState,
    currentUserId: user.id,
    conversations: sortConversationsByRecent(initialConversations ?? []),
  });

  // Latest committed state, for callbacks that must not capture a stale render.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Mark a conversation read up to its newest confirmed message. Reads stateRef so it
  // is stable and never sees an empty list from a stale render. Optimistic messages
  // ("opt-" ids) are skipped: the server does not know them yet.
  const markAsRead = useCallback(async (conversationId: string, messageId?: string) => {
    const current = stateRef.current;
    const confirmed = (current.messages[conversationId] ?? []).filter((m) => !m.isOptimistic);
    const conv = current.conversations.find((c) => c.id === conversationId);
    const targetMessageId =
      messageId ?? confirmed[confirmed.length - 1]?.id ?? conv?.lastMessage?.id;
    if (!targetMessageId || targetMessageId.startsWith("opt-")) return;
    try {
      const res = await markConversationReadAction(conversationId, targetMessageId);
      if (res.ok) {
        dispatch({ type: "CONVERSATION_MARKED_READ", conversationId });
      }
    } catch {
      // Non-fatal: the server count stays as is and the next refetch shows it.
    }
  }, []);

  // Ensure current user is synced
  useEffect(() => {
    dispatch({ type: "SET_CURRENT_USER", userId: user.id });
  }, [user.id]);

  // Realtime hook integration
  const realtime = useRealtimeSocket({
    currentUserId: user.id,
    onStateChange: (connState) => {
      dispatch({
        type: "REALTIME_CONNECTION_STATE_CHANGED",
        state: connState,
        error: null,
      });
    },
    onError: (err) => {
      dispatch({
        type: "REALTIME_CONNECTION_STATE_CHANGED",
        state: realtime.state,
        error: err.message,
      });
    },
    ...socketOptions,
  });

  // Keep state.connectionState in sync
  useEffect(() => {
    dispatch({
      type: "REALTIME_CONNECTION_STATE_CHANGED",
      state: realtime.state,
      error: realtime.error,
    });
  }, [realtime.state, realtime.error]);

  // Subscribe to typed realtime events. `subscribe` is stable, so this runs once
  // (depending on the whole `realtime` object re-subscribed on every render).
  const { subscribe } = realtime;
  useEffect(() => {
    const unsubCreated = subscribe("message.created", (payload) => {
      dispatch({ type: "REALTIME_MESSAGE_CREATED", payload });
      // A peer message in the open conversation is read as it arrives.
      if (
        payload.senderId !== user.id &&
        stateRef.current.activeConversationId === payload.conversationId
      ) {
        void markAsRead(payload.conversationId, payload.messageId);
      }
    });

    const unsubDelivered = subscribe("message.delivered", (payload) => {
      dispatch({ type: "REALTIME_MESSAGE_DELIVERED", payload });
    });

    const unsubRead = subscribe("message.read", (payload) => {
      dispatch({ type: "REALTIME_MESSAGE_READ", payload });
    });

    const unsubUpdated = subscribe("conversation.updated", (payload) => {
      dispatch({ type: "REALTIME_CONVERSATION_UPDATED", payload });
    });

    return () => {
      unsubCreated();
      unsubDelivered();
      unsubRead();
      unsubUpdated();
    };
  }, [subscribe, markAsRead, user.id]);

  // 1. Fetch conversations. One request at a time; lastFetchRef throttles focus refetches.
  // A request made while one is running queues exactly one follow-up, so an event
  // that arrives mid-fetch is never answered by a list fetched before it.
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  const lastFetchRef = useRef(0);
  const refreshConversations = useCallback(async function run(): Promise<void> {
    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    lastFetchRef.current = Date.now();
    dispatch({ type: "CONVERSATIONS_LOADING" });
    try {
      const res = await getConversationsAction();
      if (res.ok) {
        dispatch({
          type: "CONVERSATIONS_SUCCESS",
          conversations: res.conversations,
        });
      } else {
        dispatch({ type: "CONVERSATIONS_ERROR", error: res.message });
      }
    } catch {
      dispatch({
        type: "CONVERSATIONS_ERROR",
        error: "Failed to load conversations.",
      });
    } finally {
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        void run();
      }
    }
  }, []);

  // Fetch on mount only when the server did not hydrate the list. An empty
  // server list is a real answer, not a reason to refetch.
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      if (initialConversations === undefined) {
        void refreshConversations();
      } else {
        lastFetchRef.current = Date.now(); // the server fetch counts for the focus throttle
      }
    }
  }, [initialConversations, refreshConversations]);

  // Refetch when realtime mentions a conversation the list does not have.
  useEffect(() => {
    if (state.conversationsStale) {
      void refreshConversations();
    }
  }, [state.conversationsStale, refreshConversations]);

  // Refetch after a reconnect: events sent while offline were missed.
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (realtime.state !== "CONNECTED") return;
    if (hasConnectedRef.current) {
      void refreshConversations();
    }
    hasConnectedRef.current = true;
  }, [realtime.state, refreshConversations]);

  // Refetch when the window regains focus (unread counts read on another device).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchRef.current < FOCUS_REFETCH_MIN_MS) return;
      void refreshConversations();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshConversations]);

  // 2. Select conversation
  const selectConversation = useCallback((conversationId: string | null) => {
    dispatch({ type: "SELECT_CONVERSATION", conversationId });
  }, []);

  // 3. Load initial messages for a conversation
  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      dispatch({ type: "MESSAGES_LOADING", conversationId });
      try {
        const res = await getMessagesAction(conversationId, { limit: 50 });
        if (res.ok) {
          const messages = res.messages;
          const oldest =
            messages.length > 0
              ? messages[messages.length - 1]?.id
              : undefined;
          dispatch({
            type: "MESSAGES_SUCCESS",
            conversationId,
            messages,
            hasMoreOlder: res.hasMore,
            oldestCursor: oldest,
          });
        } else {
          dispatch({
            type: "MESSAGES_ERROR",
            conversationId,
            error: res.message,
          });
        }
      } catch {
        dispatch({
          type: "MESSAGES_ERROR",
          conversationId,
          error: "Failed to load messages.",
        });
      }
    },
    [],
  );

  // 3b. Hydrate initial messages from server pre-fetch
  const hydrateConversationMessages = useCallback(
    (
      conversationId: string,
      messages: Message[],
      hasMoreOlder?: boolean,
      oldestCursor?: string,
    ) => {
      dispatch({
        type: "MESSAGES_SUCCESS",
        conversationId,
        messages,
        hasMoreOlder,
        oldestCursor,
      });
    },
    [],
  );

  // 4. Load older messages (pagination scroll-up)
  const loadOlderMessages = useCallback(async (conversationId: string) => {
    const pag = stateRef.current.pagination[conversationId];
    if (!pag || !pag.hasMoreOlder || pag.loadingOlder || !pag.oldestCursor) {
      return;
    }

    try {
      const res = await getMessagesAction(conversationId, {
        limit: 50,
        before: pag.oldestCursor,
      });

      if (res.ok) {
        const olderMessages = res.messages;
        const newOldest =
          olderMessages.length > 0
            ? olderMessages[olderMessages.length - 1]?.id
            : pag.oldestCursor;
        dispatch({
          type: "OLDER_MESSAGES_SUCCESS",
          conversationId,
          messages: olderMessages,
          hasMoreOlder: res.hasMore,
          oldestCursor: newOldest,
        });
      }
    } catch {
      // Non-fatal pagination error
    }
  }, []);

  // 5. Send message with optimistic dispatch and reconciliation
  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) {
        return { ok: false, error: "Message cannot be empty." };
      }

      const clientMessageId = generateUuid();
      const optimisticId = `opt-${clientMessageId}`;
      const now = new Date().toISOString();

      const optimisticMsg: UiMessage = {
        id: optimisticId,
        conversationId,
        senderId: user.id,
        clientMessageId,
        content: trimmed,
        sequenceNum: 0, // Pending
        createdAt: now,
        deliveryStatus: "sending",
        isOptimistic: true,
      };

      dispatch({
        type: "OPTIMISTIC_MESSAGE_ENQUEUE",
        conversationId,
        optimisticMessage: optimisticMsg,
      });

      try {
        const res = await sendMessageAction(conversationId, clientMessageId, trimmed);
        if (res.ok) {
          dispatch({
            type: "OPTIMISTIC_MESSAGE_CONFIRMED",
            conversationId,
            clientMessageId,
            confirmedMessage: res.message,
          });
          return { ok: true, clientMessageId };
        } else {
          dispatch({
            type: "OPTIMISTIC_MESSAGE_FAILED",
            conversationId,
            clientMessageId,
            error: res.message,
          });
          return { ok: false, clientMessageId, error: res.message };
        }
      } catch {
        const errorMsg = "Could not send message. Try again.";
        dispatch({
          type: "OPTIMISTIC_MESSAGE_FAILED",
          conversationId,
          clientMessageId,
          error: errorMsg,
        });
        return { ok: false, clientMessageId, error: errorMsg };
      }
    },
    [user.id],
  );

  // 6. Retry a failed optimistic message
  const retryMessage = useCallback(
    async (conversationId: string, clientMessageId: string) => {
      const msgs = stateRef.current.messages[conversationId] ?? [];
      const target = msgs.find(
        (m) => m.clientMessageId === clientMessageId && m.deliveryStatus === "failed",
      );
      if (!target) return;

      // Reset to sending
      const retryingMsg: UiMessage = {
        ...target,
        deliveryStatus: "sending",
        error: undefined,
      };
      dispatch({
        type: "OPTIMISTIC_MESSAGE_ENQUEUE",
        conversationId,
        optimisticMessage: retryingMsg,
      });

      try {
        const res = await sendMessageAction(
          conversationId,
          clientMessageId,
          target.content,
        );
        if (res.ok) {
          dispatch({
            type: "OPTIMISTIC_MESSAGE_CONFIRMED",
            conversationId,
            clientMessageId,
            confirmedMessage: res.message,
          });
        } else {
          dispatch({
            type: "OPTIMISTIC_MESSAGE_FAILED",
            conversationId,
            clientMessageId,
            error: res.message,
          });
        }
      } catch {
        dispatch({
          type: "OPTIMISTIC_MESSAGE_FAILED",
          conversationId,
          clientMessageId,
          error: "Retry failed. Check your connection.",
        });
      }
    },
    [],
  );

  // 7. Accept message request
  const acceptRequest = useCallback(async (conversationId: string) => {
    try {
      const res = await acceptMessageRequestAction(conversationId);
      if (res.ok) {
        dispatch({
          type: "REALTIME_CONVERSATION_UPDATED",
          payload: {
            conversationId,
            status: "accepted",
            updatedAt: new Date().toISOString(),
          },
        });
        return { ok: true };
      }
      return { ok: false, error: res.message };
    } catch {
      return { ok: false, error: "Failed to accept message request." };
    }
  }, []);

  // 8. Decline message request
  const declineRequest = useCallback(async (conversationId: string) => {
    try {
      const res = await declineMessageRequestAction(conversationId);
      if (res.ok) {
        dispatch({
          type: "REALTIME_CONVERSATION_UPDATED",
          payload: {
            conversationId,
            status: "declined",
            updatedAt: new Date().toISOString(),
          },
        });
        return { ok: true };
      }
      return { ok: false, error: res.message };
    } catch {
      return { ok: false, error: "Failed to decline message request." };
    }
  }, []);

  // Derived states
  const activeConversation = useMemo(() => {
    if (!state.activeConversationId) return null;
    return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
  }, [state.activeConversationId, state.conversations]);

  const activeMessages = useMemo(() => {
    if (!state.activeConversationId) return [];
    return state.messages[state.activeConversationId] ?? [];
  }, [state.activeConversationId, state.messages]);

  const pendingRequestsCount = useMemo(() => {
    return state.conversations.filter(
      (c) => c.status === "pending" && c.initiatedBy !== user.id,
    ).length;
  }, [state.conversations, user.id]);

  const value: MessagingContextValue = useMemo(
    () => ({
      ...state,
      activeConversation,
      activeMessages,
      pendingRequestsCount,
      selectConversation,
      hydrateConversationMessages,
      loadConversationMessages,
      loadOlderMessages,
      sendMessage,
      retryMessage,
      acceptRequest,
      declineRequest,
      markAsRead,
      refreshConversations,
      reconnectRealtime: realtime.reconnect,
    }),
    [
      state,
      activeConversation,
      activeMessages,
      pendingRequestsCount,
      selectConversation,
      hydrateConversationMessages,
      loadConversationMessages,
      loadOlderMessages,
      sendMessage,
      retryMessage,
      acceptRequest,
      declineRequest,
      markAsRead,
      refreshConversations,
      realtime.reconnect,
    ],
  );

  return (
    <MessagingContext.Provider value={value}>
      {children}
    </MessagingContext.Provider>
  );
}

/** Hook to access messaging state and actions. */
export function useMessaging(): MessagingContextValue {
  const context = useContext(MessagingContext);
  if (!context) {
    throw new Error("useMessaging must be used within a MessagingProvider");
  }
  return context;
}
