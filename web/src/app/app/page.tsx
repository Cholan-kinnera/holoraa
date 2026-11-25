import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/server";
import { validateUuid } from "@/lib/messaging/validation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Conversations",
};

/**
 * The conversation area index page. When no conversation is selected,
 * displays an empty state. If a ?c= query parameter is supplied, redirects
 * to the canonical /app/c/[conversationId] route.
 */
export default async function ConversationPage({
  searchParams,
}: {
  searchParams?: Promise<{ c?: string }>;
}) {
  const session = await getSession();
  if (session.state !== "signed-in") {
    redirect("/sign-in");
  }
  if (!session.user.profileComplete) {
    redirect("/app/profile?setup=1");
  }

  if (searchParams) {
    const resolvedParams = await searchParams;
    if (resolvedParams?.c) {
      const uuidError = validateUuid(resolvedParams.c, "conversation ID");
      if (!uuidError) {
        redirect(`/app/c/${resolvedParams.c}`);
      }
    }
  }

  return (
    <section className="chat" aria-labelledby="chat-title">
      <header className="chat__header">
        <h1 id="chat-title" className="chat__title">
          No conversation selected
        </h1>
      </header>
      <div className="chat__body">
        <p className="eyebrow">Direct Messaging</p>
        <h2 className="chat__heading">Select a conversation or start a new chat.</h2>
        <p className="muted">
          Your active 1:1 conversations appear in the sidebar. Choose a conversation to start messaging.
        </p>
      </div>
      <div className="composer">
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <textarea
          id="composer-input"
          className="textarea composer__input"
          rows={1}
          disabled
          placeholder="Select a conversation to message"
          aria-describedby="composer-note"
        />
        <button className="btn btn--primary" type="button" disabled>
          Send
        </button>
        <p id="composer-note" className="composer__note">
          Select a conversation from the sidebar to send messages.
        </p>
      </div>
    </section>
  );
}
