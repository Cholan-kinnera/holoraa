// @vitest-environment jsdom
// P0.1 sidebar behaviour of MessagingProvider: realtime unread counts, read state,
// and refetching on unknown conversations, reconnect and window focus.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/auth/flows";
import type { Conversation } from "./flows";
import { MessagingProvider, useMessaging, type MessagingContextValue } from "./MessagingProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  getConversationsAction: vi.fn(),
  markConversationReadAction: vi.fn(),
}));

vi.mock("@/app/app/messages/actions", () => ({
  ...actions,
  getMessagesAction: vi.fn(),
  sendMessageAction: vi.fn(),
  acceptMessageRequestAction: vi.fn(),
  declineMessageRequestAction: vi.fn(),
  issueRealtimeTicketAction: vi.fn(),
  markMessageDeliveredAction: vi.fn(),
}));

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState: number = WebSocket.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send() {}
  close(code = 1000, reason = "") {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }
  emit(type: string, payload: object) {
    const envelope = { v: 1, id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), payload };
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(envelope) }));
  }
}

const me: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  bio: null,
  avatarUrl: null,
  profileComplete: true,
};
const BOB = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const bobConversation: Conversation = {
  id: CONV,
  type: "direct",
  status: "accepted",
  initiatedBy: me.id,
  lastMessageSequence: 1,
  peer: { id: BOB, username: "bob", displayName: "Bob", bio: null, avatarUrl: null },
  unreadCount: 0,
  updatedAt: "2026-11-25T08:00:00Z",
  createdAt: "2026-11-20T08:00:00Z",
  lastMessage: { id: "m-last", senderId: BOB, content: "hi", createdAt: "2026-11-25T08:00:00Z" },
};

let seq = 1;
const messageCreated = (conversationId: string) => {
  seq += 1;
  return {
    messageId: crypto.randomUUID(),
    conversationId,
    senderId: BOB,
    clientMessageId: crypto.randomUUID(),
    content: `msg ${seq}`,
    sequenceNum: seq,
    createdAt: new Date().toISOString(),
  };
};

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe("MessagingProvider sidebar behaviour", () => {
  let container: HTMLDivElement;
  let root: Root;
  let ctx: MessagingContextValue;

  function Probe() {
    ctx = useMessaging();
    return null;
  }

  beforeEach(() => {
    FakeSocket.all = [];
    actions.getConversationsAction.mockReset().mockResolvedValue({ ok: true, conversations: [bobConversation] });
    actions.markConversationReadAction.mockReset().mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // `null` means "not hydrated by the server" (undefined would trigger the default).
  async function mount(hydrated: Conversation[] | null = [bobConversation]) {
    const initialConversations = hydrated ?? undefined;
    await act(async () => {
      root.render(
        <MessagingProvider
          user={me}
          initialConversations={initialConversations}
          socketOptions={{
            issueTicket: async () => ({ ok: true, ticket: "t" }),
            webSocketFactory: () => new FakeSocket() as unknown as WebSocket,
            autoAcknowledgeDelivery: false,
            baseReconnectDelayMs: 1,
            maxReconnectDelayMs: 1,
          }}
        >
          <Probe />
        </MessagingProvider>,
      );
    });
    await flush();
    const socket = FakeSocket.all[0];
    if (!socket) throw new Error("socket not created");
    await act(async () => socket.open());
    return socket;
  }

  const unread = () => ctx.conversations.find((c) => c.id === CONV)?.unreadCount;

  it("uses server-hydrated conversations without fetching on mount", async () => {
    await mount();
    expect(actions.getConversationsAction).not.toHaveBeenCalled();
    expect(ctx.conversations).toHaveLength(1);
  });

  it("fetches on mount when the server did not hydrate the list", async () => {
    await mount(null);
    expect(actions.getConversationsAction).toHaveBeenCalledTimes(1);
  });

  it("counts each realtime message exactly once (subscriptions are not duplicated)", async () => {
    const socket = await mount();
    await act(async () => socket.emit("message.created", messageCreated(CONV)));
    await act(async () => socket.emit("message.created", messageCreated(CONV)));
    expect(unread()).toBe(2);
  });

  it("marks the open conversation read as messages arrive", async () => {
    const socket = await mount();
    await act(async () => ctx.selectConversation(CONV));
    const event = messageCreated(CONV);
    await act(async () => socket.emit("message.created", event));
    await flush();
    expect(unread()).toBe(0);
    expect(actions.markConversationReadAction).toHaveBeenCalledWith(CONV, event.messageId);
  });

  it("markAsRead falls back to the list's last message and clears unread on success", async () => {
    await mount([{ ...bobConversation, unreadCount: 5 }]);
    await act(async () => ctx.markAsRead(CONV));
    expect(actions.markConversationReadAction).toHaveBeenCalledWith(CONV, "m-last");
    expect(unread()).toBe(0);
  });

  it("keeps the unread count when the server rejects the read", async () => {
    actions.markConversationReadAction.mockResolvedValue({ ok: false, message: "nope" });
    await mount([{ ...bobConversation, unreadCount: 5 }]);
    await act(async () => ctx.markAsRead(CONV));
    expect(unread()).toBe(5);
  });

  it("refetches when a message arrives for an unknown conversation", async () => {
    const socket = await mount();
    await act(async () => socket.emit("message.created", messageCreated(OTHER)));
    await flush();
    expect(actions.getConversationsAction).toHaveBeenCalledTimes(1);
  });

  it("refetches after the socket reconnects, but not on the first connect", async () => {
    const socket = await mount();
    expect(actions.getConversationsAction).not.toHaveBeenCalled();

    await act(async () => socket.close(1006, "network"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const second = FakeSocket.all[1];
    expect(second).toBeDefined();
    await act(async () => second?.open());
    await flush();
    expect(actions.getConversationsAction).toHaveBeenCalledTimes(1);
  });

  it("refetches on window focus, throttled", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await mount();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(actions.getConversationsAction).not.toHaveBeenCalled(); // within 15 s of the server fetch

    now.mockReturnValue(1_000_000 + 16_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(actions.getConversationsAction).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});
