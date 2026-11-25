import { describe, expect, it } from "vitest";

import type { Conversation, Message } from "./flows";
import type { MessageCreatedPayload } from "./realtime-types";
import {
  initialMessagingState,
  messagingReducer,
  toUiMessage,
  type MessagingState,
  type UiMessage,
} from "./state";

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "44444444-4444-4444-8444-444444444444";
const CONV_BOB = "33333333-3333-4333-8333-333333333333";
const CONV_CAROL = "55555555-5555-4555-8555-555555555555";
const CONV_NEW = "66666666-6666-4666-8666-666666666666";

function conv(id: string, peerId: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    type: "direct",
    status: "accepted",
    initiatedBy: ME,
    lastMessageSequence: 1,
    peer: { id: peerId, username: peerId === BOB ? "bob" : "carol", displayName: null, bio: null, avatarUrl: null },
    unreadCount: 0,
    updatedAt: "2026-11-25T08:00:00Z",
    createdAt: "2026-11-20T08:00:00Z",
    ...overrides,
  };
}

function stateWith(conversations: Conversation[], active: string | null = null): MessagingState {
  return { ...initialMessagingState, currentUserId: ME, conversations, activeConversationId: active };
}

let seq = 10;
function created(conversationId: string, senderId: string, messageId = crypto.randomUUID()): MessageCreatedPayload {
  seq += 1;
  return {
    messageId,
    conversationId,
    senderId,
    clientMessageId: crypto.randomUUID(),
    content: `hello ${seq}`,
    sequenceNum: seq,
    createdAt: `2026-11-25T10:${String(seq).padStart(2, "0")}:00Z`,
  };
}

const unreadOf = (s: MessagingState, id: string) => s.conversations.find((c) => c.id === id)?.unreadCount;

describe("messagingReducer: sidebar state", () => {
  it("counts a peer message in a conversation that is not open", () => {
    const s = messagingReducer(stateWith([conv(CONV_BOB, BOB)]), {
      type: "REALTIME_MESSAGE_CREATED",
      payload: created(CONV_BOB, BOB),
    });
    expect(unreadOf(s, CONV_BOB)).toBe(1);
  });

  it("does not count the open conversation or my own messages", () => {
    const open = messagingReducer(stateWith([conv(CONV_BOB, BOB)], CONV_BOB), {
      type: "REALTIME_MESSAGE_CREATED",
      payload: created(CONV_BOB, BOB),
    });
    expect(unreadOf(open, CONV_BOB)).toBe(0);

    const mine = messagingReducer(stateWith([conv(CONV_BOB, BOB)]), {
      type: "REALTIME_MESSAGE_CREATED",
      payload: created(CONV_BOB, ME),
    });
    expect(unreadOf(mine, CONV_BOB)).toBe(0);
  });

  it("counts the same message only once", () => {
    const event = created(CONV_BOB, BOB);
    let s = stateWith([conv(CONV_BOB, BOB, { unreadCount: 2 })]);
    s = messagingReducer(s, { type: "REALTIME_MESSAGE_CREATED", payload: event });
    s = messagingReducer(s, { type: "REALTIME_MESSAGE_CREATED", payload: event });
    expect(unreadOf(s, CONV_BOB)).toBe(3);
  });

  it("updates the preview and moves the conversation to the top", () => {
    const s0 = stateWith([
      conv(CONV_CAROL, CAROL, { updatedAt: "2026-11-25T09:00:00Z" }),
      conv(CONV_BOB, BOB, { updatedAt: "2026-11-25T08:00:00Z" }),
    ]);
    const event = created(CONV_BOB, BOB);
    const s = messagingReducer(s0, { type: "REALTIME_MESSAGE_CREATED", payload: event });
    expect(s.conversations.map((c) => c.id)).toEqual([CONV_BOB, CONV_CAROL]);
    expect(s.conversations[0]?.lastMessage?.content).toBe(event.content);
    expect(s.conversations[0]?.lastMessageSequence).toBe(event.sequenceNum);
  });

  it("reorders on conversation.updated", () => {
    const s0 = stateWith([
      conv(CONV_CAROL, CAROL, { updatedAt: "2026-11-25T09:00:00Z" }),
      conv(CONV_BOB, BOB, { updatedAt: "2026-11-25T08:00:00Z" }),
    ]);
    const s = messagingReducer(s0, {
      type: "REALTIME_CONVERSATION_UPDATED",
      payload: { conversationId: CONV_BOB, status: "accepted", updatedAt: "2026-11-25T11:00:00Z" },
    });
    expect(s.conversations.map((c) => c.id)).toEqual([CONV_BOB, CONV_CAROL]);
  });

  it("clears unread when a conversation is selected or marked read", () => {
    const s0 = stateWith([conv(CONV_BOB, BOB, { unreadCount: 4 }), conv(CONV_CAROL, CAROL, { unreadCount: 2 })]);
    const selected = messagingReducer(s0, { type: "SELECT_CONVERSATION", conversationId: CONV_BOB });
    expect(unreadOf(selected, CONV_BOB)).toBe(0);
    expect(unreadOf(selected, CONV_CAROL)).toBe(2);

    const marked = messagingReducer(s0, { type: "CONVERSATION_MARKED_READ", conversationId: CONV_CAROL });
    expect(unreadOf(marked, CONV_CAROL)).toBe(0);
  });

  it("flags the list stale for unknown conversations, and clears it on fetch success or error", () => {
    const s0 = stateWith([conv(CONV_BOB, BOB)]);
    const fromMessage = messagingReducer(s0, {
      type: "REALTIME_MESSAGE_CREATED",
      payload: created(CONV_NEW, CAROL),
    });
    expect(fromMessage.conversationsStale).toBe(true);
    expect(fromMessage.conversations).toEqual(s0.conversations);

    const fromUpdate = messagingReducer(s0, {
      type: "REALTIME_CONVERSATION_UPDATED",
      payload: { conversationId: CONV_NEW, status: "pending", updatedAt: "2026-11-25T11:00:00Z" },
    });
    expect(fromUpdate.conversationsStale).toBe(true);

    expect(messagingReducer(fromMessage, { type: "CONVERSATIONS_SUCCESS", conversations: [] }).conversationsStale).toBe(false);
    expect(messagingReducer(fromMessage, { type: "CONVERSATIONS_ERROR", error: "x" }).conversationsStale).toBe(false);
  });
});

describe("messagingReducer: message status (P0.2 slice A)", () => {
  const MSG = "77777777-7777-4777-8777-777777777777";
  const CLIENT = "88888888-8888-4888-8888-888888888888";

  function serverMessage(overrides: Partial<Message> = {}): Message {
    return {
      id: MSG,
      conversationId: CONV_BOB,
      senderId: ME,
      clientMessageId: CLIENT,
      content: "hi",
      sequenceNum: 5,
      createdAt: "2026-11-25T10:00:00Z",
      ...overrides,
    };
  }

  function withMessages(messages: UiMessage[], conversations = [conv(CONV_BOB, BOB)]): MessagingState {
    return { ...stateWith(conversations, CONV_BOB), messages: { [CONV_BOB]: messages } };
  }

  const statusOf = (s: MessagingState, id = MSG) =>
    s.messages[CONV_BOB]?.find((m) => m.id === id)?.deliveryStatus;

  it("never downgrades delivered when a late HTTP confirmation arrives", () => {
    let s = withMessages([toUiMessage(serverMessage(), ME)]);
    s = messagingReducer(s, {
      type: "REALTIME_MESSAGE_DELIVERED",
      payload: { conversationId: CONV_BOB, messageId: MSG },
    });
    expect(statusOf(s)).toBe("delivered");

    s = messagingReducer(s, {
      type: "OPTIMISTIC_MESSAGE_CONFIRMED",
      conversationId: CONV_BOB,
      clientMessageId: CLIENT,
      confirmedMessage: serverMessage(),
    });
    expect(statusOf(s)).toBe("delivered");
  });

  it("still upgrades a status through reconciliation", () => {
    const s = messagingReducer(withMessages([toUiMessage(serverMessage(), ME)]), {
      type: "MESSAGES_SUCCESS",
      conversationId: CONV_BOB,
      messages: [serverMessage({ deliveredAt: "2026-11-25T10:00:01Z", readAt: "2026-11-25T10:01:00Z" })],
    });
    expect(statusOf(s)).toBe("read");
  });

  it("marks only my messages read when the peer reads", () => {
    const PEER_MSG = "99999999-9999-4999-8999-999999999999";
    const mine = toUiMessage(serverMessage({ sequenceNum: 4 }), ME);
    const theirs: UiMessage = {
      ...toUiMessage(serverMessage({ id: PEER_MSG, senderId: BOB, clientMessageId: crypto.randomUUID() }), ME),
      deliveryStatus: "delivered",
    };
    const s = messagingReducer(withMessages([mine, theirs]), {
      type: "REALTIME_MESSAGE_READ",
      payload: {
        conversationId: CONV_BOB,
        userId: BOB,
        messageId: PEER_MSG,
        sequenceNum: 5,
        readAt: "2026-11-25T10:02:00Z",
      },
    });
    expect(statusOf(s, MSG)).toBe("read");
    expect(statusOf(s, PEER_MSG)).toBe("delivered");
  });

  it("swaps the optimistic id in the sidebar preview once the send is confirmed", () => {
    const optimistic: UiMessage = {
      ...toUiMessage(serverMessage({ id: `opt-${CLIENT}`, sequenceNum: 0 }), ME, "sending"),
      isOptimistic: true,
    };
    let s = messagingReducer(withMessages([]), {
      type: "OPTIMISTIC_MESSAGE_ENQUEUE",
      conversationId: CONV_BOB,
      optimisticMessage: optimistic,
    });
    expect(s.conversations[0]?.lastMessage?.id).toBe(`opt-${CLIENT}`);

    s = messagingReducer(s, {
      type: "OPTIMISTIC_MESSAGE_CONFIRMED",
      conversationId: CONV_BOB,
      clientMessageId: CLIENT,
      confirmedMessage: serverMessage(),
    });
    expect(s.conversations[0]?.lastMessage?.id).toBe(MSG);
    expect(s.conversations[0]?.lastMessageSequence).toBe(5);

    // The echoed realtime event is then recognised: no unread bump, no duplicate.
    s = messagingReducer(s, {
      type: "REALTIME_MESSAGE_CREATED",
      payload: { ...created(CONV_BOB, ME, MSG), clientMessageId: CLIENT, sequenceNum: 5 },
    });
    expect(s.messages[CONV_BOB]).toHaveLength(1);
    expect(unreadOf(s, CONV_BOB)).toBe(0);
  });

  it("leaves a newer sidebar preview alone when an older send confirms", () => {
    const newer = { id: "newer", senderId: BOB, content: "later", createdAt: "2026-11-25T11:00:00Z" };
    const optimistic: UiMessage = {
      ...toUiMessage(serverMessage({ id: `opt-${CLIENT}`, sequenceNum: 0 }), ME, "sending"),
      isOptimistic: true,
    };
    const s = messagingReducer(withMessages([optimistic], [conv(CONV_BOB, BOB, { lastMessage: newer })]), {
      type: "OPTIMISTIC_MESSAGE_CONFIRMED",
      conversationId: CONV_BOB,
      clientMessageId: CLIENT,
      confirmedMessage: serverMessage(),
    });
    expect(s.conversations[0]?.lastMessage).toEqual(newer);
  });

  it("tracks older-page loading and errors", () => {
    let s = messagingReducer(withMessages([]), { type: "OLDER_MESSAGES_LOADING", conversationId: CONV_BOB });
    expect(s.pagination[CONV_BOB]).toMatchObject({ loadingOlder: true, olderError: null });

    s = messagingReducer(s, { type: "OLDER_MESSAGES_ERROR", conversationId: CONV_BOB, error: "boom" });
    expect(s.pagination[CONV_BOB]).toMatchObject({ loadingOlder: false, olderError: "boom" });

    s = messagingReducer(s, {
      type: "OLDER_MESSAGES_SUCCESS",
      conversationId: CONV_BOB,
      messages: [],
      hasMoreOlder: false,
    });
    expect(s.pagination[CONV_BOB]).toMatchObject({ loadingOlder: false, olderError: null });
  });
});
