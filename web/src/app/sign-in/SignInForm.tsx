"use client";

import { useActionState, useEffect, useId, useState } from "react";

import {
  sendCodeAction,
  verifyCodeAction,
  resendCodeAction,
  type ResendCodeState,
  type SendCodeState,
  type VerifyCodeState,
} from "./actions";

const INITIAL_SEND: SendCodeState = { challenge: null, error: null };
const INITIAL_VERIFY: VerifyCodeState = { error: null };
const INITIAL_RESEND: ResendCodeState = { challengeId: null, error: null, success: false };

/**
 * Two-step authentication: email address entry followed by six-digit OTP verification.
 * Follows DEC-M2-02 F1 design tokens, accessible field validation, 60s cooldown timer,
 * and seamless resend capabilities without losing the active challenge.
 */
export function SignInForm({ expired }: { expired: boolean }) {
  const [sent, sendAction, sending] = useActionState(sendCodeAction, INITIAL_SEND);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const challenge = sent.challenge;
  if (challenge !== null && challenge.challengeId !== dismissedId) {
    return (
      <CodeStep
        key={challenge.challengeId}
        initialChallengeId={challenge.challengeId}
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
          placeholder="name@domain.com"
          required
          maxLength={254}
          defaultValue={defaultEmail}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          disabled={pending}
        />
      </label>
      {error !== null ? (
        <p id={`${id}-error`} className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn--primary btn--full" type="submit" disabled={pending}>
        {pending ? (
          <span className="btn__content">
            <span className="spinner" aria-hidden="true" />
            <span>Sending code…</span>
          </span>
        ) : (
          <span>Send code</span>
        )}
      </button>
    </form>
  );
}

function CodeStep({
  initialChallengeId,
  email,
  onDifferentEmail,
}: {
  initialChallengeId: string;
  email: string;
  onDifferentEmail: () => void;
}) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyCodeAction, INITIAL_VERIFY);
  const [resendState, resendAction, resending] = useActionState(resendCodeAction, INITIAL_RESEND);
  const [sentAt, setSentAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const id = useId();

  // 1-second interval to update time and drive the 60s cooldown ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((now - sentAt) / 1000);
  const cooldown = Math.max(0, 60 - elapsed);
  const currentChallengeId = resendState.challengeId ?? initialChallengeId;
  const resendNotice = resendState.success ? "A new six-digit code has been sent to your email." : null;

  return (
    <div className="code-step">
      <form action={verifyAction} className="form">
        <div className="code-step__header">
          <p className="muted">
            We sent a verification code to <strong className="strong-break">{email}</strong>. It expires in 10 minutes.
          </p>
        </div>

        {resendNotice !== null ? (
          <p className="notice notice--success" role="status">
            {resendNotice}
          </p>
        ) : null}

        <input type="hidden" name="challengeId" value={currentChallengeId} />
        <label className="field">
          <span className="field__label">Six-digit code</span>
          <input
            className="input input--code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="••••••"
            required
            autoFocus
            aria-invalid={verifyState.error !== null ? true : undefined}
            aria-describedby={verifyState.error !== null ? `${id}-error` : undefined}
            disabled={verifying}
          />
        </label>

        {verifyState.error !== null ? (
          <p id={`${id}-error`} className="alert" role="alert">
            {verifyState.error}
          </p>
        ) : null}

        {resendState.error !== null ? (
          <p className="alert" role="alert">
            {resendState.error}
          </p>
        ) : null}

        <button className="btn btn--primary btn--full" type="submit" disabled={verifying}>
          {verifying ? (
            <span className="btn__content">
              <span className="spinner" aria-hidden="true" />
              <span>Signing in…</span>
            </span>
          ) : (
            <span>Sign in</span>
          )}
        </button>
      </form>

      <div className="code-step__actions">
        <form
          action={async (formData) => {
            setSentAt(Date.now());
            await resendAction(formData);
          }}
          className="form__resend"
        >
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            className="btn btn--ghost btn--sm"
            disabled={cooldown > 0 || resending || verifying}
            aria-label={cooldown > 0 ? `Resend code available in ${cooldown} seconds` : "Resend six-digit sign-in code"}
          >
            {resending ? (
              <span className="btn__content">
                <span className="spinner" aria-hidden="true" />
                <span>Resending…</span>
              </span>
            ) : cooldown > 0 ? (
              `Resend code in ${cooldown}s`
            ) : (
              "Resend code"
            )}
          </button>
        </form>

        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={onDifferentEmail}
          disabled={verifying || resending}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
