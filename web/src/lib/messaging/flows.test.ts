import { describe, expect, it } from "vitest";

import type { ApiClient } from "@/lib/api/client";

import {
  acceptMessageRequest,
  blockUser,
  declineMessageRequest,
  getConversation,
  getMessages,
  getMySettings,
  getOrCreateDirectConversation,
  issueRealtimeTicket,
  listConversations,
  markConversationRead,
  markMessageDelivered,
  sendMessage,
  unblockUser,
  updateMySettings,
  MESSAGES,
  type Conversation,
  type Message,
} from "./flows";

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  query?: Record<string, unknown>;
}

interface Reply {
  status: number;
  body?: unknown;
}

function fakeClient(replies: Record<string, Reply | Error>, calls: Recorded[] = []): ApiClient {
  const handle = async (
    method: string,
    path: string,
    init?: {
      headers?: Record<string, string>;
      body?: unknown;
      params?: { path?: Record<string, string>; query?: Record<string, unknown> };
    },
  ) => {
    let resolvedPath = path;
    if (init?.params?.path) {
      for (const [k, v] of Object.entries(init.params.path)) {
        resolvedPath = resolvedPath.replace(`{${k}}`, v);
      }
    }
    calls.push({
      method,
      path: resolvedPath,
      headers: init?.headers ?? {},
      body: init?.body,
      query: init?.params?.query,
    });

    const reply = replies[`${method} ${resolvedPath}`] ?? replies[`${method} ${path}`];
    if (reply === undefined) {
      throw new Error(`unexpected ${method} ${resolvedPath}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    const headers = new Headers({ "content-type": "application/json" });
    const response = new Response(reply.body !== undefined ? JSON.stringify(reply.body) : null, {
      status: reply.status,
      headers,
    });
    const data = response.ok && reply.body !== undefined ? reply.body : undefined;
    const error = !response.ok && reply.body !== undefined ? reply.body : undefined;
    return {
      data,
      error,
      response,
    };
  };

  type InitParam = {
    headers?: Record<string, string>;
    body?: unknown;
    params?: { path?: Record<string, string>; query?: Record<string, unknown> };
  };

  return {
    GET: (path: string, init?: InitParam) => handle("GET", path, init),
    POST: (path: string, init?: InitParam) => handle("POST", path, init),
    PUT: (path: string, init?: InitParam) => handle("PUT", path, init),
    PATCH: (path: string, init?: InitParam) => handle("PATCH", path, init),
    DELETE: (path: string, init?: InitParam) => handle("DELETE", path, init),
  } as unknown as ApiClient;
}

const SAMPLE_CONVERSATION: Conversation = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  type: "direct",
  status: "accepted",
  initiatedBy: "00000000-0000-0000-0000-000000000001",
  lastMessageSequence: 1,
  peer: {
    id: "00000000-0000-0000-0000-000000000002",
    username: "bob",
    displayName: "Bob",
    bio: null,
    avatarUrl: null,
  },
  unreadCount: 0,
  createdAt: "2026-11-17T20:00:00Z",
  updatedAt: "2026-11-17T20:00:00Z",
};

const SAMPLE_MESSAGE: Message = {
  id: "223e4567-e89b-12d3-a456-426614174000",
  conversationId: "123e4567-e89b-12d3-a456-426614174000",
  senderId: "00000000-0000-0000-0000-000000000001",
  clientMessageId: "323e4567-e89b-12d3-a456-426614174000",
  content: "Hello Bob",
  sequenceNum: 1,
  createdAt: "2026-11-17T20:00:01Z",
  deliveredAt: null,
  readAt: null,
};

describe("listConversations flow", () => {
  it("returns conversations list on 200", async () => {
    const client = fakeClient({
      "GET /v1/conversations": { status: 200, body: { conversations: [SAMPLE_CONVERSATION] } },
    });
    const res = await listConversations(client, { cookieHeader: "sess=123" });
    expect(res).toEqual({ ok: true, conversations: [SAMPLE_CONVERSATION] });
  });

  it("handles 401 session expiration", async () => {
    const client = fakeClient({
      "GET /v1/conversations": { status: 401, body: { detail: "unauthorized" } },
    });
    const res = await listConversations(client, { cookieHeader: "sess=123" });
    expect(res).toEqual({ ok: false, message: MESSAGES.sessionExpired, expired: true });
  });

  it("handles network failure cleanly", async () => {
    const client = fakeClient({
      "GET /v1/conversations": new Error("network down"),
    });
    const res = await listConversations(client, { cookieHeader: "sess=123" });
    expect(res).toEqual({ ok: false, message: MESSAGES.unavailable });
  });
});

describe("getOrCreateDirectConversation flow", () => {
  it("returns existing conversation on 200 (created=false)", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient(
      { "POST /v1/conversations/direct": { status: 200, body: SAMPLE_CONVERSATION } },
      calls,
    );
    const res = await getOrCreateDirectConversation(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "token-123",
      targetUsername: "bob",
    });
    expect(res).toEqual({ ok: true, conversation: SAMPLE_CONVERSATION, created: false });
    expect(calls[0]?.headers).toMatchObject({
      cookie: "sess=abc",
      Origin: "http://localhost:3000",
      "X-CSRF-Token": "token-123",
    });
  });

  it("returns new conversation on 201 (created=true)", async () => {
    const client = fakeClient({
      "POST /v1/conversations/direct": { status: 201, body: SAMPLE_CONVERSATION },
    });
    const res = await getOrCreateDirectConversation(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "token-123",
      targetUsername: "bob",
    });
    expect(res).toEqual({ ok: true, conversation: SAMPLE_CONVERSATION, created: true });
  });

  it("surfaces 403 problem detail", async () => {
    const client = fakeClient({
      "POST /v1/conversations/direct": {
        status: 403,
        body: { detail: "You cannot message this user." },
      },
    });
    const res = await getOrCreateDirectConversation(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "token-123",
      targetUsername: "bob",
    });
    expect(res).toEqual({ ok: false, message: "You cannot message this user." });
  });

  it("handles 404 user not found", async () => {
    const client = fakeClient({
      "POST /v1/conversations/direct": {
        status: 404,
        body: { detail: "Target user not found." },
      },
    });
    const res = await getOrCreateDirectConversation(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "token-123",
      targetUsername: "bob",
    });
    expect(res).toEqual({ ok: false, message: "Target user not found." });
  });
});

describe("getConversation flow", () => {
  it("returns conversation on 200", async () => {
    const client = fakeClient({
      "GET /v1/conversations/123e4567-e89b-12d3-a456-426614174000": {
        status: 200,
        body: SAMPLE_CONVERSATION,
      },
    });
    const res = await getConversation(client, {
      cookieHeader: "sess=abc",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({ ok: true, conversation: SAMPLE_CONVERSATION });
  });

  it("handles 403 access denied", async () => {
    const client = fakeClient({
      "GET /v1/conversations/123e4567-e89b-12d3-a456-426614174000": {
        status: 403,
        body: { detail: "You are not a member of this conversation." },
      },
    });
    const res = await getConversation(client, {
      cookieHeader: "sess=abc",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({ ok: false, message: "You are not a member of this conversation." });
  });
});

describe("acceptMessageRequest & declineMessageRequest flows", () => {
  it("accepts request on 200", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/accept": {
        status: 200,
        body: { ...SAMPLE_CONVERSATION, status: "accepted" },
      },
    });
    const res = await acceptMessageRequest(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({
      ok: true,
      conversation: { ...SAMPLE_CONVERSATION, status: "accepted" },
    });
  });

  it("declines request on 200", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/decline": {
        status: 200,
        body: { ...SAMPLE_CONVERSATION, status: "declined" },
      },
    });
    const res = await declineMessageRequest(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({
      ok: true,
      conversation: { ...SAMPLE_CONVERSATION, status: "declined" },
    });
  });
});

describe("getMessages flow", () => {
  it("returns paginated messages with query parameters", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient(
      {
        "GET /v1/conversations/123e4567-e89b-12d3-a456-426614174000/messages": {
          status: 200,
          body: { messages: [SAMPLE_MESSAGE], hasMore: false },
        },
      },
      calls,
    );
    const res = await getMessages(client, {
      cookieHeader: "sess=abc",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      before: "999e4567-e89b-12d3-a456-426614174000",
      limit: 20,
    });
    expect(res).toEqual({ ok: true, messages: [SAMPLE_MESSAGE], hasMore: false });
    expect(calls[0]?.query).toEqual({
      before: "999e4567-e89b-12d3-a456-426614174000",
      limit: 20,
    });
  });
});

describe("sendMessage flow", () => {
  it("creates message on 201", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/messages": {
        status: 201,
        body: SAMPLE_MESSAGE,
      },
    });
    const res = await sendMessage(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      clientMessageId: "323e4567-e89b-12d3-a456-426614174000",
      content: "Hello Bob",
    });
    expect(res).toEqual({ ok: true, message: SAMPLE_MESSAGE });
  });

  it("handles 403 send block / request limit", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/messages": {
        status: 403,
        body: { detail: "Cannot send more messages while request is pending." },
      },
    });
    const res = await sendMessage(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      clientMessageId: "323e4567-e89b-12d3-a456-426614174000",
      content: "Hello again",
    });
    expect(res).toEqual({ ok: false, message: "Cannot send more messages while request is pending." });
  });

  it("handles 429 rate limit", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/messages": {
        status: 429,
        body: { detail: "rate limit exceeded" },
      },
    });
    const res = await sendMessage(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      clientMessageId: "323e4567-e89b-12d3-a456-426614174000",
      content: "Too fast",
    });
    expect(res).toEqual({ ok: false, message: MESSAGES.rateLimited });
  });
});

describe("markConversationRead & markMessageDelivered flows", () => {
  it("advances read watermark on 204", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/read": { status: 204 },
    });
    const res = await markConversationRead(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      messageId: "223e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({ ok: true });
  });

  it("delivers message on 204", async () => {
    const client = fakeClient({
      "POST /v1/conversations/123e4567-e89b-12d3-a456-426614174000/messages/223e4567-e89b-12d3-a456-426614174000/delivered": {
        status: 204,
      },
    });
    const res = await markMessageDelivered(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      messageId: "223e4567-e89b-12d3-a456-426614174000",
    });
    expect(res).toEqual({ ok: true });
  });
});

describe("blockUser & unblockUser flows", () => {
  it("blocks user on 204", async () => {
    const client = fakeClient({
      "POST /v1/users/charlie/block": { status: 204 },
    });
    const res = await blockUser(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      username: "charlie",
    });
    expect(res).toEqual({ ok: true });
  });

  it("refuses self-block on 400", async () => {
    const client = fakeClient({
      "POST /v1/users/alice/block": {
        status: 400,
        body: { detail: "You cannot block yourself." },
      },
    });
    const res = await blockUser(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      username: "alice",
    });
    expect(res).toEqual({ ok: false, message: "You cannot block yourself." });
  });

  it("unblocks user on 204", async () => {
    const client = fakeClient({
      "DELETE /v1/users/charlie/block": { status: 204 },
    });
    const res = await unblockUser(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      username: "charlie",
    });
    expect(res).toEqual({ ok: true });
  });
});

describe("issueRealtimeTicket flow", () => {
  it("issues single-use ticket on 201", async () => {
    const client = fakeClient({
      "POST /v1/realtime/ticket": {
        status: 201,
        body: { ticket: "raw-crypto-ticket-hex-64", expiresIn: 60 },
      },
    });
    const res = await issueRealtimeTicket(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
    });
    expect(res).toEqual({
      ok: true,
      ticket: "raw-crypto-ticket-hex-64",
      expiresIn: 60,
    });
  });

  it("handles 429 ticket rate limit", async () => {
    const client = fakeClient({
      "POST /v1/realtime/ticket": {
        status: 429,
        body: { detail: "rate limited" },
      },
    });
    const res = await issueRealtimeTicket(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
    });
    expect(res).toEqual({
      ok: false,
      message: "Too many ticket requests. Please wait a moment.",
    });
  });
});

describe("getMySettings & updateMySettings flows", () => {
  it("reads settings on 200", async () => {
    const client = fakeClient({
      "GET /v1/me/settings": {
        status: 200,
        body: { readReceiptsEnabled: true },
      },
    });
    const res = await getMySettings(client, { cookieHeader: "sess=abc" });
    expect(res).toEqual({ ok: true, settings: { readReceiptsEnabled: true } });
  });

  it("updates settings on 200", async () => {
    const client = fakeClient({
      "PATCH /v1/me/settings": {
        status: 200,
        body: { readReceiptsEnabled: false },
      },
    });
    const res = await updateMySettings(client, {
      origin: "http://localhost:3000",
      cookieHeader: "sess=abc",
      csrfToken: "csrf-xyz",
      readReceiptsEnabled: false,
    });
    expect(res).toEqual({ ok: true, settings: { readReceiptsEnabled: false } });
  });
});
