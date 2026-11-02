'use client';

import React, { useMemo, useState } from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import {
  buildUserSearchTrie,
  searchPeople,
} from '../../lib/dsa/search-graph';
import { Search } from '../ui/Icons';

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
  const [query, setQuery] = useState('');

  const [latencyMs, setLatencyMs] = useState('0.2');

  const trie = useMemo(() => buildUserSearchTrie(peopleDirectory), [peopleDirectory]);

  const results = useMemo(
    () => searchPeople(query, peopleDirectory, trie, currentUserId, socialGraph),
    [query, peopleDirectory, trie, currentUserId, socialGraph]
  );

  const myFollowing = socialGraph[currentUserId] || new Set<string>();

  return (
    <section className="py-16 px-6 max-w-5xl mx-auto">
      <div className="p-6 sm:p-10 rounded-[32px] bg-oled-sidebar hairline-border relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <span className="font-mono text-[11px] text-accent-coral uppercase tracking-wider">
              Live Search & Mutual Graph
            </span>
            <h2 className="font-semibold text-2xl sm:text-3xl text-white tracking-tight mt-1">
              Find your people in milliseconds.
            </h2>
            <p className="text-xs sm:text-sm text-ink-secondary mt-1">
              Try searching a name, handle, or vibe below—powered by instant prefix matching and
              mutual-friend discovery.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-ink-muted mr-1">Try:</span>
            {['aanya', 'film', 'coffee', 'synth'].map((vibe) => (
              <button
                key={vibe}
                type="button"
                onClick={() => setQuery(vibe)}
                className="px-2.5 py-1 rounded-full bg-oled-elevated hover:bg-neutral-800 text-neutral-300 transition-colors"
              >
                {vibe}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="px-2.5 py-1 rounded-full bg-oled-surface text-ink-secondary hover:text-white transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Live Search Input */}
        <div className="relative mb-6">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-secondary">
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
            className="w-full pl-11 pr-32 py-3.5 rounded-2xl bg-oled-black hairline-border text-sm text-white placeholder-ink-muted focus:outline-none focus:border-white/25 transition-all"
          />
          <span className="font-mono text-[11px] text-ink-muted absolute right-4 top-1/2 -translate-y-1/2">
            {results.length} people ({latencyMs}ms)
          </span>
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                className="p-3.5 rounded-2xl bg-oled-black hairline-border hover:border-white/20 transition-all flex items-center justify-between gap-3 cursor-pointer"
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
                      <span className="text-[11px] text-ink-secondary">{user.handle}</span>
                    </div>
                    <p className="text-[11px] text-ink-secondary truncate">{user.bio}</p>
                    <p className="text-[10px] text-accent-coral mt-0.5">{mutualText}</p>
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
