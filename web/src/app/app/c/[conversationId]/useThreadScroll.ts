"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { UiMessage } from "@/lib/messaging/state";

/** Within this many pixels of the newest message counts as "at the bottom". */
const BOTTOM_SLACK_PX = 80;
/** Start fetching older messages this far before the top is reached. */
const PRELOAD_MARGIN = "240px 0px 0px 0px";

/**
 * Scroll behaviour for a thread whose scroller uses `flex-direction:
 * column-reverse`, so scrollTop is 0 at the newest message and negative above.
 *
 * - Fetches older pages when the top sentinel nears the viewport.
 * - Keeps the reader's place when messages arrive while they are scrolled up,
 *   and counts the peer's unseen messages for a "new messages" pill.
 * - Jumps to the newest message when I send one.
 */
export function useThreadScroll({
  conversationId,
  messages,
  currentUserId,
  canLoadOlder,
  loadOlder,
}: {
  conversationId: string;
  messages: UiMessage[];
  currentUserId: string | null;
  /** True when another older page exists and no fetch or error is pending. */
  canLoadOlder: boolean;
  loadOlder: () => void;
}): {
  scrollRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  atBottom: boolean;
  unseen: number;
  jumpToLatest: () => void;
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Last message key the reader had seen when they scrolled away from the bottom.
  const [seenKey, setSeenKey] = useState<string | null>(null);

  const atBottomRef = useRef(true);
  const lastKey = messages[messages.length - 1]?.clientMessageId ?? null;
  const lastKeyRef = useRef(lastKey);
  const heightRef = useRef(0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = Math.abs(el.scrollTop) < BOTTOM_SLACK_PX;
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
      setSeenKey(lastKeyRef.current);
    }
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, []);

  // A different conversation starts at its newest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    heightRef.current = el?.scrollHeight ?? 0;
  }, [conversationId]);

  // React to a new newest message. Prepended (older) pages need nothing: the
  // reversed scroller is anchored at the bottom, so the view does not move.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prevKey = lastKeyRef.current;
    lastKeyRef.current = lastKey;
    if (!el) return;
    const grown = el.scrollHeight - heightRef.current;
    heightRef.current = el.scrollHeight;
    if (lastKey === null || lastKey === prevKey) return;

    const last = messages[messages.length - 1];
    if (last && last.senderId === currentUserId) {
      el.scrollTop = 0; // my own message: always show it
    } else if (!atBottomRef.current && grown > 0) {
      el.scrollTop -= grown; // keep what the reader is looking at in place
    }
  }, [lastKey, messages, currentUserId]);

  // Load older pages as the top comes into view. Recreated after each load, so
  // a short thread keeps filling until it scrolls or runs out of history.
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!canLoadOlder || !root || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder();
      },
      { root, rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadOlder, loadOlder, conversationId]);

  let unseen = 0;
  if (!atBottom && seenKey !== null) {
    const from = messages.findIndex((m) => m.clientMessageId === seenKey);
    if (from !== -1) {
      unseen = messages.slice(from + 1).filter((m) => m.senderId !== currentUserId).length;
    }
  }

  return { scrollRef, sentinelRef, onScroll, atBottom, unseen, jumpToLatest };
}
