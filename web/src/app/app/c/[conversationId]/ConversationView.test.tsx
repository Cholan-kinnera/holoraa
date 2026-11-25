// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/auth/flows";
import type { Conversation, Message } from "@/lib/messaging/flows";
import { MessagingProvider } from "@/lib/messaging/MessagingProvider";

import { ConversationView } from "./ConversationView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/c/x",
}));

const ME: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  bio: null,
  avatarUrl: null,
  profileComplete: true,
};
const BOB = { id: "22222222-2222-4222-8222-222222222222", username: "bob", displayName: "Bob", bio: null, avatarUrl: null };
const CONV_ID = "33333333-3333-4333-8333-333333333333";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    type: "direct",
    status: "accepted",
    initiatedBy: ME.id,
    lastMessageSequence: 1,
    peer: BOB,
    unreadCount: 0,
    updatedAt: "2026-11-25T10:00:00Z",
    createdAt: "2026-11-25T09:00:00Z",
    ...overrides,
  };
}

const myMessage: Message = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conversationId: CONV_ID,
  senderId: ME.id,
  clientMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  content: "Hi Bob",
  sequenceNum: 1,
  createdAt: "2026-11-25T10:00:00Z",
};

describe("ConversationView composer rules", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const actions = await import("@/app/app/messages/actions");
    vi.spyOn(actions, "getMessagesAction").mockResolvedValue({ ok: true, messages: [], hasMore: false });
    vi.spyOn(actions, "markConversationReadAction").mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    routerPush.mockReset();
  });

  async function render(conv: Conversation, messages: Message[] = [myMessage]) {
    await act(async () => {
      root.render(
        <MessagingProvider user={ME} initialConversations={[conv]}>
          <ConversationView
            conversationId={CONV_ID}
            initialConversation={conv}
            initialMessages={messages}
            initialHasMore={false}
          />
        </MessagingProvider>,
      );
    });
  }
  const textarea = () => container.querySelector("textarea");

  it("is open in an accepted conversation", async () => {
    await render(conversation());
    expect(textarea()?.disabled).toBe(false);
  });

  it("locks for the recipient of a pending request", async () => {
    await render(conversation({ status: "pending", initiatedBy: BOB.id }), []);
    expect(textarea()?.disabled).toBe(true);
    expect(container.textContent).toContain("Accept the request to reply to Bob.");
  });

  it("lets the sender of a pending request send a first message", async () => {
    await render(conversation({ status: "pending" }), []);
    expect(textarea()?.disabled).toBe(false);
  });

  it("locks the sender of a pending request after that one message", async () => {
    await render(conversation({ status: "pending" }), [myMessage]);
    expect(textarea()?.disabled).toBe(true);
    expect(container.textContent).toContain("once Bob accepts");
  });

  it("locks a declined conversation", async () => {
    await render(conversation({ status: "declined", initiatedBy: BOB.id }));
    expect(textarea()?.disabled).toBe(true);
  });
});
