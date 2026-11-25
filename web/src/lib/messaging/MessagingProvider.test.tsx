// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/auth/flows";
import type { Conversation, Message } from "./flows";
import { MessagingProvider } from "./MessagingProvider";
import { useMessaging } from "./useMessaging";
import { ConversationView } from "@/app/app/c/[conversationId]/ConversationView";
import { AppShell } from "@/components/app/AppShell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testUser: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  bio: "Hello world",
  avatarUrl: null,
  profileComplete: true,
};

const peerUser = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "bob",
  displayName: "Bob",
  bio: null,
  avatarUrl: null,
};

const testConversation: Conversation = {
  id: "33333333-3333-4333-8333-333333333333",
  type: "direct",
  status: "accepted",
  initiatedBy: testUser.id,
  lastMessageSequence: 2,
  peer: peerUser,
  unreadCount: 0,
  updatedAt: "2026-11-19T10:00:00Z",
  createdAt: "2026-11-19T09:00:00Z",
};

const initialServerMessages: Message[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversationId: testConversation.id,
    senderId: testUser.id,
    clientMessageId: "c-1",
    content: "First message from Alice",
    sequenceNum: 1,
    createdAt: "2026-11-19T09:05:00Z",
    deliveredAt: "2026-11-19T09:05:01Z",
    readAt: "2026-11-19T09:06:00Z",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    conversationId: testConversation.id,
    senderId: peerUser.id,
    clientMessageId: "c-2",
    content: "Reply from Bob",
    sequenceNum: 2,
    createdAt: "2026-11-19T09:10:00Z",
    deliveredAt: "2026-11-19T09:10:02Z",
  },
];

describe("MessagingProvider & ConversationView Integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders ConversationView inside AppShell without throwing", async () => {
    await act(async () => {
      root.render(
        <AppShell user={testUser}>
          <ConversationView
            conversationId={testConversation.id}
            initialConversation={testConversation}
            initialMessages={initialServerMessages}
            initialHasMore={false}
          />
        </AppShell>,
      );
    });

    expect(container.textContent).toContain("Bob");
    expect(container.textContent).toContain("@bob");
    expect(container.textContent).toContain("2 messages synchronized.");
  });

  it("hydrates initial server-fetched messages into state", async () => {
    let capturedMessages: unknown[] = [];

    function TestConsumer() {
      const { activeMessages } = useMessaging();
      capturedMessages = activeMessages;
      return null;
    }

    await act(async () => {
      root.render(
        <MessagingProvider user={testUser}>
          <ConversationView
            conversationId={testConversation.id}
            initialConversation={testConversation}
            initialMessages={initialServerMessages}
            initialHasMore={false}
          />
          <TestConsumer />
        </MessagingProvider>,
      );
    });

    expect(capturedMessages.length).toBe(2);
    expect((capturedMessages[0] as { content: string }).content).toBe("First message from Alice");
    expect((capturedMessages[1] as { content: string }).content).toBe("Reply from Bob");
  });

  it("preserves realtime messages arriving during or before hydration", async () => {
    let contextHandle: ReturnType<typeof useMessaging> | null = null;

    function TestController() {
      contextHandle = useMessaging();
      return null;
    }

    await act(async () => {
      root.render(
        <MessagingProvider user={testUser}>
          <TestController />
        </MessagingProvider>,
      );
    });

    expect(contextHandle).not.toBeNull();

    // Simulate realtime message arriving first
    await act(async () => {
      contextHandle!.selectConversation(testConversation.id);
      // Hydrate with initial messages
      contextHandle!.hydrateConversationMessages(
        testConversation.id,
        initialServerMessages,
      );
    });

    expect(contextHandle!.activeMessages.length).toBe(2);

    // Simulate next realtime message
    const realtimeMsg: Message = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      conversationId: testConversation.id,
      senderId: peerUser.id,
      clientMessageId: "c-3",
      content: "Realtime update",
      sequenceNum: 3,
      createdAt: "2026-11-19T09:15:00Z",
    };

    await act(async () => {
      contextHandle!.hydrateConversationMessages(testConversation.id, [
        ...initialServerMessages,
        realtimeMsg,
      ]);
    });

    expect(contextHandle!.activeMessages.length).toBe(3);
    expect(contextHandle!.activeMessages[2]?.content).toBe("Realtime update");
  });

  it("deduplicates identical messages across multiple hydration passes", async () => {
    let contextHandle: ReturnType<typeof useMessaging> | null = null;

    function TestController() {
      contextHandle = useMessaging();
      return null;
    }

    await act(async () => {
      root.render(
        <MessagingProvider user={testUser}>
          <TestController />
        </MessagingProvider>,
      );
    });

    await act(async () => {
      contextHandle!.selectConversation(testConversation.id);
      // First pass
      contextHandle!.hydrateConversationMessages(testConversation.id, initialServerMessages);
      // Second pass (e.g. Strict Mode or re-fetch)
      contextHandle!.hydrateConversationMessages(testConversation.id, initialServerMessages);
    });

    expect(contextHandle!.activeMessages.length).toBe(2);
    expect(contextHandle!.activeMessages[0]?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(contextHandle!.activeMessages[1]?.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("handles Strict Mode unmount and remount cleanly without errors", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <AppShell user={testUser}>
            <ConversationView
              conversationId={testConversation.id}
              initialConversation={testConversation}
              initialMessages={initialServerMessages}
              initialHasMore={false}
            />
          </AppShell>
        </StrictMode>,
      );
    });

    expect(container.textContent).toContain("Bob");
    expect(container.textContent).toContain("2 messages synchronized.");
  });

  describe("Keyset pagination cursor derivation (Finding 2)", () => {
    it("derives oldestCursor from the last element of descending pages [newest...oldest]", async () => {
      let contextHandle: ReturnType<typeof useMessaging> | null = null;

      function TestController() {
        contextHandle = useMessaging();
        return null;
      }

      await act(async () => {
        root.render(
          <MessagingProvider user={testUser}>
            <TestController />
          </MessagingProvider>,
        );
      });

      // Descending server page: index 0 is sequence 10 (newest), index 2 is sequence 8 (oldest)
      const descendingPage: Message[] = [
        {
          id: "msg-seq-10",
          conversationId: testConversation.id,
          senderId: peerUser.id,
          clientMessageId: "c-10",
          content: "Message 10 (newest)",
          sequenceNum: 10,
          createdAt: "2026-11-19T10:10:00Z",
        },
        {
          id: "msg-seq-9",
          conversationId: testConversation.id,
          senderId: testUser.id,
          clientMessageId: "c-9",
          content: "Message 9",
          sequenceNum: 9,
          createdAt: "2026-11-19T10:09:00Z",
        },
        {
          id: "msg-seq-8",
          conversationId: testConversation.id,
          senderId: peerUser.id,
          clientMessageId: "c-8",
          content: "Message 8 (oldest in page)",
          sequenceNum: 8,
          createdAt: "2026-11-19T10:08:00Z",
        },
      ];

      await act(async () => {
        contextHandle!.selectConversation(testConversation.id);
        contextHandle!.hydrateConversationMessages(
          testConversation.id,
          descendingPage,
          true,
        );
      });

      // Pagination oldestCursor must be the oldest message ID ("msg-seq-8"), NOT "msg-seq-10"
      const pag = contextHandle!.pagination[testConversation.id];
      expect(pag).toBeDefined();
      expect(pag?.oldestCursor).toBe("msg-seq-8");
      expect(pag?.hasMoreOlder).toBe(true);

      // In the rendered UI state, messages must be sorted chronologically ascending (8, 9, 10)
      expect(contextHandle!.activeMessages.map((m) => m.sequenceNum)).toEqual([8, 9, 10]);
    });

    it("loadOlderMessages queries the backend with the true oldest message ID", async () => {
      const actionsModule = await import("@/app/app/messages/actions");
      const getMessagesSpy = vi.spyOn(actionsModule, "getMessagesAction").mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-seq-7",
            conversationId: testConversation.id,
            senderId: peerUser.id,
            clientMessageId: "c-7",
            content: "Message 7",
            sequenceNum: 7,
            createdAt: "2026-11-19T10:07:00Z",
          },
          {
            id: "msg-seq-6",
            conversationId: testConversation.id,
            senderId: testUser.id,
            clientMessageId: "c-6",
            content: "Message 6 (oldest)",
            sequenceNum: 6,
            createdAt: "2026-11-19T10:06:00Z",
          },
        ],
        hasMore: false,
      });

      let contextHandle: ReturnType<typeof useMessaging> | null = null;

      function TestController() {
        contextHandle = useMessaging();
        return null;
      }

      await act(async () => {
        root.render(
          <MessagingProvider user={testUser}>
            <TestController />
          </MessagingProvider>,
        );
      });

      const initialPage: Message[] = [
        {
          id: "msg-seq-10",
          conversationId: testConversation.id,
          senderId: peerUser.id,
          clientMessageId: "c-10",
          content: "Message 10",
          sequenceNum: 10,
          createdAt: "2026-11-19T10:10:00Z",
        },
        {
          id: "msg-seq-8",
          conversationId: testConversation.id,
          senderId: peerUser.id,
          clientMessageId: "c-8",
          content: "Message 8",
          sequenceNum: 8,
          createdAt: "2026-11-19T10:08:00Z",
        },
      ];

      await act(async () => {
        contextHandle!.selectConversation(testConversation.id);
        contextHandle!.hydrateConversationMessages(
          testConversation.id,
          initialPage,
          true,
          "msg-seq-8",
        );
      });

      // Load older messages
      await act(async () => {
        await contextHandle!.loadOlderMessages(testConversation.id);
      });

      // Must have requested with before: "msg-seq-8" (the oldest cursor)
      expect(getMessagesSpy).toHaveBeenCalledWith(testConversation.id, {
        limit: 50,
        before: "msg-seq-8",
      });

      // New oldest cursor should advance to "msg-seq-6" (the last element of olderMessages)
      const updatedPag = contextHandle!.pagination[testConversation.id];
      expect(updatedPag?.oldestCursor).toBe("msg-seq-6");
      expect(updatedPag?.hasMoreOlder).toBe(false);

      // Reconciled messages in activeMessages must contain all 4 without duplicates, sorted ascending
      expect(contextHandle!.activeMessages.map((m) => m.sequenceNum)).toEqual([6, 7, 8, 10]);
    });

    async function mountWithOlderPage() {
      let contextHandle: ReturnType<typeof useMessaging> | null = null;
      function TestController() {
        contextHandle = useMessaging();
        return null;
      }
      await act(async () => {
        root.render(
          <MessagingProvider user={testUser}>
            <TestController />
          </MessagingProvider>,
        );
      });
      await act(async () => {
        contextHandle!.hydrateConversationMessages(
          testConversation.id,
          initialServerMessages,
          true,
          initialServerMessages[0]!.id,
        );
      });
      return () => contextHandle!;
    }

    it("loadOlderMessages runs one fetch at a time and flags loading", async () => {
      const actionsModule = await import("@/app/app/messages/actions");
      let resolveFetch: (v: { ok: true; messages: Message[]; hasMore: boolean }) => void = () => {};
      const getMessagesSpy = vi
        .spyOn(actionsModule, "getMessagesAction")
        .mockImplementation(() => new Promise((resolve) => (resolveFetch = resolve)));
      const ctx = await mountWithOlderPage();

      let first: Promise<void> = Promise.resolve();
      await act(async () => {
        first = ctx().loadOlderMessages(testConversation.id);
        void ctx().loadOlderMessages(testConversation.id); // same tick: must be ignored
      });
      expect(getMessagesSpy).toHaveBeenCalledTimes(1);
      expect(ctx().pagination[testConversation.id]?.loadingOlder).toBe(true);

      await act(async () => {
        resolveFetch({ ok: true, messages: [], hasMore: false });
        await first;
      });
      expect(ctx().pagination[testConversation.id]?.loadingOlder).toBe(false);
    });

    it("loadOlderMessages records a failure and allows a retry", async () => {
      const actionsModule = await import("@/app/app/messages/actions");
      const getMessagesSpy = vi
        .spyOn(actionsModule, "getMessagesAction")
        .mockResolvedValue({ ok: false, message: "Network down." });
      const ctx = await mountWithOlderPage();

      await act(async () => {
        await ctx().loadOlderMessages(testConversation.id);
      });
      const pag = ctx().pagination[testConversation.id];
      expect(pag?.loadingOlder).toBe(false);
      expect(pag?.olderError).toBe("Network down.");
      expect(pag?.hasMoreOlder).toBe(true);

      await act(async () => {
        await ctx().loadOlderMessages(testConversation.id);
      });
      expect(getMessagesSpy).toHaveBeenCalledTimes(2);
    });

    it("correctly handles single-message and empty arrays for oldestCursor", async () => {
      let contextHandle: ReturnType<typeof useMessaging> | null = null;

      function TestController() {
        contextHandle = useMessaging();
        return null;
      }

      await act(async () => {
        root.render(
          <MessagingProvider user={testUser}>
            <TestController />
          </MessagingProvider>,
        );
      });

      // Single-message array
      await act(async () => {
        contextHandle!.hydrateConversationMessages("conv-single", [
          {
            id: "msg-solo",
            conversationId: "conv-single",
            senderId: peerUser.id,
            clientMessageId: "c-solo",
            content: "Solo message",
            sequenceNum: 1,
            createdAt: "2026-11-19T10:00:00Z",
          },
        ]);
      });
      expect(contextHandle!.pagination["conv-single"]?.oldestCursor).toBe("msg-solo");

      // Empty array
      await act(async () => {
        contextHandle!.hydrateConversationMessages("conv-empty", []);
      });
      expect(contextHandle!.pagination["conv-empty"]?.oldestCursor).toBeUndefined();
    });
  });
});
