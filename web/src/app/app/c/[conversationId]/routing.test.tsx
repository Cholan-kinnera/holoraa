import { describe, expect, it, vi } from "vitest";

import ConversationDetailPage from "./page";
import ConversationPage from "@/app/app/page";
import * as authServer from "@/lib/auth/server";
import * as messagingActions from "@/app/app/messages/actions";

// Mock next/navigation
const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const validUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  bio: null,
  avatarUrl: null,
  profileComplete: true,
};

const signedInSession = {
  state: "signed-in" as const,
  user: validUser,
  csrfToken: "mock-csrf-token",
};

const validConversationId = "33333333-3333-4333-8333-333333333333";

describe("Conversation Route Server-Side Authorization", () => {
  it("redirects signed-out users to /sign-in", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce({
      state: "signed-out",
    });

    await expect(
      ConversationDetailPage({
        params: Promise.resolve({ conversationId: validConversationId }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects users with incomplete profile to /app/profile?setup=1", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce({
      ...signedInSession,
      user: { ...validUser, profileComplete: false },
    });

    await expect(
      ConversationDetailPage({
        params: Promise.resolve({ conversationId: validConversationId }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/app/profile?setup=1");
    expect(redirectMock).toHaveBeenCalledWith("/app/profile?setup=1");
  });

  it("fails closed and redirects invalid UUIDs to /app", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce(signedInSession);

    await expect(
      ConversationDetailPage({
        params: Promise.resolve({ conversationId: "not-a-uuid" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/app");
    expect(redirectMock).toHaveBeenCalledWith("/app");
  });

  it("strictly denies access and redirects unauthorized non-participants to /app", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce(signedInSession);

    // Mock backend 403 Forbidden via getConversationAction returning !ok
    vi.spyOn(messagingActions, "getConversationAction").mockResolvedValueOnce({
      ok: false,
      message: "You are not a participant in this conversation.",
    });

    await expect(
      ConversationDetailPage({
        params: Promise.resolve({ conversationId: validConversationId }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/app");
    expect(redirectMock).toHaveBeenCalledWith("/app");
  });

  it("redirects to /sign-in?expired=1 when session expires during authorization check", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce(signedInSession);

    vi.spyOn(messagingActions, "getConversationAction").mockResolvedValueOnce({
      ok: false,
      expired: true,
      message: "Session expired.",
    });

    await expect(
      ConversationDetailPage({
        params: Promise.resolve({ conversationId: validConversationId }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?expired=1");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in?expired=1");
  });

  it("allows authorized participant and renders ConversationView", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce(signedInSession);

    vi.spyOn(messagingActions, "getConversationAction").mockResolvedValueOnce({
      ok: true,
      conversation: {
        id: validConversationId,
        type: "direct",
        status: "accepted",
        initiatedBy: validUser.id,
        lastMessageSequence: 1,
        peer: {
          id: "22222222-2222-4222-8222-222222222222",
          username: "bob",
          displayName: "Bob",
          bio: null,
          avatarUrl: null,
        },
        unreadCount: 0,
        updatedAt: "2026-11-19T10:00:00Z",
        createdAt: "2026-11-19T09:00:00Z",
      },
    });

    vi.spyOn(messagingActions, "getMessagesAction").mockResolvedValueOnce({
      ok: true,
      messages: [],
      hasMore: false,
    });

    const jsx = await ConversationDetailPage({
      params: Promise.resolve({ conversationId: validConversationId }),
    });

    expect(jsx).not.toBeNull();
    expect(jsx.props.conversationId).toBe(validConversationId);
  });

  it("/app redirects ?c= query parameter to canonical route /app/c/[conversationId]", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValueOnce(signedInSession);

    await expect(
      ConversationPage({
        searchParams: Promise.resolve({ c: validConversationId }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/app/c/${validConversationId}`);
    expect(redirectMock).toHaveBeenCalledWith(`/app/c/${validConversationId}`);
  });
});
