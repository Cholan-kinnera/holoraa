import type { ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

/**
 * Messaging domain flows against the Go API.
 * Each function accepts an ApiClient instance so unit tests can provide fakes.
 * Server-side session tokens and CSRF headers are forwarded securely.
 */

export type Conversation = components["schemas"]["Conversation"];
export type Message = components["schemas"]["Message"];
export type MessageSnippet = components["schemas"]["MessageSnippet"];
export type UserSettings = components["schemas"]["UserSettings"];
export type RealtimeTicket = components["schemas"]["RealtimeTicketResponse"];
export type Problem = components["schemas"]["Problem"];

export type FlowFailure = { ok: false; message: string; expired?: boolean };
export type FlowResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | FlowFailure;

export const MESSAGES = {
  unavailable: "Holoraa cannot be reached right now. Try again shortly.",
  sessionExpired: "Your session has ended. Sign in again to continue.",
  refused: "This request was refused. Reload the page and try again.",
  generic: "Something went wrong. Try again.",
  rateLimited: "Too many requests. Please wait a moment and try again.",
} as const;

/** Runs one API call. Network and unexpected transport errors map to unavailable. */
async function attempt<T extends object>(run: () => Promise<FlowResult<T>>): Promise<FlowResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, message: MESSAGES.unavailable };
  }
}

/** Formats request headers including cookie, origin, and CSRF token when present. */
function requestHeaders(
  cookieHeader: string | null,
  origin?: string,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cookieHeader !== null && cookieHeader !== "") {
    headers.cookie = cookieHeader;
  }
  if (origin !== undefined && origin !== "") {
    headers.Origin = origin;
  }
  if (csrfToken !== undefined && csrfToken !== "") {
    headers["X-CSRF-Token"] = csrfToken;
  }
  return headers;
}

/** Extracts a safe error detail string from an RFC 9457 Problem Details body. */
function extractErrorDetail(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail.trim();
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// 1. listConversations
// ---------------------------------------------------------------------------
export async function listConversations(
  client: ApiClient,
  input: { cookieHeader: string | null },
): Promise<FlowResult<{ conversations: Conversation[] }>> {
  return attempt(async (): Promise<FlowResult<{ conversations: Conversation[] }>> => {
    const { data, error, response } = await client.GET("/v1/conversations", {
      headers: requestHeaders(input.cookieHeader),
    });

    if (response.status === 200 && data) {
      return { ok: true, conversations: data.conversations };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 2. getOrCreateDirectConversation
// ---------------------------------------------------------------------------
export async function getOrCreateDirectConversation(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    targetUsername: string;
  },
): Promise<FlowResult<{ conversation: Conversation; created: boolean }>> {
  const targetUsername = input.targetUsername.trim();
  return attempt(async (): Promise<FlowResult<{ conversation: Conversation; created: boolean }>> => {
    const { data, error, response } = await client.POST("/v1/conversations/direct", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      body: { targetUsername },
    });

    if ((response.status === 200 || response.status === 201) && data) {
      return { ok: true, conversation: data, created: response.status === 201 };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "User not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 3. getConversation
// ---------------------------------------------------------------------------
export async function getConversation(
  client: ApiClient,
  input: {
    cookieHeader: string | null;
    conversationId: string;
  },
): Promise<FlowResult<{ conversation: Conversation }>> {
  const conversationId = input.conversationId.trim();
  return attempt(async (): Promise<FlowResult<{ conversation: Conversation }>> => {
    const { data, error, response } = await client.GET("/v1/conversations/{id}", {
      headers: requestHeaders(input.cookieHeader),
      params: { path: { id: conversationId } },
    });

    if (response.status === 200 && data) {
      return { ok: true, conversation: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, "You do not have access to this conversation.") };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 4. acceptMessageRequest
// ---------------------------------------------------------------------------
export async function acceptMessageRequest(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    conversationId: string;
  },
): Promise<FlowResult<{ conversation: Conversation }>> {
  const conversationId = input.conversationId.trim();
  return attempt(async (): Promise<FlowResult<{ conversation: Conversation }>> => {
    const { data, error, response } = await client.POST("/v1/conversations/{id}/accept", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { id: conversationId } },
    });

    if (response.status === 200 && data) {
      return { ok: true, conversation: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 5. declineMessageRequest
// ---------------------------------------------------------------------------
export async function declineMessageRequest(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    conversationId: string;
  },
): Promise<FlowResult<{ conversation: Conversation }>> {
  const conversationId = input.conversationId.trim();
  return attempt(async (): Promise<FlowResult<{ conversation: Conversation }>> => {
    const { data, error, response } = await client.POST("/v1/conversations/{id}/decline", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { id: conversationId } },
    });

    if (response.status === 200 && data) {
      return { ok: true, conversation: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 6. getMessages
// ---------------------------------------------------------------------------
export async function getMessages(
  client: ApiClient,
  input: {
    cookieHeader: string | null;
    conversationId: string;
    before?: string;
    after?: string;
    limit?: number;
  },
): Promise<FlowResult<{ messages: Message[]; hasMore: boolean }>> {
  const conversationId = input.conversationId.trim();
  return attempt(async (): Promise<FlowResult<{ messages: Message[]; hasMore: boolean }>> => {
    const query: { before?: string; after?: string; limit?: number } = {};
    if (input.before) query.before = input.before.trim();
    if (input.after) query.after = input.after.trim();
    if (input.limit !== undefined) query.limit = input.limit;

    const { data, error, response } = await client.GET("/v1/conversations/{id}/messages", {
      headers: requestHeaders(input.cookieHeader),
      params: {
        path: { id: conversationId },
        query,
      },
    });

    if (response.status === 200 && data) {
      return { ok: true, messages: data.messages, hasMore: data.hasMore };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, "You do not have access to these messages.") };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 7. sendMessage
// ---------------------------------------------------------------------------
export async function sendMessage(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    conversationId: string;
    clientMessageId: string;
    content: string;
  },
): Promise<FlowResult<{ message: Message }>> {
  const conversationId = input.conversationId.trim();
  const clientMessageId = input.clientMessageId.trim();
  const content = input.content.trim();

  return attempt(async (): Promise<FlowResult<{ message: Message }>> => {
    const { data, error, response } = await client.POST("/v1/conversations/{id}/messages", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { id: conversationId } },
      body: { clientMessageId, content },
    });

    if (response.status === 201 && data) {
      return { ok: true, message: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, "You cannot send messages to this conversation.") };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation not found.") };
    }
    if (response.status === 429) {
      return { ok: false, message: MESSAGES.rateLimited };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 8. markConversationRead
// ---------------------------------------------------------------------------
export async function markConversationRead(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    conversationId: string;
    messageId: string;
  },
): Promise<FlowResult> {
  const conversationId = input.conversationId.trim();
  const messageId = input.messageId.trim();

  return attempt(async (): Promise<FlowResult> => {
    const { error, response } = await client.POST("/v1/conversations/{id}/read", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { id: conversationId } },
      body: { messageId },
    });

    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Conversation or message not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 9. markMessageDelivered
// ---------------------------------------------------------------------------
export async function markMessageDelivered(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    conversationId: string;
    messageId: string;
  },
): Promise<FlowResult> {
  const conversationId = input.conversationId.trim();
  const messageId = input.messageId.trim();

  return attempt(async (): Promise<FlowResult> => {
    const { error, response } = await client.POST("/v1/conversations/{id}/messages/{messageId}/delivered", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { id: conversationId, messageId } },
    });

    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "Message not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 10. blockUser
// ---------------------------------------------------------------------------
export async function blockUser(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    username: string;
  },
): Promise<FlowResult> {
  const username = input.username.trim();

  return attempt(async (): Promise<FlowResult> => {
    const { error, response } = await client.POST("/v1/users/{username}/block", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { username } },
    });

    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 400) {
      return { ok: false, message: extractErrorDetail(error, "You cannot block yourself.") };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "User not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 11. unblockUser
// ---------------------------------------------------------------------------
export async function unblockUser(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    username: string;
  },
): Promise<FlowResult> {
  const username = input.username.trim();

  return attempt(async (): Promise<FlowResult> => {
    const { error, response } = await client.DELETE("/v1/users/{username}/block", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      params: { path: { username } },
    });

    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 404) {
      return { ok: false, message: extractErrorDetail(error, "User not found.") };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 12. issueRealtimeTicket
// ---------------------------------------------------------------------------
export async function issueRealtimeTicket(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
  },
): Promise<FlowResult<{ ticket: string; expiresIn: number }>> {
  return attempt(async (): Promise<FlowResult<{ ticket: string; expiresIn: number }>> => {
    const { data, error, response } = await client.POST("/v1/realtime/ticket", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
    });

    if (response.status === 201 && data) {
      return { ok: true, ticket: data.ticket, expiresIn: data.expiresIn };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 429) {
      return { ok: false, message: "Too many ticket requests. Please wait a moment." };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 13. getMySettings
// ---------------------------------------------------------------------------
export async function getMySettings(
  client: ApiClient,
  input: {
    cookieHeader: string | null;
  },
): Promise<FlowResult<{ settings: UserSettings }>> {
  return attempt(async (): Promise<FlowResult<{ settings: UserSettings }>> => {
    const { data, error, response } = await client.GET("/v1/me/settings", {
      headers: requestHeaders(input.cookieHeader),
    });

    if (response.status === 200 && data) {
      return { ok: true, settings: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}

// ---------------------------------------------------------------------------
// 14. updateMySettings
// ---------------------------------------------------------------------------
export async function updateMySettings(
  client: ApiClient,
  input: {
    origin: string;
    cookieHeader: string | null;
    csrfToken: string;
    readReceiptsEnabled: boolean;
  },
): Promise<FlowResult<{ settings: UserSettings }>> {
  return attempt(async (): Promise<FlowResult<{ settings: UserSettings }>> => {
    const { data, error, response } = await client.PATCH("/v1/me/settings", {
      headers: requestHeaders(input.cookieHeader, input.origin, input.csrfToken),
      body: { readReceiptsEnabled: input.readReceiptsEnabled },
    });

    if (response.status === 200 && data) {
      return { ok: true, settings: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.sessionExpired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: extractErrorDetail(error, MESSAGES.refused) };
    }
    return { ok: false, message: extractErrorDetail(error, MESSAGES.generic) };
  });
}
