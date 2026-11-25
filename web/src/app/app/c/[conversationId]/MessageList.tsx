"use client";

import { useMemo } from "react";

import type { MessageDeliveryStatus, UiMessage } from "@/lib/messaging/state";
import { buildThread } from "@/lib/messaging/thread";
import { formatClockTime, formatFullTimestamp } from "@/lib/time";

const STATUS_LABEL: Record<MessageDeliveryStatus, string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Not sent",
};

/** Delivery indicator for my own messages: clock, one tick, two ticks, or two accent ticks. */
export function StatusTick({ status }: { status: MessageDeliveryStatus }) {
  const label = STATUS_LABEL[status];
  if (status === "failed") {
    return <span className="msg-status msg-status--failed">{label}</span>;
  }
  return (
    <span className={`msg-status msg-status--${status}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true" focusable="false">
        {status === "sending" ? (
          <>
            <circle cx="9" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9 3.6V6l1.7 1.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path
              d="M1.5 6.5 4.6 9.5 11 2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {status !== "sent" && (
              <path
                d="M7.6 9.2 7.9 9.5 14.3 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </>
        )}
      </svg>
    </span>
  );
}

/**
 * Chronological message thread: day separators, then bubbles grouped by
 * sender. Time and delivery status sit under the last bubble of each group.
 */
export function MessageList({
  messages,
  currentUserId,
}: {
  messages: UiMessage[];
  currentUserId: string | null;
}) {
  const items = useMemo(() => buildThread(messages, currentUserId), [messages, currentUserId]);

  return (
    <ol className="thread__list" aria-label="Messages">
      {items.map((item) => {
        if (item.kind === "day") {
          return (
            <li key={item.key} className="day-sep">
              <span className="day-sep__label">{item.label}</span>
            </li>
          );
        }

        const last = item.messages[item.messages.length - 1]!;
        return (
          <li key={item.key} className={item.mine ? "msg-group msg-group--mine" : "msg-group"}>
            {item.messages.map((m) => (
              <p
                key={m.clientMessageId}
                className={`msg msg--${m.deliveryStatus}`}
                title={formatFullTimestamp(m.createdAt)}
              >
                <span className="sr-only">{item.mine ? "You: " : ""}</span>
                {m.content}
                {m.deliveryStatus === "failed" && <span className="sr-only"> (not sent)</span>}
              </p>
            ))}
            <p className="msg-group__meta">
              <time dateTime={last.createdAt} title={formatFullTimestamp(last.createdAt)}>
                {formatClockTime(last.createdAt)}
              </time>
              {item.mine && <StatusTick status={last.deliveryStatus} />}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
