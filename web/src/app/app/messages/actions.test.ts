import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api/client";
import * as authServer from "@/lib/auth/server";
import * as flows from "@/lib/messaging/flows";
import {
  acceptMessageRequestAction,
  blockUserAction,
  declineMessageRequestAction,
  getConversationAction,
  getConversationsAction,
  getMessagesAction,
  getMySettingsAction,
  getOrCreateDirectConversationAction,
  issueRealtimeTicketAction,
  markConversationReadAction,
  markMessageDeliveredAction,
  sendMessageAction,
  unblockUserAction,
  updateMySettingsAction,
} from "./actions";

describe("Messaging Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOLORAA_API_URL", "http://127.0.0.1:8080");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("Input validation enforcement", () => {
    it("getOrCreateDirectConversationAction rejects invalid username before calling flow", async () => {
      const spy = vi.spyOn(flows, "getOrCreateDirectConversation");
      const res = await getOrCreateDirectConversationAction("a-bad-username!");
      expect(res.ok).toBe(false);
      expect(res).toHaveProperty("message");
      expect(spy).not.toHaveBeenCalled();
    });

    it("getConversationAction rejects invalid UUID format", async () => {
      const spy = vi.spyOn(flows, "getConversation");
      const res = await getConversationAction("not-a-uuid");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain("conversation ID");
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it("acceptMessageRequestAction and declineMessageRequestAction reject invalid UUID", async () => {
      const res1 = await acceptMessageRequestAction("bad-id");
      const res2 = await declineMessageRequestAction("bad-id");
      expect(res1.ok).toBe(false);
      expect(res2.ok).toBe(false);
    });

    it("getMessagesAction rejects invalid limit and invalid before UUID", async () => {
      const res1 = await getMessagesAction("123e4567-e89b-12d3-a456-426614174000", { limit: 200 });
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.message).toContain("Limit");
      }

      const res2 = await getMessagesAction("123e4567-e89b-12d3-a456-426614174000", { before: "not-a-uuid" });
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.message).toContain("before message ID");
      }
    });

    it("sendMessageAction rejects empty message content or invalid UUIDs", async () => {
      const res1 = await sendMessageAction(
        "123e4567-e89b-12d3-a456-426614174000",
        "223e4567-e89b-12d3-a456-426614174000",
        "   ",
      );
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.message).toBe("Message cannot be empty.");
      }

      const res2 = await sendMessageAction(
        "bad-conv-id",
        "223e4567-e89b-12d3-a456-426614174000",
        "Hello",
      );
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.message).toContain("conversation ID");
      }
    });

    it("markConversationReadAction and markMessageDeliveredAction reject invalid message UUID", async () => {
      const res1 = await markConversationReadAction("123e4567-e89b-12d3-a456-426614174000", "not-a-uuid");
      expect(res1.ok).toBe(false);
      const res2 = await markMessageDeliveredAction("123e4567-e89b-12d3-a456-426614174000", "not-a-uuid");
      expect(res2.ok).toBe(false);
    });

    it("blockUserAction and unblockUserAction reject invalid usernames", async () => {
      const res1 = await blockUserAction("123-bad");
      expect(res1.ok).toBe(false);
      const res2 = await unblockUserAction("123-bad");
      expect(res2.ok).toBe(false);
    });

    it("updateMySettingsAction rejects non-boolean values", async () => {
      const res = await updateMySettingsAction({ readReceiptsEnabled: "true" as unknown as boolean });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain("boolean");
      }
    });
  });

  describe("Session gating & authorization checks", () => {
    it("rejects mutating actions when user is signed out or expired", async () => {
      vi.spyOn(authServer, "requestContext").mockResolvedValue({
        ok: true,
        client: {} as unknown as ApiClient,
        origin: "http://localhost:3000",
      });
      vi.spyOn(authServer, "getSession").mockResolvedValue({ state: "signed-out" });

      const res = await sendMessageAction(
        "123e4567-e89b-12d3-a456-426614174000",
        "223e4567-e89b-12d3-a456-426614174000",
        "Hello",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.expired).toBe(true);
      }
    });

    it("rejects when requestContext fails", async () => {
      vi.spyOn(authServer, "requestContext").mockResolvedValue({
        ok: false,
        message: "Sign-in is not configured on this server.",
      });

      const res = await getConversationsAction();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Sign-in is not configured on this server.");
      }
    });

    it("getMySettingsAction forwards cookieHeader and returns settings", async () => {
      vi.spyOn(authServer, "requestContext").mockResolvedValue({
        ok: true,
        client: {} as unknown as ApiClient,
        origin: "http://localhost:3000",
      });
      vi.spyOn(authServer, "currentCookieHeader").mockResolvedValue("sess=123");
      vi.spyOn(flows, "getMySettings").mockResolvedValue({
        ok: true,
        settings: { readReceiptsEnabled: true },
      });

      const res = await getMySettingsAction();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.settings.readReceiptsEnabled).toBe(true);
      }
    });
  });

  describe("Realtime ticket derivation & action routing", () => {
    it("issueRealtimeTicketAction derives ws:// URL correctly from API base URL", async () => {
      vi.spyOn(authServer, "requestContext").mockResolvedValue({
        ok: true,
        client: {} as unknown as ApiClient,
        origin: "http://localhost:3000",
      });
      vi.spyOn(authServer, "getSession").mockResolvedValue({
        state: "signed-in",
        csrfToken: "csrf-val",
        user: { id: "u1", email: "a@b.com", username: "alice", displayName: null, bio: null, avatarUrl: null, profileComplete: true },
      });
      vi.spyOn(authServer, "currentCookieHeader").mockResolvedValue("sess=123");
      vi.spyOn(flows, "issueRealtimeTicket").mockResolvedValue({
        ok: true,
        ticket: "valid-ticket-token",
        expiresIn: 60,
      });

      const res = await issueRealtimeTicketAction();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ticket).toBe("valid-ticket-token");
        expect(res.expiresIn).toBe(60);
        expect(res.wsUrl).toBe("ws://127.0.0.1:8080/v1/realtime/ws");
      }
    });

    it("respects explicit HOLORAA_WS_URL environment variable override", async () => {
      vi.stubEnv("HOLORAA_WS_URL", "wss://custom.holoraa.app/realtime/socket");
      vi.spyOn(authServer, "requestContext").mockResolvedValue({
        ok: true,
        client: {} as unknown as ApiClient,
        origin: "http://localhost:3000",
      });
      vi.spyOn(authServer, "currentCookieHeader").mockResolvedValue("sess=123");
      vi.spyOn(authServer, "getSession").mockResolvedValue({
        state: "signed-in",
        csrfToken: "csrf-val",
        user: { id: "u1", email: "a@b.com", username: "alice", displayName: null, bio: null, avatarUrl: null, profileComplete: true },
      });
      vi.spyOn(flows, "issueRealtimeTicket").mockResolvedValue({
        ok: true,
        ticket: "ticket-override",
        expiresIn: 60,
      });

      const res = await issueRealtimeTicketAction();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.wsUrl).toBe("wss://custom.holoraa.app/realtime/socket");
      }
    });
  });
});
