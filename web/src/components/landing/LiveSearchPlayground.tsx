'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import {
  buildUserSearchTrie,
  searchPeople,
} from '../../lib/dsa/search-graph';
import { Search } from '../ui/Icons';
import { gsap } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';


interface LiveSearchPlaygroundProps {
  peopleDirectory: Record<string, DirectoryUser>;
  socialGraph: Record<string, Set<string>>;
  currentUserId: string;
  onToggleFollow: (targetId: string) => void;
  onSelectUser: (userId: string) => void;
}

export function LiveSearchPlayground({
  peopleDirectory,
  socialGraph,
  currentUserId,
  onToggleFollow,
  onSelectUser,
}: LiveSearchPlaygroundProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [latencyMs, setLatencyMs] = useState('0.2');

  const trie = useMemo(() => buildUserSearchTrie(peopleDirectory), [peopleDirectory]);

  const results = useMemo(
    () => searchPeople(query, peopleDirectory, trie, currentUserId, socialGraph),
    [query, peopleDirectory, trie, currentUserId, socialGraph]
  );

  const myFollowing = socialGraph[currentUserId] || new Set<string>();

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.search-playground-card',
        { y: 36, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: '.search-playground-card',
            start: 'top 85%',
          },
        }
      );
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="search-playground-section">
      <div className="search-playground-card">
        <div className="search-playground-head">
          <div>
            <span className="font-mono text-xs text-accent-coral uppercase tracking-wider font-medium">
              Live Search & Mutual Graph
            </span>
            <h2 className="font-semibold text-2xl sm:text-3xl text-white tracking-tight mt-1">
              Find your people in milliseconds.
            </h2>
            <p className="text-xs sm:text-sm text-ink-secondary mt-1">
              Search a name, handle, or vibe below—powered by instant prefix matching and
              mutual-friend discovery.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-muted mr-1">Try:</span>
            {['aanya', 'film', 'coffee', 'synth'].map((vibe) => (
              <button
                key={vibe}
                type="button"
                onClick={() => setQuery(vibe)}
                className="chip-suggestion"
              >
                {vibe}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="chip-reset"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Live Search Input */}
        <div className="relative mb-6">
          <div className="search-input-icon">
            <Search size={16} />
          </div>
          <input
            id="landing-live-search"
            type="text"
            value={query}
            onChange={(e) => {
              const t0 = performance.now();
              setQuery(e.target.value);
              const elapsed = Math.max(0.1, performance.now() - t0).toFixed(1);
              setLatencyMs(elapsed);
            }}
            placeholder="Search people, @handles, thoughts, or vibes (e.g. 'film', 'coffee', 'kabir')..."
            className="search-input-field"
          />
          <span className="search-latency-badge">
            {results.length} results ({latencyMs}ms)
          </span>

        </div>

        {/* Results Grid */}
        <div className="search-results-grid">
          {results.slice(0, 4).map(({ user, mutuals }) => {
            const isFollowing = myFollowing.has(user.id);
            const firstMutual = mutuals[0];
            const mutualText =
              firstMutual
                ? `Followed by ${firstMutual.name.split(' ')[0] ?? ''}${
                    mutuals.length > 1 ? ` + ${mutuals.length - 1} mutuals` : ''
                  }`
                : 'In your extended network';

            return (
              <div
                key={user.id}
                onClick={() => onSelectUser(user.id)}
                className="search-result-card"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={user.avatar}
                    className="w-11 h-11 rounded-full object-cover shrink-0"
                    alt={user.name}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white truncate">{user.name}</span>
                      <span className="text-xs text-ink-secondary">{user.handle}</span>
                    </div>
                    <p className="text-xs text-ink-secondary truncate">{user.bio}</p>
                    <p className="text-xs text-accent-coral mt-0.5">{mutualText}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFollow(user.id);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-all ${
                    isFollowing
                      ? 'bg-oled-elevated text-white hairline-border hover:bg-neutral-800'
                      : 'bg-white text-black hover:bg-neutral-200'
                  }`}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
