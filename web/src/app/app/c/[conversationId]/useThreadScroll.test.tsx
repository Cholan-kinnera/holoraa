// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UiMessage } from "@/lib/messaging/state";

import { useThreadScroll } from "./useThreadScroll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Minimal IntersectionObserver: tests trigger intersections by hand.
const observers: { cb: IntersectionObserverCallback; disconnected: boolean }[] = [];
class FakeObserver {
  entry: { cb: IntersectionObserverCallback; disconnected: boolean };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}
function intersect() {
  for (const o of observers.filter((x) => !x.disconnected)) {
    o.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  }
}

const ME = "me";
const BOB = "bob";
let n = 0;
const msg = (senderId: string): UiMessage => {
  n += 1;
  return {
    id: `m${n}`,
    conversationId: "c",
    senderId,
    clientMessageId: `k${n}`,
    content: `message ${n}`,
    sequenceNum: n,
    createdAt: new Date(2026, 10, 25, 9, n).toISOString(),
    deliveryStatus: "sent",
  };
};

type Hook = ReturnType<typeof useThreadScroll>;

describe("useThreadScroll", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: Hook;
  let scrollTop = 0;
  let scrollHeight = 1000;

  function Harness(props: { messages: UiMessage[]; canLoadOlder: boolean; loadOlder: () => void }) {
    hook = useThreadScroll({ conversationId: "c", currentUserId: ME, ...props });
    return (
      <div
        ref={(el) => {
          hook.scrollRef.current = el;
          if (el) {
            Object.defineProperty(el, "scrollTop", { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) });
            Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
          }
        }}
      >
        <div ref={hook.sentinelRef} />
      </div>
    );
  }

  const render = (messages: UiMessage[], canLoadOlder = false, loadOlder = vi.fn()) =>
    act(() => root.render(<Harness messages={messages} canLoadOlder={canLoadOlder} loadOlder={loadOlder} />));

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    observers.length = 0;
    scrollTop = 0;
    scrollHeight = 1000;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("loads older messages when the top comes into view, only when allowed", async () => {
    const loadOlder = vi.fn();
    await render([msg(BOB)], false, loadOlder);
    intersect();
    expect(loadOlder).not.toHaveBeenCalled();

    await render([msg(BOB)], true, loadOlder);
    intersect();
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it("counts the peer's new messages while scrolled up and keeps the reader's place", async () => {
    const history = [msg(BOB), msg(ME)];
    await render(history);

    scrollTop = -500;
    act(() => hook.onScroll());
    expect(hook.atBottom).toBe(false);
    expect(hook.unseen).toBe(0);

    scrollHeight = 1060;
    await render([...history, msg(BOB)]);
    expect(hook.unseen).toBe(1);
    expect(scrollTop).toBe(-560); // shifted by the new content's height

    scrollTop = 0;
    act(() => hook.onScroll());
    expect(hook.atBottom).toBe(true);
    expect(hook.unseen).toBe(0);
  });

  it("jumps to the newest message when I send one", async () => {
    const history = [msg(BOB)];
    await render(history);
    scrollTop = -500;
    act(() => hook.onScroll());

    scrollHeight = 1060;
    await render([...history, msg(ME)]);
    expect(scrollTop).toBe(0);
  });
});
