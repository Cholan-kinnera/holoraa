"use client";

import Link from "next/link";

import { BrandMark } from "@/components/ui/Brand";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Layout for the signed-in app: a header, a conversation sidebar, and the main
 * area. On small screens the sidebar becomes a drawer. The drawer closes on
 * Escape, from the scrim, and when the toggle is pressed again, and focus
 * returns to the toggle.
 */
export function ShellFrame({
  sidebar,
  account,
  children,
}: {
  sidebar: ReactNode;
  account: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const sidebarId = useId();

  useEffect(() => {
    if (!navOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  function closeNav() {
    setNavOpen(false);
    toggle.current?.focus();
  }

  return (
    <div className={navOpen ? "shell shell--nav-open" : "shell"}>
      <header className="shell__header glass">
        <div className="shell__start">
          <button
            ref={toggle}
            type="button"
            className="menu-toggle"
            aria-expanded={navOpen}
            aria-controls={sidebarId}
            aria-label={navOpen ? "Close conversations" : "Open conversations"}
            onClick={() => setNavOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              {navOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
          <Link href="/app" className="brand">
            <BrandMark />
            Holoraa
          </Link>
        </div>
        {account}
      </header>
      <div className="shell__body">
        <aside id={sidebarId} className="shell__sidebar glass" aria-label="Conversations">
          {sidebar}
        </aside>
        <div className="shell__main">{children}</div>
      </div>
      {navOpen ? <button type="button" className="shell__scrim" aria-label="Close conversations" onClick={closeNav} /> : null}
    </div>
  );
}
