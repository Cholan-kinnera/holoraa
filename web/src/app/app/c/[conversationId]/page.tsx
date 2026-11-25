import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getConversationAction, getMessagesAction } from "@/app/app/messages/actions";
import { getSession } from "@/lib/auth/server";
import { validateUuid } from "@/lib/messaging/validation";

import { ConversationView } from "./ConversationView";

export const dynamic = "force-dynamic";

// One backend call per request, shared by generateMetadata and the page.
const loadConversation = cache((conversationId: string) => getConversationAction(conversationId));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}): Promise<Metadata> {
  const { conversationId } = await params;
  // The root layout's template appends " · Holoraa".
  const fallback: Metadata = { title: "Conversation" };
  if (validateUuid(conversationId, "conversation ID")) return fallback;
  const res = await loadConversation(conversationId);
  if (!res.ok) return fallback;
  const { peer } = res.conversation;
  return { title: peer.displayName || `@${peer.username}` };
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await getSession();
  if (session.state !== "signed-in") {
    redirect("/sign-in");
  }
  if (!session.user.profileComplete) {
    redirect("/app/profile?setup=1");
  }

  const { conversationId } = await params;

  // Validate UUID shape strictly
  const uuidError = validateUuid(conversationId, "conversation ID");
  if (uuidError) {
    redirect("/app");
  }

  // Fetch conversation server-side to enforce participant authorization
  const convRes = await loadConversation(conversationId);
  if (!convRes.ok) {
    if (convRes.expired) {
      redirect("/sign-in?expired=1");
    }
    // Unauthorized or not found: fail closed to /app
    redirect("/app");
  }

  // Fetch initial message history
  const msgRes = await getMessagesAction(conversationId, { limit: 50 });
  const initialMessages = msgRes.ok ? msgRes.messages : [];
  const initialHasMore = msgRes.ok ? msgRes.hasMore : false;

  return (
    <ConversationView
      conversationId={conversationId}
      initialConversation={convRes.conversation}
      initialMessages={initialMessages}
      initialHasMore={initialHasMore}
    />
  );
}
