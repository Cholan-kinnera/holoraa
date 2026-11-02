'use client';

import React from 'react';
import { CheckCheck } from '../ui/Icons';

interface StoryBentoGridProps {
  onEnterApp: (tab: string) => void;
}

export function StoryBentoGrid({ onEnterApp }: StoryBentoGridProps) {
  return (
    <section className="py-24 px-6 max-w-6xl mx-auto space-y-32">
      {/* Pillar 01: Direct & Groups */}
      <div id="section-chat" className="story-row grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-5 space-y-4">
          <span className="text-xs font-mono text-accent-coral tracking-wider">01 / DIRECT & GROUPS</span>
          <h2 className="font-semibold text-3xl sm:text-4xl text-white tracking-tight leading-tight">
            Fast, familiar chat. <br />
            <span className="font-serif italic font-normal text-neutral-300 text-4xl sm:text-5xl">
              Stripped of clutter.
            </span>
          </h2>
          <p className="text-sm sm:text-base text-ink-secondary leading-relaxed">
            Everything you love about WhatsApp and Instagram Direct—instant photos, crisp read ticks,
            swipe-feel replies, and top status notes—on a calm pitch-black canvas.
          </p>
        </div>

        <div className="lg:col-span-7 p-6 sm:p-8 rounded-[28px] bg-oled-surface hairline-border space-y-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
              className="w-8 h-8 rounded-full object-cover mt-1"
              alt="Aanya"
            />
            <div className="space-y-1.5">
              <div className="p-1.5 rounded-[22px] bg-oled-bubble hairline-border max-w-xs overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80"
                  className="w-full h-44 object-cover rounded-[16px]"
                  alt="Beach sunset"
                />
                <p className="px-3 py-2 text-xs text-neutral-200">Morning coffee by the coast ☕🌊</p>
              </div>
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-oled-elevated hairline-border text-xs">
                <span>❤️</span>
                <span>🔥</span>
                <span className="text-[11px] text-ink-secondary ml-0.5">3</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="max-w-xs px-4 py-2.5 rounded-[20px] rounded-br-md bg-white text-black text-xs leading-relaxed">
              <div className="mb-1.5 pl-2 border-l-2 border-neutral-400 text-[11px] text-neutral-600 truncate">
                Aanya: Morning coffee by the coast ☕🌊
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">Save us a table, reaching in 15!</span>
                <CheckCheck size={14} className="text-neutral-600 shrink-0" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pillar 02: The Spot & Graph */}
      <div id="section-spot" className="story-row grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 order-2 lg:order-1 p-6 sm:p-8 rounded-[28px] bg-oled-surface hairline-border space-y-4">
          <div className="p-4 rounded-2xl bg-oled-black hairline-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
                  className="w-10 h-10 rounded-full object-cover"
                  alt="Meera"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">Meera Nair</span>
                    <span className="text-[11px] text-ink-secondary">@meera</span>
                  </div>
                  <p className="text-[11px] text-ink-secondary">Followed by Aanya + 6 mutuals</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEnterApp('spot')}
                className="px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-colors"
              >
                Follow
              </button>
            </div>
            <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
              Developing 35mm black-and-white rolls at home tonight. Drop your favorite photobooks below 🎞️✨
            </p>
            <div className="flex items-center justify-between pt-2 hairline-t text-xs text-ink-secondary">
              <div className="flex items-center gap-4">
                <span className="text-accent-coral">❤️ 24</span>
                <span>💬 6 replies</span>
              </div>
              <button
                type="button"
                onClick={() => onEnterApp('spot')}
                className="text-white hover:underline text-xs"
              >
                Reply in DM →
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
          <span className="text-xs font-mono text-accent-coral tracking-wider">02 / THE SPOT & GRAPH</span>
          <h2 className="font-semibold text-3xl sm:text-4xl text-white tracking-tight leading-tight">
            Share thoughts. <br />
            <span className="font-serif italic font-normal text-neutral-300 text-4xl sm:text-5xl">
              Connect through friends.
            </span>
          </h2>
          <p className="text-sm sm:text-base text-ink-secondary leading-relaxed">
            A calm stream for spontaneous thoughts, music notes, and photos. Discover people in your
            orbit through mutual connections—and reply straight into a private DM with one tap.
          </p>
        </div>
      </div>

      {/* Pillar 03: Quiet Spaces */}
      <div id="section-spaces" className="story-row grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-5 space-y-4">
          <span className="text-xs font-mono text-accent-coral tracking-wider">03 / COMMUNITIES</span>
          <h2 className="font-semibold text-3xl sm:text-4xl text-white tracking-tight leading-tight">
            Spaces without the <br />
            <span className="font-serif italic font-normal text-neutral-300 text-4xl sm:text-5xl">
              notification fatigue.
            </span>
          </h2>
          <p className="text-sm sm:text-base text-ink-secondary leading-relaxed">
            Run a close study group, design club, or gaming crew. Clean text channels and a cozy voice
            lounge where friends can pull up a chair without 50 blinking badges.
          </p>
        </div>

        <div className="lg:col-span-7 p-6 sm:p-8 rounded-[28px] bg-oled-surface hairline-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-oled-black hairline-border space-y-2.5">
              <p className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Channels</p>
              <div className="space-y-1 text-xs">
                <div className="px-3 py-2 rounded-xl bg-oled-elevated text-white font-medium flex items-center justify-between">
                  <span># general</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-coral" />
                </div>
                <div className="px-3 py-2 rounded-xl text-ink-secondary flex items-center justify-between">
                  <span># film-roll</span>
                </div>
                <div className="px-3 py-2 rounded-xl text-ink-secondary flex items-center justify-between">
                  <span># music-exchange</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-oled-black hairline-border flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
                  Late Night Lounge
                </span>
                <span className="text-[11px] text-ink-secondary">3 inside</span>
              </div>
              <div className="flex items-center -space-x-2 my-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-black"
                  alt="Member"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80"
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-accent-green"
                  alt="Member"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80"
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-black"
                  alt="Member"
                />
              </div>
              <button
                type="button"
                onClick={() => onEnterApp('spaces')}
                className="w-full py-2 rounded-xl bg-oled-elevated hover:bg-neutral-800 text-xs text-white font-medium transition-colors"
              >
                Drop into voice
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pillar 04: Personal Rooms */}
      <div id="section-room" className="story-row grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 order-2 lg:order-1 p-6 sm:p-8 rounded-[28px] bg-oled-surface hairline-border flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                className="w-14 h-14 rounded-full object-cover"
                alt="Rohan"
              />
              <span className="w-3.5 h-3.5 rounded-full bg-accent-coral border-2 border-black absolute -bottom-0.5 -right-0.5" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Rohan knocked on your room</p>
              <p className="text-xs text-ink-secondary mt-0.5">holoraa.app/arjun · Waiting lobby</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onEnterApp('room')}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-full bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-colors"
            >
              Let in
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('room')}
              className="px-4 py-2.5 rounded-full bg-oled-elevated text-ink-secondary text-xs hover:text-white transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
          <span className="text-xs font-mono text-accent-coral tracking-wider">04 / PERSONAL ROOMS</span>
          <h2 className="font-semibold text-3xl sm:text-4xl text-white tracking-tight leading-tight">
            Your own corner <br />
            <span className="font-serif italic font-normal text-neutral-300 text-4xl sm:text-5xl">
              on the internet.
            </span>
          </h2>
          <p className="text-sm sm:text-base text-ink-secondary leading-relaxed">
            Share one permanent link—<span className="text-white">holoraa.app/arjun</span>. Friends knock to
            enter your waiting room, and you let them in with a tap.
          </p>
        </div>
      </div>
    </section>
  );
}
