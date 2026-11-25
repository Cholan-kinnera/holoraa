"use client";

import { useEffect, useRef } from "react";

import type { Conversation, Message } from "@/lib/messaging/flows";
import { useMessaging } from "@/lib/messaging/useMessaging";

export interface ConversationViewProps {
  conversationId: string;
  initialConversation: Conversation;
  initialMessages: Message[];
  /** The server's `hasMore` for the initial page. */
  initialHasMore: boolean;
}

/**
 * Headless orchestration bridge for an active conversation route.
 * Connects the active URL param to MessagingContext, synchronizes initial
 * server-fetched messages, and coordinates read watermarks.
 */
export function ConversationView({
  conversationId,
  initialConversation,
  initialMessages,
  initialHasMore,
}: ConversationViewProps) {
  const {
    selectConversation,
    hydrateConversationMessages,
    loadConversationMessages,
    markAsRead,
    activeConversation,
    activeMessages,
    connectionState,
    currentUserId,
  } = useMessaging();

  const prevConvIdRef = useRef<string | null>(null);

  // Sync active conversation selection and initial messages
  useEffect(() => {
    selectConversation(conversationId);

    // If messages for this conversation haven't been loaded in state, load or hydrate them
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      if (initialMessages && initialMessages.length > 0) {
        hydrateConversationMessages(
          conversationId,
          initialMessages,
          initialHasMore,
          initialMessages[initialMessages.length - 1]?.id,
        );
      } else {
        loadConversationMessages(conversationId);
      }
      // Advance read watermark
      markAsRead(conversationId);
    }

    return () => {
      selectConversation(null);
    };
  }, [
    conversationId,
    selectConversation,
    hydrateConversationMessages,
    loadConversationMessages,
    markAsRead,
    initialMessages,
    initialHasMore,
  ]);

  const conversation = activeConversation ?? initialConversation;
  const otherUser = conversation.peer;
  const displayMessageCount =
    activeMessages.length > 0 ? activeMessages.length : initialMessages.length;

  return (
    <section
      className="chat"
      aria-labelledby="active-chat-title"
      data-conversation-id={conversationId}
      data-connection-state={connectionState}
    >
      <header className="chat__header">
        <div className="flex items-center justify-between w-full">
          <div>
            <h1 id="active-chat-title" className="chat__title">
              {otherUser.displayName || otherUser.username}
            </h1>
            <p className="text-xs text-ink-muted">@{otherUser.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connectionState === "CONNECTED"
                  ? "bg-accent-green"
                  : connectionState === "CONNECTING" || connectionState === "RECONNECTING"
                    ? "bg-accent-amber animate-pulse"
                    : "bg-ink-muted"
              }`}
              aria-label={`Realtime status: ${connectionState}`}
              title={`Realtime: ${connectionState}`}
            />
            <span className="text-xs text-ink-muted font-mono capitalize">
              {conversation.status}
            </span>
          </div>
        </div>
      </header>

      <div className="chat__body">
        {conversation.status === "pending" && (
          <div
            className="p-3 mb-4 rounded-lg bg-oled-surface border border-accent-amber/30 text-xs text-ink-secondary"
            role="status"
          >
            {conversation.initiatedBy !== currentUserId
              ? "Message request: this user wants to start a conversation with you."
              : "Message request sent. Senders can only send 1 message until accepted."}
          </div>
        )}

        {conversation.status === "declined" && (
          <div
            className="p-3 mb-4 rounded-lg bg-oled-surface border border-red-500/30 text-xs text-ink-muted"
            role="status"
          >
            This message request was declined. No further messages can be sent.
          </div>
        )}

        <div className="space-y-2 py-4">
          <p className="text-xs text-ink-muted text-center">
            {displayMessageCount === 0
              ? "No messages yet. Direct conversation connected."
              : `${displayMessageCount} message${displayMessageCount === 1 ? "" : "s"} synchronized.`}
          </p>
        </div>
      </div>
    </section>
  );
}
