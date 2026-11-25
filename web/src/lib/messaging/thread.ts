import { formatDayLabel, isSameLocalDay } from "@/lib/time";

import type { UiMessage } from "./state";

/** Messages from one sender closer together than this share a group. */
export const GROUP_GAP_MS = 5 * 60_000;

export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "group"; key: string; senderId: string; mine: boolean; messages: UiMessage[] };

/**
 * Splits an ascending message list into day separators and sender groups.
 * A group ends when the sender changes, the local day changes, or the gap
 * between two messages exceeds GROUP_GAP_MS.
 */
export function buildThread(
  messages: UiMessage[],
  currentUserId: string | null,
  now: Date = new Date(),
  locale?: string,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  let group: Extract<ThreadItem, { kind: "group" }> | null = null;
  let prev: UiMessage | null = null;

  for (const msg of messages) {
    const newDay = !prev || !isSameLocalDay(prev.createdAt, msg.createdAt);
    if (newDay) {
      items.push({ kind: "day", key: `day-${msg.id}`, label: formatDayLabel(msg.createdAt, now, locale) });
    }

    const gap = prev ? Date.parse(msg.createdAt) - Date.parse(prev.createdAt) : Infinity;
    if (!group || newDay || group.senderId !== msg.senderId || gap > GROUP_GAP_MS) {
      group = {
        kind: "group",
        // Keyed by the first message's client id, which stays stable when an
        // optimistic message is confirmed and its id changes.
        key: `group-${msg.clientMessageId}`,
        senderId: msg.senderId,
        mine: msg.senderId === currentUserId,
        messages: [],
      };
      items.push(group);
    }
    group.messages.push(msg);
    prev = msg;
  }

  return items;
}
