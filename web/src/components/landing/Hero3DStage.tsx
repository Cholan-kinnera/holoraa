'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, DoorOpen, Sparkles, SquarePen } from '../ui/Icons';
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
    <section ref={containerRef} className="hero-3d-stage">
      {/* Floating Live Activity Pills */}
      <div className="hero-floating-pills">
        <div className="float-pill hero-float-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"
            className="w-5 h-5 rounded-full object-cover"
            alt="Aanya"
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
        <button
          type="button"
          onClick={() => onEnterApp('spot')}
          className="btn-glass-action"
        >
          <Sparkles size={16} className="text-accent-coral" />
          <span>Explore The Spot</span>
        </button>
        <button
          type="button"
          onClick={() => onEnterApp('room')}
          className="btn-glass-action"
        >
          <DoorOpen size={16} className="text-accent-green" />
          <span>My Room</span>
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
              className="text-xs text-accent-coral hover:underline font-medium"
            >
              Open full screen →
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
                <div className="flex items-center gap-3.5 py-2 mb-3 overflow-hidden hairline-b pb-3">
                  <div
                    className="flex flex-col items-center gap-1 cursor-pointer"
                    onClick={() => onEnterApp('dms')}
                  >
                    <div className="w-11 h-11 rounded-full bg-neutral-800 p-0.5 ring-1 ring-accent-coral">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                        alt="Aanya"
                        className="w-full h-full object-cover rounded-full"
                      />
                    </div>
                    <span className="text-xs text-white">Fred again 🎧</span>
                  </div>
                  <div
                    className="flex flex-col items-center gap-1 cursor-pointer"
                    onClick={() => onEnterApp('room')}
                  >
                    <div className="w-11 h-11 rounded-full bg-neutral-800 p-0.5 ring-1 ring-accent-green">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                        alt="Rohan"
                        className="w-full h-full object-cover rounded-full"
                      />
                    </div>
                    <span className="text-xs text-accent-green">in room 🎙️</span>
                  </div>
                  <div
                    className="flex flex-col items-center gap-1 cursor-pointer"
                    onClick={() => onEnterApp('spot')}
                  >
                    <div className="w-11 h-11 rounded-full bg-neutral-800 p-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
                        alt="Meera"
                        className="w-full h-full object-cover rounded-full"
                      />
                    </div>
                    <span className="text-xs text-ink-secondary">film lab 🎞️</span>
                  </div>
                </div>

                {/* Mini Active Rows */}
                <div className="space-y-1.5">
                  <div
                    onClick={() => onEnterApp('dms')}
                    className="p-2.5 rounded-2xl bg-oled-elevated cursor-pointer flex items-center gap-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                      alt="Aanya"
                      className="w-9 h-9 rounded-full object-cover"
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=120&auto=format&fit=crop&q=80"
                      alt="Goa"
                      className="w-9 h-9 rounded-full object-cover"
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                          className="w-8 h-8 rounded-full object-cover"
                          alt="Aanya"
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
                    <div className="pl-10 flex items-center gap-4 text-xs text-ink-secondary">
                      <span className="text-accent-coral flex items-center gap-1">❤️ 18</span>
                      <button
                        type="button"
                        onClick={() => onEnterApp('spot')}
                        className="hover:text-white transition-colors"
                      >
                        Reply in DM →
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-oled-surface hairline-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80"
                          className="w-8 h-8 rounded-full object-cover"
                          alt="Kabir"
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                        className="w-8 h-8 rounded-full object-cover mt-0.5"
                        alt="Aanya"
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
                    <div className="p-2.5 rounded-2xl bg-white text-black text-xs font-medium max-w-xs">
                      On my way, bringing my notebook 🏃
                    </div>
                  </div>
                </div>
              )}

              <div
                onClick={() => onEnterApp('spot')}
                className="hero-mini-composer"
              >
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=80&auto=format&fit=crop&q=80"
                    className="w-6 h-6 rounded-full object-cover"
                    alt="You"
                  />
                  <span className="text-xs text-ink-muted">Drop a thought or status note...</span>
                </div>
                <span className="text-xs font-medium text-accent-coral pr-1">Post →</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
