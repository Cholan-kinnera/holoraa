'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, Search, X } from '../ui/Icons';
import { BrandLogo, BrandMark } from '../ui/Brand';

interface FloatingNavbarProps {
  onOpenSearch: () => void;
  onEnterApp: (tab?: string) => void;
}

export function FloatingNavbar({ onOpenSearch, onEnterApp }: FloatingNavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="floating-navbar-container">
      <nav
        aria-label="Main Navigation"
        className="floating-navbar"
      >
        <div
          className="navbar-brand-group"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        >
          <BrandMark className="w-6 h-6" />
          <BrandLogo className="text-base font-semibold tracking-tight text-white" />
        </div>

        <div className="navbar-nav-links">
          <a href="#section-chat" className="navbar-link">
            Messages
          </a>
          <a href="#section-spot" className="navbar-link">
            The Spot
          </a>
          <a href="#section-spaces" className="navbar-link">
            Spaces
          </a>
          <a href="#section-room" className="navbar-link">
            Personal Room
          </a>
          <a href="#principles" className="navbar-link">
            Principles
          </a>
          <Link href="/status" className="navbar-link">
            Status
          </Link>
        </div>

        <div className="navbar-actions-group">
          <button
            type="button"
            onClick={onOpenSearch}
            className="navbar-search-btn"
            aria-label="Find people with command palette"
          >
            <Search size={14} />
            <span className="navbar-search-label">Find people</span>
            <span className="navbar-search-kbd">⌘K</span>
          </button>
          <button
            type="button"
            onClick={() => onEnterApp('dms')}
            className="navbar-cta-btn"
          >
            <span className="navbar-cta-text-full">Open Holoraa</span>
            <span className="navbar-cta-text-short">Open</span>
            <ArrowUpRight size={14} />
          </button>

          {/* Mobile hamburger toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="navbar-mobile-toggle"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-panel"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div id="mobile-nav-panel" className="navbar-mobile-panel" role="region" aria-label="Mobile Navigation">
          <div className="navbar-mobile-links">
            <a
              href="#section-chat"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Messages & Chat
            </a>
            <a
              href="#section-spot"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              The Spot & Moments
            </a>
            <a
              href="#section-spaces"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Spaces & Voice Lounge
            </a>
            <a
              href="#section-room"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Personal Rooms
            </a>
            <a
              href="#principles"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Principles
            </a>
            <Link
              href="/status"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              System Status
            </Link>
            <Link
              href="/sign-in"
              className="navbar-mobile-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Sign In (In Development)
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
