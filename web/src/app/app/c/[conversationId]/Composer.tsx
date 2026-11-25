"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

import { validateMessageContent } from "@/lib/messaging/validation";

export const MAX_MESSAGE_LENGTH = 4000;
/** Show the remaining-characters counter from this many characters left. */
const COUNTER_FROM = 500;
/** Cap the auto-growing textarea; it scrolls beyond this. */
const MAX_INPUT_PX = 160;

/**
 * Message composer. Enter sends on devices with a fine pointer (desktop);
 * Shift+Enter, and Enter on touch devices, insert a newline. Enter never
 * sends while an input method is composing text.
 *
 * Sending is optimistic: the text clears at once and the message appears in
 * the thread; a failure shows there with a retry, so the text is not restored.
 */
export function Composer({
  peerName,
  disabledReason,
  onSend,
}: {
  peerName: string;
  /** Why sending is not possible right now, or null when it is. */
  disabledReason: string | null;
  onSend: (content: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();

  const disabled = disabledReason !== null;
  const remaining = MAX_MESSAGE_LENGTH - text.trim().length;
  const canSend = !disabled && text.trim().length > 0 && remaining >= 0;

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    // border-box: scrollHeight excludes the border, so add it back or the
    // field is 2px short and shows a scrollbar on a single line.
    const full = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(full, MAX_INPUT_PX)}px`;
    el.style.overflowY = full > MAX_INPUT_PX ? "auto" : "hidden";
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    if (error) setError(null);
    resize(e.target);
  }

  function submit() {
    if (disabled) return;
    const problem = validateMessageContent(text);
    if (problem) {
      // Empty input is simply ignored; other problems are explained.
      if (text.trim().length > 0) setError(problem);
      return;
    }
    onSend(text);
    setText("");
    setError(null);
    const el = inputRef.current;
    if (el) {
      el.value = "";
      resize(el);
      el.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME composition
    if (window.matchMedia?.("(pointer: coarse)").matches) return; // touch: newline
    e.preventDefault();
    submit();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  const note = error ?? disabledReason;

  return (
    <form className="composer thread__composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`${noteId}-input`}>
        Message {peerName}
      </label>
      <textarea
        id={`${noteId}-input`}
        ref={inputRef}
        className="textarea composer__input"
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Messaging is unavailable" : `Message ${peerName}`}
        enterKeyHint="send"
        aria-describedby={note ? noteId : undefined}
        aria-invalid={error ? true : undefined}
      />
      <button
        type="submit"
        className="btn btn--primary composer__send"
        disabled={!canSend}
        aria-label="Send message"
        title="Send"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M3.4 9.2 16.1 3.6c.6-.3 1.2.3.9.9l-5.6 12.7c-.3.6-1.1.6-1.3-.1l-1.4-4.6-4.6-1.4c-.7-.2-.7-1-.1-1.3Z"
            fill="currentColor"
          />
        </svg>
      </button>
      {remaining <= COUNTER_FROM && !disabled && (
        <p className={remaining < 0 ? "composer__count composer__count--over" : "composer__count"} aria-live="polite">
          {remaining < 0 ? `${-remaining} over the limit` : `${remaining} left`}
        </p>
      )}
      {note && (
        <p id={noteId} className={error ? "composer__note composer__note--error" : "composer__note"} role={error ? "alert" : undefined}>
          {note}
        </p>
      )}
    </form>
  );
}
