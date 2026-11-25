import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getConversationAction, getMessagesAction } from "@/app/app/messages/actions";
import { getSession } from "@/lib/auth/server";
import { validateUuid } from "@/lib/messaging/validation";

import { ConversationView } from "./ConversationView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}): Promise<Metadata> {
  const { conversationId } = await params;
  return {
    title: `Conversation · Holoraa`,
    description: `Active direct conversation ${conversationId}`,
  };
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
  const convRes = await getConversationAction(conversationId);
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

  return (
    <ConversationView
      conversationId={conversationId}
      initialConversation={convRes.conversation}
      initialMessages={initialMessages}
    />
  );
}
