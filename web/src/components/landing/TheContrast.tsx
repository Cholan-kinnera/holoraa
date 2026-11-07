'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';

interface StoryPillar {
  badge: string;
  pillarNum: string;
  title: string;
  narrative: string;
  takeaway: string;
  bullets: string[];
}

const EDITORIAL_PILLARS: StoryPillar[] = [
  {
    badge: 'Feed & Attention',
    pillarNum: '01',
    title: 'A quiet circle without algorithmic traps',
    narrative:
      'No unread badges inducing panic. No algorithmic feeds rearranging your friends’ words to keep you scrolling. Holoraa offers a clean, calm timeline where you see what your close circle shared in the order they shared it—and when you reach the end, you are done.',
    takeaway: 'Zero ads · Pure chronology · Natural pause',
    bullets: [
      'Posts appear strictly in the order they were shared',
      'No algorithmic engagement ranking or sponsored distractions',
      'Quiet presence indicators that respect your time',
    ],
  },
  {
    badge: 'Personal Space',
    pillarNum: '02',
    title: 'Spaces that actually belong to you',
    narrative:
      'Your personal room is a permanent, quiet spot on the web. Friends knock when they want to hang out, and you choose when to open the door. Drop into casual voice lounges with zero pressure to turn on cameras, and leave silently without friction.',
    takeaway: 'Knock consent · Ambient voice · Zero pressure',
    bullets: [
      'Permanent personal room handle with knock-to-enter consent',
      'Drop-in voice lounges with warm, low-latency audio',
      'Step out whenever you want without awkward goodbyes',
    ],
  },
  {
    badge: 'Mutual Discovery',
    pillarNum: '03',
    title: 'Meaningful connection through mutual trust',
    narrative:
      'Connecting with people shouldn’t require trading your personal data. We do not harvest contacts, track your habits across the web, or push viral strangers into your orbit. Discovery happens organically through mutual friends you already know and trust.',
    takeaway: 'Mutual-first discovery · Private by default · No trackers',
    bullets: [
      'Find friends through mutual circles, never contact scraping',
      'Private by default with fail-closed access rules',
      'Zero advertising trackers or behavioral profiling',
    ],
  },
];

export function TheContrast() {
  const containerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.editorial-contrast-header',
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: '.editorial-contrast-header',
            start: 'top 85%',
          },
        }
      );

      gsap.utils.toArray<HTMLElement>('.editorial-contrast-card').forEach((card) => {
        gsap.fromTo(
          card,
          { y: 40, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 85%',
            },
          }
        );
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      id="the-contrast"
      className="editorial-contrast-section"
      aria-labelledby="contrast-heading"
    >
      <div className="editorial-contrast-container">
        <div className="editorial-contrast-header">
          <p className="eyebrow">The Contrast</p>
          <h2 id="contrast-heading" className="section__title">
            Communication without compromise.
          </h2>
          <p className="lede-text">
            Most social platforms force you to choose between attention-extracting feeds and chaotic workspace clutter.
            Holoraa was built from day one on a quiet third path—designed around human presence and real relationships.
          </p>
        </div>

        <div className="editorial-contrast-grid">
          {EDITORIAL_PILLARS.map((pillar) => (
            <article key={pillar.badge} className="editorial-contrast-card">
              <div className="editorial-contrast-top">
                <span className="editorial-contrast-tag">{pillar.badge}</span>
                <span className="editorial-contrast-num">{pillar.pillarNum}</span>
              </div>

              <h3 className="editorial-contrast-title">{pillar.title}</h3>
              <p className="editorial-contrast-narrative">{pillar.narrative}</p>

              <ul className="editorial-contrast-bullets">
                {pillar.bullets.map((b) => (
                  <li key={b} className="editorial-contrast-bullet-item">
                    <span className="editorial-contrast-bullet-check" aria-hidden="true">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <div className="editorial-contrast-footer">
                <span className="editorial-contrast-footer-dot" />
                <span className="editorial-contrast-takeaway">{pillar.takeaway}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
