'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles, SquarePen } from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import { gsap } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';

interface Hero3DStageProps {
  onEnterApp: (tab?: string) => void;
}

export function Hero3DStage({ onEnterApp }: Hero3DStageProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [previewTab, setPreviewTab] = useState<'spot' | 'chat'>('spot');

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.hero-floating-pills', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.6 })
        .fromTo('.hero-pill', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, '-=0.3')
        .fromTo('.hero-headline', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.4')
        .fromTo('.hero-subhead', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, '-=0.5')
        .fromTo('.hero-actions', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, '-=0.5')
        .fromTo(
          '#hero-preview-frame',
          { y: 40, opacity: 0, scale: 0.96 },
          { y: 0, opacity: 1, scale: 1, duration: 1.1, ease: 'power3.out' },
          '-=0.4'
        );
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="hero-stage-section">
      <div className="hero-stage-ambient" aria-hidden="true" />
      <div className="hero-3d-stage">
        {/* Floating Live Activity Pills */}
      <div className="hero-floating-pills">
        <div className="float-pill hero-float-card">
          <Avatar
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"
            alt="Aanya"
            size="xs"
          />
          <span>
            <strong className="text-white font-medium">Aanya</strong> dropped a thought ·{' '}
            <span className="font-mono text-xs text-ink-muted">2s ago</span>
          </span>
        </div>
        <div className="float-pill hero-float-card delay-1600">
          <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          <span>
            <strong className="text-white font-medium">Rohan & Kabir</strong> in Late Night Lounge
          </span>
        </div>
      </div>

      <div className="hero-pill">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-coral" />
        <span>Messages · Thoughts · Spaces · Personal Rooms</span>
      </div>

      <h1 className="hero-headline">
        One quiet place for the <br className="hidden sm:inline" />
        <span className="hero-headline-serif">
          people who matter.
        </span>
      </h1>

      <p className="hero-subhead">
        Private messaging, shared thoughts, quiet voice lounges, and personal rooms. Pitch black,
        zero ads, no noise.
      </p>

      <div className="hero-actions">
        <button
          type="button"
          onClick={() => onEnterApp('dms')}
          className="btn-primary-launch"
        >
          <span>Launch Web App</span>
          <ArrowRight size={16} />
        </button>
        <Link
          href="/sign-in"
          className="btn-glass-action"
        >
          <span>Sign In</span>
        </Link>
        <button
          type="button"
          onClick={() => onEnterApp('spot')}
          className="btn-glass-action"
        >
          <Sparkles size={16} className="text-accent-coral" />
          <span>The Spot</span>
        </button>
      </div>

      {/* 3D App Preview Frame */}
      <div className="hero-preview-container perspective-1400">
        <div id="hero-preview-frame" className="hero-preview-window">
          {/* Mock Window Header */}
          <div className="hero-window-header">
            <div className="window-dots">
              <span className="window-dot" />
              <span className="window-dot" />
              <span className="window-dot" />
            </div>
            <div className="window-title">
              <span>holoraa.app</span>
              <span className="text-ink-muted">·</span>
              <span className="text-accent-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" /> 4 friends active
              </span>
            </div>
            <button
              type="button"
              onClick={() => onEnterApp('spot')}
              className="btn-window-action"
            >
              <span>Open full screen</span>
              <span className="text-accent-coral">→</span>
            </button>
          </div>

          <p className="sr-only">
            Illustrative preview of a conversation view. It is not a screenshot of a released interface.
          </p>

          {/* Mini Preview Split */}
          <div className="hero-window-body">
            {/* Left Mini Drawer */}
            <div className="hero-mini-drawer">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-sm text-white">Messages & Notes</span>
                  <SquarePen size={14} className="text-ink-secondary" />
                </div>
                {/* Mini Notes Row */}
                <div className="grid grid-cols-3 gap-2 py-2 mb-3 border-b hairline-border pb-3 text-center">
                  <div
                    className="flex flex-col items-center gap-1.5 cursor-pointer group"
                    onClick={() => onEnterApp('dms')}
                  >
                    <Avatar
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                      alt="Aanya"
                      size="md"
                      ring="coral"
                    />
                    <span className="text-[11px] text-neutral-300 font-medium group-hover:text-white transition-colors">
                      Aanya
                    </span>
                  </div>

                  <div
                    className="flex flex-col items-center gap-1.5 cursor-pointer group"
                    onClick={() => onEnterApp('room')}
                  >
                    <Avatar
                      src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                      alt="Rohan"
                      size="md"
                      ring="green"
                    />
                    <span className="text-[11px] text-neutral-300 font-medium group-hover:text-white transition-colors">
                      Rohan
                    </span>
                  </div>

                  <div
                    className="flex flex-col items-center gap-1.5 cursor-pointer group"
                    onClick={() => onEnterApp('spot')}
                  >
                    <Avatar
                      src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
                      alt="Meera"
                      size="md"
                    />
                    <span className="text-[11px] text-neutral-300 font-medium group-hover:text-white transition-colors">
                      Meera
                    </span>
                  </div>
                </div>

                {/* Mini Active Rows */}
                <div className="space-y-1.5">
                  <div
                    onClick={() => onEnterApp('dms')}
                    className="p-2.5 rounded-2xl bg-oled-elevated cursor-pointer flex items-center gap-3"
                  >
                    <Avatar
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                      alt="Aanya Sharma"
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-white">Aanya Sharma</span>
                        <span className="font-mono text-xs text-ink-muted">12:38</span>
                      </div>
                      <p className="text-xs text-ink-secondary truncate">Grabbed our corner table ☕</p>
                    </div>
                  </div>
                  <div
                    onClick={() => onEnterApp('dms')}
                    className="p-2.5 rounded-2xl hover:bg-oled-surface cursor-pointer flex items-center gap-3 transition-colors"
                  >
                    <Avatar
                      src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=120&auto=format&fit=crop&q=80"
                      alt="Weekend Goa Plan"
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-white">Weekend Goa Plan 🌴</span>
                        <span className="font-mono text-xs text-ink-muted">11:20</span>
                      </div>
                      <p className="text-xs text-white font-medium truncate">
                        Meera: Hop in Arjun&apos;s room at 9!
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mini Voice Bar */}
              <div
                onClick={() => onEnterApp('room')}
                className="p-2.5 rounded-2xl bg-oled-surface hairline-border flex items-center justify-between cursor-pointer hover:bg-oled-elevated transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent-green animate-ping" />
                  <span className="text-xs text-white font-medium">holoraa.app/arjun</span>
                </div>
                <span className="text-xs text-accent-green">1 knocking →</span>
              </div>
            </div>

            {/* Right Mini Preview Stage */}
            <div className="hero-mini-stage">
              <div className="flex items-center justify-between pb-3.5 hairline-b">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('spot')}
                    className={previewTab === 'spot' ? 'tab-pill-active' : 'tab-pill-inactive'}
                  >
                    The Spot · Thoughts
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('chat')}
                    className={previewTab === 'chat' ? 'tab-pill-active' : 'tab-pill-inactive'}
                  >
                    Direct Chat
                  </button>
                </div>
                <span className="text-xs text-ink-secondary font-mono">
                  Calm Graph · Mutuals first
                </span>
              </div>

              {previewTab === 'spot' ? (
                /* Mini Thoughts Stream Preview */
                <div className="space-y-3 my-auto py-3">
                  <div className="p-3.5 rounded-2xl bg-oled-surface hairline-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                          alt="Aanya Sharma"
                          size="md"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-white">Aanya Sharma</span>
                            <span className="text-xs text-ink-secondary">@aanya</span>
                            <span className="px-2 py-0.5 rounded-full bg-oled-elevated text-xs text-ink-secondary">
                              🎧 Fred again..
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-ink-muted">4m</span>
                    </div>
                    <p className="text-xs text-neutral-200 leading-relaxed pl-10">
                      Editing the 35mm roll from Pondicherry. Love having a quiet spot to share
                      snapshots with close friends without reels algorithms.
                    </p>
                    <div className="pl-10 flex items-center gap-4 text-xs">
                      <span className="text-accent-coral flex items-center gap-1 font-mono text-[11px]">❤️ 18</span>
                      <button
                        type="button"
                        onClick={() => onEnterApp('spot')}
                        className="btn-reply-dm"
                      >
                        <span>Reply in DM</span>
                        <span className="text-accent-coral">→</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-oled-surface hairline-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80"
                          alt="Kabir Menon"
                          size="md"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-white">Kabir Menon</span>
                            <span className="text-xs text-ink-secondary">@kabir</span>
                            <span className="px-2 py-0.5 rounded-full bg-oled-elevated text-xs text-accent-green">
                              🌙 late night
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-ink-muted">19m</span>
                    </div>
                    <p className="text-xs text-neutral-200 leading-relaxed pl-10">
                      Anyone up for a late-night synth jam in the lounge at 11? Dropping stems now.
                    </p>
                  </div>
                </div>
              ) : (
                /* Mini Chat Stream Preview */
                <div className="space-y-3 my-auto py-3">
                  <div className="p-3.5 rounded-2xl bg-oled-surface hairline-border space-y-2">
                    <div className="flex items-start gap-2.5">
                      <Avatar
                        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                        alt="Aanya Sharma"
                        size="md"
                      />
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-white">Aanya Sharma</span>
                        <div className="p-2.5 rounded-2xl bg-oled-bubble hairline-border text-xs text-neutral-200">
                          Saved our corner table at Blue Tokai ☕ Grab the cold brew!
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="story-outgoing-bubble text-xs font-medium max-w-xs">
                      On my way, bringing my notebook 🏃
                    </div>
                  </div>
                </div>
              )}

              <div
                onClick={() => onEnterApp('spot')}
                className="hero-mini-composer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar
                    src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=80&auto=format&fit=crop&q=80"
                    alt="You"
                    size="sm"
                  />
                  <span className="text-xs text-ink-muted truncate">Drop a thought or status note...</span>
                </div>
                <span className="text-xs font-medium text-accent-coral shrink-0 pr-1">Post →</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
