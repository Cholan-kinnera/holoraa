"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Conversation, Message } from "@/lib/messaging/flows";
import type { RealtimeConnectionState } from "@/lib/messaging/realtime-types";
import { useMessaging } from "@/lib/messaging/useMessaging";

import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { RequestBar } from "./RequestBar";
import { useThreadScroll } from "./useThreadScroll";

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
    loadOlderMessages,
    sendMessage,
    retryMessage,
    acceptRequest,
    declineRequest,
    markAsRead,
    activeConversation,
    activeMessages,
    connectionState,
    currentUserId,
    pagination,
    messagesError,
  } = useMessaging();

  const router = useRouter();
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
  const pag = pagination[conversationId];
  const loaded = pag !== undefined;
  const loadError = messagesError[conversationId];
  const live = LIVE_LABEL[connectionState];

  const iAmRecipient = conversation.initiatedBy !== currentUserId;
  const iHaveSent = activeMessages.some(
    (m) => m.senderId === currentUserId && m.deliveryStatus !== "failed",
  );
  // Mirrors the server's rules, so the composer never offers a send that the
  // API would reject. The server still enforces them.
  const disabledReason =
    conversation.status === "declined"
      ? "This request was declined. No further messages can be sent."
      : conversation.status === "pending" && iAmRecipient
        ? `Accept the request to reply to ${peerName}.`
        : conversation.status === "pending" && iHaveSent
          ? `You can send more once ${peerName} accepts your request.`
          : null;

  const send = useCallback(
    (content: string) => void sendMessage(conversationId, content),
    [sendMessage, conversationId],
  );
  const retry = useCallback(
    (clientMessageId: string) => void retryMessage(conversationId, clientMessageId),
    [retryMessage, conversationId],
  );

  const accept = useCallback(() => acceptRequest(conversationId), [acceptRequest, conversationId]);
  // The list hides declined conversations, so leave for the inbox once declined.
  const decline = useCallback(async () => {
    const res = await declineRequest(conversationId);
    if (res.ok) router.push("/app");
    return res;
  }, [declineRequest, conversationId, router]);

  const loadOlder = useCallback(() => {
    void loadOlderMessages(conversationId);
  }, [loadOlderMessages, conversationId]);
  const { scrollRef, sentinelRef, onScroll, atBottom, unseen, jumpToLatest } = useThreadScroll({
    conversationId,
    messages: activeMessages,
    currentUserId,
    canLoadOlder: !!pag && pag.hasMoreOlder && !pag.loadingOlder && !pag.olderError,
    loadOlder,
  });

  return (
    <section
      className="chat thread"
      aria-labelledby="active-chat-title"
      data-conversation-id={conversationId}
      data-connection-state={connectionState}
    >
      <header className="thread__header">
        <Link href="/app" className="thread__back" aria-label="Back to chats">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
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

      <div className="thread__viewport">
      <div className="thread__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="thread__content">
          {conversation.status === "pending" && !iAmRecipient && (
            <p className="thread__notice" role="status">
              Request sent. You can send one message until {peerName} accepts.
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
            <div className="thread__empty thread__empty--hello">
              <Avatar src={peer.avatarUrl} alt={peerName} size="2xl" />
              <p className="thread__empty-title">Say hello to {peerName}</p>
              <p>No messages yet. Your conversation starts here.</p>
            </div>
          ) : (
            <>
              <div ref={sentinelRef} className="thread__top">
                {pag.loadingOlder ? (
                  <span className="thread__top-note" role="status">
                    <span className="spinner" aria-hidden="true" />
                    Loading earlier messages…
                  </span>
                ) : pag.olderError ? (
                  <span className="thread__top-note" role="alert">
                    Couldn’t load earlier messages.
                    <button type="button" className="link-button" onClick={loadOlder}>
                      Retry
                    </button>
                  </span>
                ) : !pag.hasMoreOlder ? (
                  <span className="thread__top-note">This is the start of your conversation with {peerName}.</span>
                ) : null}
              </div>
              <MessageList messages={activeMessages} currentUserId={currentUserId} onRetry={retry} />
            </>
          )}
        </div>
      </div>
      {!atBottom && (
        <button type="button" className="thread__jump" onClick={jumpToLatest}>
          {unseen > 0 ? `${unseen} new message${unseen === 1 ? "" : "s"}` : "Latest"}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      </div>
      {loaded &&
        (conversation.status === "pending" && iAmRecipient ? (
          <RequestBar peerName={peerName} onAccept={accept} onDecline={decline} />
        ) : (
          <Composer peerName={peerName} disabledReason={disabledReason} onSend={send} />
        ))}
    </section>
  );
}
