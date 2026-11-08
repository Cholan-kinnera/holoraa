"use client";

import { useActionState, useId } from "react";

import { updateProfileAction, type ProfileState } from "@/app/app/actions";
import type { User } from "@/lib/auth/flows";

const INITIAL: ProfileState = { status: "idle", message: null };

export function ProfileForm({ user, isSetup = false }: { user: User; isSetup?: boolean }) {
  const [state, action, saving] = useActionState(updateProfileAction, INITIAL);
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <form action={action} className="form profile__form">
      <input type="hidden" name="isSetup" value={isSetup ? "1" : "0"} />
      <p className="muted">
        Signed in as <strong className="strong-break">{user.email}</strong>
      </p>

      <label className="field">
        <span className="field__label">Username</span>
        <input
          className="input"
          name="username"
          defaultValue={user.username ?? ""}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z][A-Za-z0-9_]{2,31}"
          autoComplete="username"
          aria-describedby={`${id}-username-hint`}
        />
        <span id={`${id}-username-hint`} className="field__hint">
          Letters, digits, and underscores. Start with a letter.
        </span>
      </label>

      <label className="field">
        <span className="field__label">Display name</span>
        <input className="input" name="displayName" defaultValue={user.displayName ?? ""} required maxLength={50} />
      </label>

      <label className="field">
        <span className="field__label">Bio</span>
        <textarea className="textarea" name="bio" defaultValue={user.bio ?? ""} maxLength={160} rows={4} />
        <span className="field__hint">Up to 160 characters. Leave empty to clear it.</span>
      </label>

      <label className="field">
        <span className="field__label">Avatar link</span>
        <input
          className="input"
          name="avatarUrl"
          type="url"
          inputMode="url"
          placeholder="https://"
          defaultValue={user.avatarUrl ?? ""}
          maxLength={2048}
        />
        <span className="field__hint">An https link. Uploading images is not available yet.</span>
      </label>

      {state.message !== null ? (
        <p
          id={messageId}
          className={state.status === "error" ? "alert" : "notice"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <div className="form__actions">
        <button className="btn btn--primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : isSetup ? "Complete profile" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
