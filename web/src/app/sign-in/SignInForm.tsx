"use client";

import { useActionState, useId, useState } from "react";

import { sendCodeAction, verifyCodeAction, type SendCodeState, type VerifyCodeState } from "./actions";

const INITIAL_SEND: SendCodeState = { challenge: null, error: null };
const INITIAL_VERIFY: VerifyCodeState = { error: null };

/**
 * Two steps: an email address, then the six-digit code. The step is derived from
 * the last send result, so nothing is stored in the browser. "Use a different
 * email" hides the current challenge and shows the email step again.
 */
export function SignInForm({ expired }: { expired: boolean }) {
  const [sent, sendAction, sending] = useActionState(sendCodeAction, INITIAL_SEND);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const challenge = sent.challenge;
  if (challenge !== null && challenge.challengeId !== dismissedId) {
    return (
      <CodeStep
        key={challenge.challengeId}
        challengeId={challenge.challengeId}
        email={challenge.email}
        onDifferentEmail={() => setDismissedId(challenge.challengeId)}
      />
    );
  }

  return (
    <EmailStep
      action={sendAction}
      pending={sending}
      error={sent.error}
      defaultEmail={challenge?.email ?? ""}
      expired={expired}
    />
  );
}

function EmailStep({
  action,
  pending,
  error,
  defaultEmail,
  expired,
}: {
  action: (payload: FormData) => void;
  pending: boolean;
  error: string | null;
  defaultEmail: string;
  expired: boolean;
}) {
  const id = useId();
  return (
    <form action={action} className="form">
      {expired ? (
        <p className="notice" role="status">
          Your session has ended. Sign in again.
        </p>
      ) : null}
      <label className="field">
        <span className="field__label">Email address</span>
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          defaultValue={defaultEmail}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? `${id}-error` : undefined}
        />
      </label>
      {error !== null ? (
        <p id={`${id}-error`} className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Sending code…" : "Send code"}
      </button>
    </form>
  );
}

function CodeStep({
  challengeId,
  email,
  onDifferentEmail,
}: {
  challengeId: string;
  email: string;
  onDifferentEmail: () => void;
}) {
  const [state, verifyAction, verifying] = useActionState(verifyCodeAction, INITIAL_VERIFY);
  const id = useId();
  return (
    <form action={verifyAction} className="form">
      <p className="muted">
        We sent a code to <strong className="strong-break">{email}</strong>. It expires in 10 minutes.
      </p>
      <input type="hidden" name="challengeId" value={challengeId} />
      <label className="field">
        <span className="field__label">Six-digit code</span>
        <input
          className="input input--code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          aria-invalid={state.error !== null ? true : undefined}
          aria-describedby={state.error !== null ? `${id}-error` : undefined}
        />
      </label>
      {state.error !== null ? (
        <p id={`${id}-error`} className="alert" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="form__actions">
        <button className="btn btn--primary" type="submit" disabled={verifying}>
          {verifying ? "Signing in…" : "Sign in"}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onDifferentEmail} disabled={verifying}>
          Use a different email
        </button>
      </div>
    </form>
  );
}
