"use client";

import { useState } from "react";

type Choice = "accept" | "decline";

/**
 * Shown to the recipient of a pending message request in place of the
 * composer. Accepting opens the conversation; declining closes it.
 */
export function RequestBar({
  peerName,
  onAccept,
  onDecline,
}: {
  peerName: string;
  onAccept: () => Promise<{ ok: boolean; error?: string }>;
  onDecline: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: Choice) {
    setBusy(choice);
    setError(null);
    const res = await (choice === "accept" ? onAccept() : onDecline());
    if (!res.ok) {
      setError(res.error ?? "Something went wrong. Try again.");
      setBusy(null);
    }
    // On success the parent replaces or leaves this view.
  }

  return (
    <div className="request-bar" role="region" aria-label="Message request" aria-busy={busy !== null}>
      <div className="request-bar__text">
        <p className="request-bar__title">{peerName} wants to message you</p>
        <p className="request-bar__hint">Accept to reply. Declining closes this conversation.</p>
      </div>
      <div className="request-bar__actions">
        <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => void choose("decline")}>
          {busy === "decline" && <span className="spinner" aria-hidden="true" />}
          Decline
        </button>
        <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void choose("accept")}>
          {busy === "accept" && <span className="spinner" aria-hidden="true" />}
          Accept
        </button>
      </div>
      {error && (
        <p className="request-bar__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
