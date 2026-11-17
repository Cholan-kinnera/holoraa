'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  INITIAL_PEOPLE_DIRECTORY,
  INITIAL_SOCIAL_GRAPH,
} from '../lib/data/mock-data';
import type { DirectoryUser } from '../lib/dsa/search-graph';
import { useLenis } from '../lib/lenis';
import { FloatingNavbar } from './landing/FloatingNavbar';
import { Hero3DStage } from './landing/Hero3DStage';
import { LiveSearchPlayground } from './landing/LiveSearchPlayground';
import { StoryBentoGrid } from './landing/StoryBentoGrid';
import { TheContrast } from './landing/TheContrast';
import { Principles } from './landing/Principles';
import { Holories } from './landing/Holories';
import { FinalCta } from './landing/FinalCta';
import { BrandLogo } from './ui/Brand';

export function HoloraaApp() {
  // Page-level smooth scrolling enabled on landing page
  useLenis(true);

  const [people] = useState<Record<string, DirectoryUser>>(INITIAL_PEOPLE_DIRECTORY);
  const [socialGraph, setSocialGraph] = useState<Record<string, Set<string>>>(INITIAL_SOCIAL_GRAPH);

  // Floating pill notice
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  // Follow / Unfollow toggle for the interactive landing search demo
  const handleToggleFollow = useCallback(
    (targetUserId: string) => {
      setSocialGraph((prev) => {
        const next = { ...prev };
        const myFollows = new Set(next['arjun'] ?? []);
        const targetUser = people[targetUserId];
        const targetName = targetUser ? targetUser.name.split(' ')[0] : 'user';

        if (myFollows.has(targetUserId)) {
          myFollows.delete(targetUserId);
          showNotice(`Unfollowed ${targetName}`);
        } else {
          myFollows.add(targetUserId);
          showNotice(`Now following ${targetName}`);
        }
        next['arjun'] = myFollows;
        return next;
      });
    },
    [people, showNotice]
  );

  return (
    <div className="min-h-screen bg-oled-black text-ink-primary font-sans antialiased selection:bg-accent-coral/20 selection:text-white flex flex-col">
      <FloatingNavbar />

      <main id="main" className="flex-1">
        <Hero3DStage />

        <LiveSearchPlayground
          peopleDirectory={people}
          socialGraph={socialGraph}
          currentUserId="arjun"
          onToggleFollow={handleToggleFollow}
        />

        <StoryBentoGrid />

        <TheContrast />

        <Principles />

        <Holories />

        <FinalCta />
      </main>

      <footer className="py-12 border-t hairline-border bg-oled-black text-center text-xs text-ink-muted">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BrandLogo className="text-sm font-semibold tracking-tight text-white" />
            <span>·</span>
            <span>One quiet place for the people who matter.</span>
          </div>
          <nav aria-label="Footer Navigation" className="flex items-center gap-6 text-ink-secondary">
            <a href="#the-contrast" className="hover:text-white transition-colors">
              Why Holoraa
            </a>
            <a href="#principles" className="hover:text-white transition-colors">
              Principles
            </a>
            <a href="#holories" className="hover:text-white transition-colors">
              Holories
            </a>
            <Link href="/status" className="hover:text-white transition-colors">
              System Status
            </Link>
            <Link href="/sign-in" className="hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/app" className="hover:text-white transition-colors">
              Launch App
            </Link>
          </nav>
        </div>
      </footer>

      {/* Floating Pill Toast */}
      {noticeMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-oled-elevated hairline-border text-xs text-white shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {noticeMessage}
        </div>
      )}
    </div>
  );
}
