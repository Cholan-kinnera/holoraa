"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { SkeletonAvatar, SkeletonText } from "@/components/ui/Skeleton";
import type { Conversation } from "@/lib/messaging/flows";
import { useMessaging } from "@/lib/messaging/useMessaging";
import { formatFullTimestamp, formatRelativeTime } from "@/lib/time";

const TICK_MS = 60_000;

/**
 * Sidebar list of the signed-in user's conversations, newest first.
 * Incoming requests are listed above chats; declined conversations are hidden.
 */
export function ConversationList({ onStartSearch }: { onStartSearch: () => void }) {
  const {
    conversations,
    conversationsLoading,
    conversationsError,
    currentUserId,
    refreshConversations,
  } = useMessaging();
  const pathname = usePathname();
  const now = useNow(TICK_MS);

  const visible = conversations.filter((c) => c.status !== "declined");
  const requests = visible.filter((c) => c.status === "pending" && c.initiatedBy !== currentUserId);
  const chats = visible.filter((c) => !requests.includes(c));

  if (visible.length === 0) {
    if (conversationsError) {
      return (
        <div className="conv-list__state" role="alert">
          <p className="empty">Could not load conversations.</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshConversations()}>
            Try again
          </button>
        </div>
      );
    }
    if (conversationsLoading) {
      return <ConversationListSkeleton />;
    }
    return (
      <div className="conv-list__state">
        <p className="empty">No conversations yet.</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onStartSearch}>
          Find people to message
        </button>
      </div>
    );
  }

  const renderRow = (c: Conversation) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      currentUserId={currentUserId}
      active={pathname === `/app/c/${c.id}`}
      now={now}
    />
  );

  return (
    <div className="conv-list">
      {conversationsError && (
        <p className="conv-list__notice" role="status">
          Could not refresh.{" "}
          <button type="button" className="conv-list__retry" onClick={() => void refreshConversations()}>
            Retry
          </button>
        </p>
      )}
      {requests.length > 0 && (
        <section aria-labelledby="conv-requests-heading">
          <h2 id="conv-requests-heading" className="shell__heading">
            Requests <span className="conv-list__count">{requests.length}</span>
          </h2>
          <ul className="conv-list__items">{requests.map(renderRow)}</ul>
        </section>
      )}
      <section aria-labelledby="conv-chats-heading">
        <h2 id="conv-chats-heading" className="shell__heading">
          Chats
        </h2>
        {chats.length > 0 ? (
          <ul className="conv-list__items">{chats.map(renderRow)}</ul>
        ) : (
          <p className="empty conv-list__hint">No chats yet.</p>
        )}
      </section>
    </div>
  );
}

function ConversationRow({
  conversation: c,
  currentUserId,
  active,
  now,
}: {
  conversation: Conversation;
  currentUserId: string | null;
  active: boolean;
  now: Date;
}) {
  const name = c.peer.displayName?.trim() || `@${c.peer.username}`;
  const showUsername = Boolean(c.peer.displayName?.trim());
  const unread = c.unreadCount;
  const preview = previewText(c, currentUserId);
  const time = c.lastMessage?.createdAt ?? c.updatedAt;

  return (
    <li>
      <Link
        href={`/app/c/${c.id}`}
        className={`conv-row${active ? " conv-row--active" : ""}${unread > 0 ? " conv-row--unread" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        <Avatar src={c.peer.avatarUrl} alt={name} size="md" />
        <span className="conv-row__body">
          <span className="conv-row__top">
            <span className="conv-row__name">
              {name}
              {showUsername && <span className="conv-row__username"> @{c.peer.username}</span>}
            </span>
            {/* Server and client clocks can differ by a minute at render time. */}
            <time
              className="conv-row__time"
              dateTime={time}
              title={formatFullTimestamp(time)}
              suppressHydrationWarning
            >
              {formatRelativeTime(time, now)}
            </time>
          </span>
          <span className="conv-row__bottom">
            <span className="conv-row__preview">{preview}</span>
            {unread > 0 && (
              <span className="conv-row__badge">
                {unread > 99 ? "99+" : unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function previewText(c: Conversation, currentUserId: string | null): string {
  if (c.lastMessage) {
    const own = currentUserId !== null && c.lastMessage.senderId === currentUserId;
    return own ? `You: ${c.lastMessage.content}` : c.lastMessage.content;
  }
  if (c.status === "pending") {
    return c.initiatedBy === currentUserId ? "Request sent" : "Wants to message you";
  }
  return "No messages yet";
}

function ConversationListSkeleton() {
  return (
    <ul className="conv-list__items" aria-busy="true" aria-label="Loading conversations">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <li key={i} className="conv-row conv-row--skeleton">
          <SkeletonAvatar size="md" />
          <span className="conv-row__body">
            <SkeletonText className="conv-skel__name" />
            <SkeletonText className="conv-skel__preview" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Current time, refreshed every `intervalMs`, so relative timestamps stay current. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
