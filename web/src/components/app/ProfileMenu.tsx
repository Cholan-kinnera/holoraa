"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import type { User } from "@/lib/auth/flows";

/**
 * The account menu in the shell header. Escape closes it and returns focus to the
 * button. The sign-out control is a form, so it works without JavaScript.
 */
export function ProfileMenu({ user, signOut }: { user: User; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const label = user.displayName ?? user.username ?? user.email;
  const initial = label.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="menu">
      <button
        ref={toggle}
        type="button"
        className="menu__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="menu__name">{label}</span>
      </button>
      {open ? (
        <motion.div
          id={panelId}
          className="menu__panel glass"
          role="group"
          aria-label="Account"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <p className="menu__meta">{user.email}</p>
          <Link href="/app/profile" className="menu__item" onClick={() => setOpen(false)}>
            Profile
          </Link>
          <form action={signOut}>
            <button type="submit" className="menu__item">
              Sign out
            </button>
          </form>
        </motion.div>
      ) : null}
    </div>
  );
}
