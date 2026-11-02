'use client';

import React from 'react';
import { ArrowRight, DoorOpen, Sparkles, SquarePen } from '../ui/Icons';

interface Hero3DStageProps {
  onEnterApp: (tab?: string) => void;
}

export function Hero3DStage({ onEnterApp }: Hero3DStageProps) {
  return (
    <section className="pt-32 sm:pt-36 pb-20 px-6 max-w-6xl mx-auto text-center relative">
      {/* Floating Live Activity Pills */}
      <div className="hidden lg:flex items-center justify-between max-w-4xl mx-auto mb-6 pointer-events-none">
        <div className="float-pill inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-oled-surface/90 hairline-border text-xs text-ink-secondary backdrop-blur-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"
            className="w-5 h-5 rounded-full object-cover"
            alt="Aanya"
          />
          <span>
            <strong className="text-white font-medium">Aanya</strong> dropped a thought ·{' '}
            <span className="font-mono text-[10px] text-ink-muted">2s ago</span>
          </span>
        </div>
        <div
          className="float-pill inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-oled-surface/90 hairline-border text-xs text-ink-secondary backdrop-blur-md"
          style={{ animationDelay: '1.6s' }}
        >
          <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          <span>
            <strong className="text-white font-medium">Rohan & Kabir</strong> in Late Night Lounge
          </span>
        </div>
      </div>

      <div className="hero-pill inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-oled-surface hairline-border text-ink-secondary text-xs mb-7">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-coral" />
        <span>Messages · Thoughts · Spaces · Personal Rooms</span>
      </div>

      <h1 className="hero-headline font-semibold text-4xl sm:text-6xl md:text-7xl tracking-tight text-white max-w-4xl mx-auto leading-[1.04]">
        One quiet place for the <br className="hidden sm:inline" />
        <span className="font-serif italic font-normal text-neutral-300 text-5xl sm:text-7xl md:text-[82px]">
          people who matter.
        </span>
      </h1>

      <p className="hero-subhead mt-6 text-base sm:text-lg text-ink-secondary max-w-xl mx-auto font-normal leading-relaxed">
        Private messaging, shared thoughts, quiet voice lounges, and personal rooms. Pitch black,
        zero ads, no noise.
      </p>

      <div className="hero-actions mt-9 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => onEnterApp('dms')}
          className="px-7 py-3.5 rounded-full bg-white text-black hover:bg-neutral-200 font-medium text-sm transition-all flex items-center gap-2 shadow-sm"
        >
          <span>Launch Web App</span>
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => onEnterApp('spot')}
          className="px-6 py-3.5 rounded-full bg-oled-surface hover:bg-oled-elevated text-white hairline-border font-medium text-sm transition-all flex items-center gap-2"
        >
          <Sparkles size={16} className="text-accent-coral" />
          <span>Explore The Spot</span>
        </button>
        <button
          type="button"
          onClick={() => onEnterApp('room')}
          className="px-6 py-3.5 rounded-full bg-oled-surface hover:bg-oled-elevated text-white hairline-border font-medium text-sm transition-all flex items-center gap-2"
        >
          <DoorOpen size={16} className="text-accent-green" />
          <span>My Room</span>
        </button>
      </div>

      {/* 3D App Preview Frame */}
      <div className="mt-14 sm:mt-16 relative mx-auto max-w-5xl" style={{ perspective: '1400px' }}>
        <div
          id="hero-preview-frame"
          className="rounded-[28px] bg-oled-sidebar hairline-border shadow-2xl overflow-hidden text-left transform-gpu transition-all duration-700"
        >
          {/* Mock Window Header */}
          <div className="h-11 px-4 bg-oled-black hairline-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
              <span className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
              <span className="w-2.5 h-2.5 rounded-full bg-neutral-800" />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-ink-secondary">
              <span>holoraa.app</span>
              <span className="text-ink-muted">·</span>
              <span className="text-accent-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" /> 4 friends active
              </span>
            </div>
            <button
              type="button"
              onClick={() => onEnterApp('spot')}
              className="text-[11px] text-accent-coral hover:underline font-medium"
            >
              Open full screen →
            </button>
          </div>

          {/* Mini Preview Split */}
          <div className="grid grid-cols-1 md:grid-cols-12 h-[440px] bg-oled-black">
            {/* Left Mini Drawer */}
            <div className="hidden md:flex md:col-span-4 flex-col hairline-r bg-oled-sidebar p-4 justify-between">
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
                    <span className="text-[10px] text-white">Fred again 🎧</span>
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
                    <span className="text-[10px] text-accent-green">in room 🎙️</span>
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
                    <span className="text-[10px] text-ink-secondary">film lab 🎞️</span>
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
                        <span className="font-mono text-[10px] text-ink-muted">12:38</span>
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
                        <span className="font-mono text-[10px] text-ink-muted">11:20</span>
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
                <span className="text-[11px] text-accent-green">1 knocking →</span>
              </div>
            </div>

            {/* Right Mini Preview: The Spot */}
            <div className="col-span-1 md:col-span-8 flex flex-col justify-between p-5 bg-oled-black">
              <div className="flex items-center justify-between pb-3.5 hairline-b">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-white text-black text-xs font-medium">
                    The Spot · Thoughts
                  </span>
                  <span
                    onClick={() => onEnterApp('dms')}
                    className="px-3 py-1 rounded-full bg-oled-surface text-ink-secondary hover:text-white text-xs cursor-pointer transition-colors"
                  >
                    Direct Chat
                  </span>
                </div>
                <span className="text-[11px] text-ink-secondary font-mono">
                  Calm Graph · Mutuals first
                </span>
              </div>

              {/* Mini Thoughts Stream Preview */}
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
                          <span className="text-[11px] text-ink-secondary">@aanya</span>
                          <span className="px-2 py-0.5 rounded-full bg-oled-elevated text-[10px] text-ink-secondary">
                            🎧 Fred again..
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-ink-muted">4m</span>
                  </div>
                  <p className="text-xs text-neutral-200 leading-relaxed pl-10">
                    Editing the 35mm roll from Pondicherry. Love having a quiet spot to share
                    snapshots with close friends without reels algorithms.
                  </p>
                  <div className="pl-10 flex items-center gap-4 text-[11px] text-ink-secondary">
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
                          <span className="text-[11px] text-ink-secondary">@kabir</span>
                          <span className="px-2 py-0.5 rounded-full bg-oled-elevated text-[10px] text-accent-green">
                            🌙 late night
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-ink-muted">19m</span>
                  </div>
                  <p className="text-xs text-neutral-200 leading-relaxed pl-10">
                    Anyone up for a late-night synth jam in the lounge at 11? Dropping stems now.
                  </p>
                </div>
              </div>

              <div
                onClick={() => onEnterApp('spot')}
                className="h-11 px-3.5 rounded-full bg-oled-surface hairline-border flex items-center justify-between cursor-pointer hover:border-white/20 transition-colors"
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
