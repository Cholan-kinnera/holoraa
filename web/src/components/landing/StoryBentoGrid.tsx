'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { CheckCheck } from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import { FollowButton } from '../ui/FollowButton';
import { gsap } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';


interface StoryBentoGridProps {
  onEnterApp: (tab: string) => void;
}

export function StoryBentoGrid({ onEnterApp }: StoryBentoGridProps) {
  const containerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.story-row').forEach((row) => {
        gsap.fromTo(
          row,
          { y: 48, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: row,
              start: 'top 82%',
              toggleActions: 'play none none reverse',
            },
          }
        );
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="story-bento-section">
      {/* Pillar 01: Direct & Groups */}
      <div id="section-chat" className="story-row story-row--chat">
        <div className="story-row-info">
          <span className="story-pillar-num">01 / DIRECT & GROUPS</span>
          <h2 className="story-pillar-title">
            Fast, familiar chat. <br />
            <span className="story-serif-highlight">
              Stripped of clutter.
            </span>
          </h2>
          <p className="story-pillar-desc">
            Everything you love about direct conversations—instant photos, crisp read ticks,
            swipe-feel replies, and top status notes—on a calm pitch-black canvas.
          </p>
        </div>

        <div className="story-card-wrapper">
          <div className="flex items-start gap-3">
            <Avatar
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
              alt="Aanya"
              size="md"
              className="mt-1"
            />
            <div className="space-y-1.5">
              <div className="story-photo-bubble">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80"
                  className="w-full h-44 object-cover rounded-xl"
                  alt="Beach sunset"
                />
                <p className="px-3 py-2 text-xs text-neutral-200">Morning coffee by the coast ☕🌊</p>
              </div>
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-oled-elevated hairline-border text-xs">
                <span>❤️</span>
                <span>🔥</span>
                <span className="text-xs text-ink-secondary ml-0.5">3</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="story-outgoing-bubble">
              <div className="story-quote-reply truncate">
                Aanya: Morning coffee by the coast ☕🌊
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-white">Save us a table, reaching in 15!</span>
                <CheckCheck size={14} className="text-accent-coral shrink-0" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pillar 02: The Spot & Graph */}
      <div id="section-spot" className="story-row story-row--spot">
        <div className="story-card-wrapper">
          <div className="p-4 rounded-2xl bg-oled-black hairline-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
                  alt="Meera Nair"
                  size="lg"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">Meera Nair</span>
                    <span className="text-xs text-ink-secondary">@meera</span>
                  </div>
                  <p className="text-xs text-ink-secondary">Followed by Aanya + 6 mutuals</p>
                </div>
              </div>
              <FollowButton
                isFollowing={false}
                onToggle={() => onEnterApp('spot')}
                size="sm"
              />
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
                className="btn-reply-dm"
              >
                <span>Reply in DM</span>
                <span className="text-accent-coral">→</span>
              </button>
            </div>
          </div>
        </div>

        <div className="story-row-info">
          <span className="story-pillar-num">02 / THE SPOT & GRAPH</span>
          <h2 className="story-pillar-title">
            Share thoughts. <br />
            <span className="story-serif-highlight">
              Connect through friends.
            </span>
          </h2>
          <p className="story-pillar-desc">
            A calm stream for spontaneous thoughts, music notes, and photos. Discover people in your
            orbit through mutual connections—and reply straight into a private DM with one tap.
          </p>
        </div>
      </div>

      {/* Pillar 03: Quiet Spaces */}
      <div id="section-spaces" className="story-row story-row--spaces">
        <div className="story-row-info">
          <span className="story-pillar-num">03 / COMMUNITIES</span>
          <h2 className="story-pillar-title">
            Spaces without the <br />
            <span className="story-serif-highlight">
              notification fatigue.
            </span>
          </h2>
          <p className="story-pillar-desc">
            Run a close study group, design club, or gaming crew. Clean text channels and a cozy voice
            lounge where friends can pull up a chair without 50 blinking badges.
          </p>
        </div>

        <div className="story-card-wrapper">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-oled-black hairline-border space-y-2.5">
              <p className="text-xs uppercase tracking-wider text-ink-muted font-medium">Channels</p>
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
                <span className="text-xs text-ink-secondary">3 inside</span>
              </div>
              <div className="flex items-center -space-x-2 my-4">
                <Avatar
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                  alt="Member"
                  size="md"
                />
                <Avatar
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80"
                  alt="Speaking member"
                  size="md"
                  ring="green"
                />
                <Avatar
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80"
                  alt="Member"
                  size="md"
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
      <div id="section-room" className="story-row story-row--room">
        <div className="story-card-wrapper">
          <div className="room-knock-card">
            <div className="room-knock-info">
              <Avatar
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                alt="Rohan"
                size="xl"
                presence="knock"
              />
              <div className="room-knock-details">
                <p className="room-knock-title">Rohan knocked on your room</p>
                <p className="room-knock-meta">holoraa.app/arjun · Waiting lobby</p>
              </div>
            </div>
            <div className="room-knock-actions">
              <button
                type="button"
                onClick={() => onEnterApp('room')}
                className="btn-let-in"
              >
                Let in
              </button>
              <button
                type="button"
                onClick={() => onEnterApp('room')}
                className="btn-dismiss-knock"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>

        <div className="story-row-info">
          <span className="story-pillar-num">04 / PERSONAL ROOMS</span>
          <h2 className="story-pillar-title">
            Your own corner <br />
            <span className="story-serif-highlight">
              on the internet.
            </span>
          </h2>
          <p className="story-pillar-desc">
            Share one permanent link—<span className="text-white">holoraa.app/arjun</span>. Friends knock to
            enter your waiting room, and you let them in with a tap.
          </p>
        </div>
      </div>
    </section>
  );
}
