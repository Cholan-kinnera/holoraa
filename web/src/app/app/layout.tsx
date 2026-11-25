import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Unavailable } from "@/components/app/Unavailable";
import { getConversationsAction } from "@/app/app/messages/actions";
import { getSession } from "@/lib/auth/server";
import type { Conversation } from "@/lib/messaging/flows";

// Each request checks the session. A prerendered copy would be served to everyone.
export const dynamic = "force-dynamic";

/**
 * Session gate for everything under /app. It fails closed: anything other than a
 * confirmed session never shows application content.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session.state === "unavailable") {
    return <Unavailable />;
  }
  if (session.state === "signed-out") {
    redirect("/sign-in");
  }
  if (session.state === "expired") {
    redirect("/sign-in?expired=1");
  }
  // Hydrate the sidebar on the server so it renders without a loading flash. On
  // failure the client fetches it and shows the error state itself.
  let initialConversations: Conversation[] | undefined;
  if (session.user.profileComplete) {
    const res = await getConversationsAction();
    if (res.ok) {
      initialConversations = res.conversations;
    }
  }

  return (
    <AppShell user={session.user} initialConversations={initialConversations}>
      {children}
    </AppShell>
  );
}
