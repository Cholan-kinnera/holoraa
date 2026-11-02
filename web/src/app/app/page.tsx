import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Conversations",
};

/**
 * The conversation area. Messaging is not built yet, so this is an honest empty
 * state: nothing is invented, and the composer is disabled.
 */
export default async function ConversationPage() {
  const session = await getSession();
  if (session.state !== "signed-in") {
    redirect("/sign-in");
  }
  if (!session.user.profileComplete) {
    redirect("/app/profile?setup=1");
  }

  return (
    <section className="chat" aria-labelledby="chat-title">
      <header className="chat__header">
        <h1 id="chat-title" className="chat__title">
          No conversation selected
        </h1>
      </header>
      <div className="chat__body">
        <p className="eyebrow">Messaging is in development</p>
        <h2 className="chat__heading">Nothing is sent or stored yet.</h2>
        <p className="muted">
          When messaging opens, your conversations will appear here. Messages cannot be sent yet.
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
          placeholder="Messaging is in development"
          aria-describedby="composer-note"
        />
        <button className="btn btn--primary" type="button" disabled>
          Send
        </button>
        <p id="composer-note" className="composer__note">
          Sending is not available yet. Nothing you type here leaves this page.
        </p>
      </div>
    </section>
  );
}
