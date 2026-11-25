"use client";

import { useEffect, useRef } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Conversation, Message } from "@/lib/messaging/flows";
import type { RealtimeConnectionState } from "@/lib/messaging/realtime-types";
import { useMessaging } from "@/lib/messaging/useMessaging";

import { MessageList } from "./MessageList";

const LIVE_LABEL: Record<RealtimeConnectionState, { text: string; tone: "on" | "wait" | "off" }> = {
  CONNECTED: { text: "Live", tone: "on" },
  IDLE: { text: "Connecting…", tone: "wait" },
  ACQUIRING_TICKET: { text: "Connecting…", tone: "wait" },
  CONNECTING: { text: "Connecting…", tone: "wait" },
  RECONNECTING: { text: "Reconnecting…", tone: "wait" },
  DISCONNECTED: { text: "Offline", tone: "off" },
};

export interface ConversationViewProps {
  conversationId: string;
  initialConversation: Conversation;
  initialMessages: Message[];
  /** The server's `hasMore` for the initial page. */
  initialHasMore: boolean;
}

/**
 * The open conversation: header, request notices, and the message thread.
 * Connects the URL param to MessagingContext, hydrates the server-fetched
 * first page, and advances the read watermark.
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
    pagination,
    messagesError,
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
  const peer = conversation.peer;
  const peerName = peer.displayName || peer.username;
  // Pagination exists once this conversation's first page is in state. Until
  // then (including the server render) show a placeholder, so timestamps are
  // only ever formatted in the viewer's own time zone.
  const loaded = pagination[conversationId] !== undefined;
  const loadError = messagesError[conversationId];
  const live = LIVE_LABEL[connectionState];

  return (
    <section
      className="chat thread"
      aria-labelledby="active-chat-title"
      data-conversation-id={conversationId}
      data-connection-state={connectionState}
    >
      <header className="thread__header">
        <Avatar src={peer.avatarUrl} alt={peerName} size="lg" />
        <div className="thread__who">
          <h1 id="active-chat-title" className="thread__name">
            {peerName}
          </h1>
          <p className="thread__handle">@{peer.username}</p>
        </div>
        <div className="thread__aside">
          {conversation.status !== "accepted" && (
            <span className={`thread-chip thread-chip--${conversation.status}`}>
              {conversation.status === "pending" ? "Request" : "Declined"}
            </span>
          )}
          <span className={`live live--${live.tone}`} role="status">
            <span className="live__dot" aria-hidden="true" />
            {live.text}
          </span>
        </div>
      </header>

      <div className="thread__scroll">
        <div className="thread__content">
          {conversation.status === "pending" && (
            <p className="thread__notice" role="status">
              {conversation.initiatedBy !== currentUserId
                ? "Message request: this user wants to start a conversation with you."
                : "Message request sent. Senders can only send 1 message until accepted."}
            </p>
          )}

          {conversation.status === "declined" && (
            <p className="thread__notice thread__notice--declined" role="status">
              This message request was declined. No further messages can be sent.
            </p>
          )}

          {!loaded && loadError ? (
            <div className="thread__empty" role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void loadConversationMessages(conversationId)}
              >
                Try again
              </button>
            </div>
          ) : !loaded ? (
            <div className="thread__placeholder" aria-busy="true" aria-label="Loading messages">
              <Skeleton className="skeleton--pill thread__ghost" />
              <Skeleton className="skeleton--pill thread__ghost thread__ghost--mine" />
              <Skeleton className="skeleton--pill thread__ghost thread__ghost--short" />
            </div>
          ) : activeMessages.length === 0 ? (
            <div className="thread__empty">
              <p>No messages yet. Say hello to {peerName}.</p>
            </div>
          ) : (
            <MessageList messages={activeMessages} currentUserId={currentUserId} />
          )}
        </div>
      </div>
    </section>
  );
}
