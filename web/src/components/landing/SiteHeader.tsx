"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import { ButtonLink } from "@/components/ui/ButtonLink";

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "#principles", label: "Principles" },
  { href: "#holories", label: "Holories" },
  { href: "/status", label: "System status" },
];

/**
 * The floating header. The links are real and work without JavaScript. The
 * menu button only appears on small screens, and it is the one piece that needs
 * state: it opens a Motion panel, closes on Escape, and returns focus to the
 * button.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    firstLink.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="site-header glass">
      <Link href="/" className="brand" aria-label="Holoraa home">
        <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <circle cx="16" cy="16" r="5" fill="currentColor" />
          <circle cx="6" cy="9" r="2.5" fill="currentColor" opacity="0.6" />
          <circle cx="26" cy="7" r="2.5" fill="currentColor" opacity="0.6" />
          <path d="M16 16 L6 9 M16 16 L26 7" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
        Holoraa
      </Link>

      <div className="site-nav">
        <nav aria-label="Primary">
          <ul className="site-nav__links">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-nav__actions">
          <span className="tag tag--progress" title="Sign-in is in development. It is not available yet.">
            Sign-in in development
          </span>
          <ButtonLink href="#principles" className="site-nav__cta">
            Principles
          </ButtonLink>
          <button
            ref={toggle}
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <motion.div
          id={menuId}
          className="mobile-menu glass"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {LINKS.map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              ref={index === 0 ? firstLink : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </motion.div>
      ) : null}
    </header>
  );
}
