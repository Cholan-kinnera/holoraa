"use server";

import { revalidatePath } from "next/cache";

import { readApiBaseUrl } from "@/lib/api/client";
import { currentCookieHeader, getSession, requestContext } from "@/lib/auth/server";
import { validateUsername } from "@/lib/auth/validation";
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
  type Conversation,
  type FlowResult,
  type Message,
  type UserSettings,
} from "@/lib/messaging/flows";
import {
  validateMessageContent,
  validatePaginationLimit,
  validateUuid,
} from "@/lib/messaging/validation";

/** Derives the WebSocket URL securely from the server environment. */
function resolveWsUrl(apiBaseUrl: string): string {
  const explicitWs = process.env.HOLORAA_WS_URL?.trim();
  if (explicitWs) {
    return explicitWs;
  }
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/realtime/ws";
  return url.toString();
}

/** 1. Lists all direct conversations for the signed-in user. */
export async function getConversationsAction(): Promise<FlowResult<{ conversations: Conversation[] }>> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const cookieHeader = await currentCookieHeader();
  return listConversations(context.client, { cookieHeader });
}

/** 2. Starts or retrieves a canonical direct conversation with target username. */
export async function getOrCreateDirectConversationAction(
  targetUsername: string,
): Promise<FlowResult<{ conversation: Conversation; created: boolean }>> {
  const usernameError = validateUsername(targetUsername);
  if (usernameError) {
    return { ok: false, message: usernameError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await getOrCreateDirectConversation(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    targetUsername,
  });

  if (res.ok && res.created) {
    revalidatePath("/app", "layout");
  }
  return res;
}

/** 3. Retrieves metadata for a specific conversation. */
export async function getConversationAction(
  conversationId: string,
): Promise<FlowResult<{ conversation: Conversation }>> {
  const uuidError = validateUuid(conversationId, "conversation ID");
  if (uuidError) {
    return { ok: false, message: uuidError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const cookieHeader = await currentCookieHeader();
  return getConversation(context.client, { cookieHeader, conversationId });
}

/** 4. Accepts an incoming message request. */
export async function acceptMessageRequestAction(
  conversationId: string,
): Promise<FlowResult<{ conversation: Conversation }>> {
  const uuidError = validateUuid(conversationId, "conversation ID");
  if (uuidError) {
    return { ok: false, message: uuidError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await acceptMessageRequest(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    conversationId,
  });

  if (res.ok) {
    revalidatePath("/app", "layout");
  }
  return res;
}

/** 5. Declines an incoming message request (terminal for MVP). */
export async function declineMessageRequestAction(
  conversationId: string,
): Promise<FlowResult<{ conversation: Conversation }>> {
  const uuidError = validateUuid(conversationId, "conversation ID");
  if (uuidError) {
    return { ok: false, message: uuidError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await declineMessageRequest(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    conversationId,
  });

  if (res.ok) {
    revalidatePath("/app", "layout");
  }
  return res;
}

/** 6. Retrieves keyset-paginated messages for a conversation. */
export async function getMessagesAction(
  conversationId: string,
  options?: { before?: string; after?: string; limit?: number },
): Promise<FlowResult<{ messages: Message[]; hasMore: boolean }>> {
  const convUuidError = validateUuid(conversationId, "conversation ID");
  if (convUuidError) {
    return { ok: false, message: convUuidError };
  }
  if (options?.before) {
    const beforeError = validateUuid(options.before, "before message ID");
    if (beforeError) return { ok: false, message: beforeError };
  }
  if (options?.after) {
    const afterError = validateUuid(options.after, "after message ID");
    if (afterError) return { ok: false, message: afterError };
  }
  const limitError = validatePaginationLimit(options?.limit);
  if (limitError) {
    return { ok: false, message: limitError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const cookieHeader = await currentCookieHeader();
  return getMessages(context.client, {
    cookieHeader,
    conversationId,
    before: options?.before,
    after: options?.after,
    limit: options?.limit,
  });
}

/** 7. Sends a message via REST fallback. */
export async function sendMessageAction(
  conversationId: string,
  clientMessageId: string,
  content: string,
): Promise<FlowResult<{ message: Message }>> {
  const convUuidError = validateUuid(conversationId, "conversation ID");
  if (convUuidError) {
    return { ok: false, message: convUuidError };
  }
  const clientUuidError = validateUuid(clientMessageId, "client message ID");
  if (clientUuidError) {
    return { ok: false, message: clientUuidError };
  }
  const contentError = validateMessageContent(content);
  if (contentError) {
    return { ok: false, message: contentError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  return sendMessage(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    conversationId,
    clientMessageId,
    content,
  });
}

/** 8. Advances the monotonic read watermark. */
export async function markConversationReadAction(
  conversationId: string,
  messageId: string,
): Promise<FlowResult> {
  const convUuidError = validateUuid(conversationId, "conversation ID");
  if (convUuidError) {
    return { ok: false, message: convUuidError };
  }
  const msgUuidError = validateUuid(messageId, "message ID");
  if (msgUuidError) {
    return { ok: false, message: msgUuidError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  return markConversationRead(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    conversationId,
    messageId,
  });
}

/** 9. Sends a client delivery acknowledgment for a message. */
export async function markMessageDeliveredAction(
  conversationId: string,
  messageId: string,
): Promise<FlowResult> {
  const convUuidError = validateUuid(conversationId, "conversation ID");
  if (convUuidError) {
    return { ok: false, message: convUuidError };
  }
  const msgUuidError = validateUuid(messageId, "message ID");
  if (msgUuidError) {
    return { ok: false, message: msgUuidError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  return markMessageDelivered(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    conversationId,
    messageId,
  });
}

/** 10. Blocks a user directionally. */
export async function blockUserAction(username: string): Promise<FlowResult> {
  const usernameError = validateUsername(username);
  if (usernameError) {
    return { ok: false, message: usernameError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await blockUser(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    username,
  });

  if (res.ok) {
    revalidatePath("/app", "layout");
  }
  return res;
}

/** 11. Unblocks a user. */
export async function unblockUserAction(username: string): Promise<FlowResult> {
  const usernameError = validateUsername(username);
  if (usernameError) {
    return { ok: false, message: usernameError };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await unblockUser(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    username,
  });

  if (res.ok) {
    revalidatePath("/app", "layout");
  }
  return res;
}

/** 12. Issues a single-use 60s ticket for WebSocket upgrade and resolves the WS URL. */
export async function issueRealtimeTicketAction(): Promise<
  FlowResult<{ ticket: string; expiresIn: number; wsUrl: string }>
> {
  const baseUrl = readApiBaseUrl();
  if (baseUrl === null) {
    return { ok: false, message: "Realtime messaging is not configured on this server." };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  const res = await issueRealtimeTicket(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
  });

  if (!res.ok) {
    return res;
  }

  return {
    ok: true,
    ticket: res.ticket,
    expiresIn: res.expiresIn,
    wsUrl: resolveWsUrl(baseUrl),
  };
}

/** 13. Retrieves user settings (e.g. read receipts). */
export async function getMySettingsAction(): Promise<FlowResult<{ settings: UserSettings }>> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const cookieHeader = await currentCookieHeader();
  return getMySettings(context.client, { cookieHeader });
}

/** 14. Updates user settings (e.g. toggling read receipts). */
export async function updateMySettingsAction(values: {
  readReceiptsEnabled: boolean;
}): Promise<FlowResult<{ settings: UserSettings }>> {
  if (typeof values?.readReceiptsEnabled !== "boolean") {
    return { ok: false, message: "readReceiptsEnabled must be a boolean." };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return { ok: false, message: "Your session has ended. Sign in again to continue.", expired: true };
  }

  const cookieHeader = await currentCookieHeader();
  return updateMySettings(context.client, {
    origin: context.origin,
    cookieHeader,
    csrfToken: session.csrfToken,
    readReceiptsEnabled: values.readReceiptsEnabled,
  });
}
