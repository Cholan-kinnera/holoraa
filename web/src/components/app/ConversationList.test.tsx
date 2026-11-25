// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/auth/flows";
import type { Conversation } from "@/lib/messaging/flows";
import { MessagingProvider } from "@/lib/messaging/MessagingProvider";

import { ConversationList } from "./ConversationList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  getConversationsAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/app/messages/actions", () => ({
  getConversationsAction: mocks.getConversationsAction,
  getMessagesAction: vi.fn(),
  markConversationReadAction: vi.fn(),
  sendMessageAction: vi.fn(),
  acceptMessageRequestAction: vi.fn(),
  declineMessageRequestAction: vi.fn(),
  issueRealtimeTicketAction: vi.fn(),
  markMessageDeliveredAction: vi.fn(),
}));

const me: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  bio: null,
  avatarUrl: null,
  profileComplete: true,
};

function conv(n: number, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: `3333333${n}-3333-4333-8333-333333333333`,
    type: "direct",
    status: "accepted",
    initiatedBy: me.id,
    lastMessageSequence: 1,
    peer: {
      id: `2222222${n}-2222-4222-8222-222222222222`,
      username: `peer${n}`,
      displayName: `Peer ${n}`,
      bio: null,
      avatarUrl: null,
    },
    unreadCount: 0,
    updatedAt: "2026-11-25T08:00:00Z",
    createdAt: "2026-11-20T08:00:00Z",
    ...overrides,
  };
}

describe("ConversationList", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onStartSearch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    mocks.pathname = "/app";
    mocks.getConversationsAction.mockReset();
    onStartSearch.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(initialConversations?: Conversation[]) {
    await act(async () => {
      root.render(
        <MessagingProvider user={me} initialConversations={initialConversations} socketOptions={{ enabled: false }}>
          <ConversationList onStartSearch={onStartSearch} />
        </MessagingProvider>,
      );
    });
  }

  const rows = () => Array.from(container.querySelectorAll<HTMLAnchorElement>("a.conv-row"));

  it("renders name, username, preview, time and links each row to its conversation", async () => {
    const c = conv(1, {
      lastMessage: { id: "m1", senderId: "22222221-2222-4222-8222-222222222222", content: "See you at 6", createdAt: "2026-11-25T11:55:00Z" },
    });
    await render([c]);

    const [row] = rows();
    expect(row?.getAttribute("href")).toBe(`/app/c/${c.id}`);
    expect(row?.textContent).toContain("Peer 1");
    expect(row?.textContent).toContain("@peer1");
    expect(row?.textContent).toContain("See you at 6");
    expect(row?.querySelector("time")?.textContent).toBe("5m");
    expect(row?.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-25T11:55:00Z");
  });

  it("prefixes my own last message with 'You:' and falls back to @username without a display name", async () => {
    await render([
      conv(1, {
        peer: { id: "22222221-2222-4222-8222-222222222222", username: "bob", displayName: null, bio: null, avatarUrl: null },
        lastMessage: { id: "m1", senderId: me.id, content: "On my way", createdAt: "2026-11-25T11:00:00Z" },
      }),
    ]);
    const text = rows()[0]?.textContent ?? "";
    expect(text).toContain("@bob");
    expect(text).toContain("You: On my way");
  });

  it("shows an unread badge, capped at 99+, and marks unread rows", async () => {
    await render([conv(1, { unreadCount: 3 }), conv(2, { unreadCount: 250 }), conv(3)]);
    const badges = Array.from(container.querySelectorAll(".conv-row__badge")).map((b) => b.textContent);
    expect(badges).toEqual(["3 unread", "99+ unread"]);
    expect(rows().filter((r) => r.classList.contains("conv-row--unread"))).toHaveLength(2);
  });

  it("orders rows by latest message", async () => {
    await render([
      conv(1, { lastMessage: { id: "a", senderId: me.id, content: "old", createdAt: "2026-11-25T09:00:00Z" } }),
      conv(2, { lastMessage: { id: "b", senderId: me.id, content: "new", createdAt: "2026-11-25T11:00:00Z" } }),
    ]);
    expect(rows().map((r) => r.textContent?.includes("Peer 2"))).toEqual([true, false]);
  });

  it("highlights the active conversation with aria-current", async () => {
    const a = conv(1);
    const b = conv(2);
    mocks.pathname = `/app/c/${b.id}`;
    await render([a, b]);
    const active = rows().filter((r) => r.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("href")).toBe(`/app/c/${b.id}`);
    expect(active[0]?.classList.contains("conv-row--active")).toBe(true);
  });

  it("lists incoming requests above chats and hides declined conversations", async () => {
    const request = conv(1, { status: "pending", initiatedBy: "22222221-2222-4222-8222-222222222222" });
    const outgoing = conv(2, { status: "pending" });
    const declined = conv(3, { status: "declined" });
    await render([request, outgoing, declined]);

    const sections = Array.from(container.querySelectorAll("section"));
    expect(sections[0]?.querySelector("h2")?.textContent).toContain("Requests");
    expect(sections[0]?.textContent).toContain("Wants to message you");
    expect(sections[1]?.querySelector("h2")?.textContent).toBe("Chats");
    expect(sections[1]?.textContent).toContain("Request sent");
    expect(container.textContent).not.toContain("Peer 3");
  });

  it("shows the empty state and opens search from it", async () => {
    await render([]);
    expect(container.textContent).toContain("No conversations yet.");
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Find people to message");
    await act(async () => button?.click());
    expect(onStartSearch).toHaveBeenCalledOnce();
    expect(mocks.getConversationsAction).not.toHaveBeenCalled();
  });

  it("shows skeleton rows while the first fetch is pending", async () => {
    mocks.getConversationsAction.mockReturnValue(new Promise(() => {}));
    await render(undefined);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("shows an error with a retry that refetches", async () => {
    mocks.getConversationsAction
      .mockResolvedValueOnce({ ok: false, message: "Service unavailable." })
      .mockResolvedValueOnce({ ok: true, conversations: [conv(1)] });
    await render(undefined);
    expect(container.textContent).toContain("Could not load conversations.");

    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again");
    await act(async () => retry?.click());
    expect(mocks.getConversationsAction).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(1);
  });
});
