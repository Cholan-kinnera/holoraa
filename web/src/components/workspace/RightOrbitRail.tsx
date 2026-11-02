'use client';

import React from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import { computeOrbitRecommendations } from '../../lib/dsa/search-graph';
import { Shield } from '../ui/Icons';

interface RightOrbitRailProps {
  currentUser: DirectoryUser;
  peopleDirectory: Record<string, DirectoryUser>;
  socialGraph: Record<string, Set<string>>;
  currentUserId: string;
  onOpenProfile: (userId: string) => void;
  onOpenRoom: () => void;
  onToggleFollow: (userId: string) => void;
  selfNote: string;
}

export function RightOrbitRail({
  currentUser,
  peopleDirectory,
  socialGraph,
  currentUserId,
  onOpenProfile,
  onOpenRoom,
  onToggleFollow,
  selfNote,
}: RightOrbitRailProps) {
  const recommendations = computeOrbitRecommendations(currentUserId, socialGraph, peopleDirectory, 5);
  const followingCount = (socialGraph[currentUserId] || new Set<string>()).size;

  return (
    <aside className="hidden lg:flex lg:col-span-4 h-full flex-col bg-oled-sidebar p-5 overflow-y-auto space-y-6 shrink-0 w-80 hairline-l">
      {/* Social Graph Summary Card */}
      <div className="p-4 rounded-2xl bg-oled-surface hairline-border space-y-3.5">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => onOpenProfile(currentUserId)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUser.avatar}
              className="w-11 h-11 rounded-full object-cover"
              alt={currentUser.name}
            />
            <div>
              <h3 className="text-xs font-semibold text-white">{currentUser.name}</h3>
              <p className="text-[11px] text-ink-secondary">{currentUser.handle} · Bengaluru</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-oled-elevated hairline-border text-[10px] text-neutral-300">
            {selfNote || '✨ building'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 hairline-t text-center">
          <div
            className="p-2 rounded-xl hover:bg-oled-elevated cursor-pointer transition-colors"
            onClick={() => onOpenProfile(currentUserId)}
          >
            <p className="font-mono text-sm font-semibold text-white">{followingCount}</p>
            <p className="text-[10px] text-ink-secondary">Following</p>
          </div>
          <div
            className="p-2 rounded-xl hover:bg-oled-elevated cursor-pointer transition-colors"
            onClick={() => onOpenProfile(currentUserId)}
          >
            <p className="font-mono text-sm font-semibold text-white">{currentUser.followersCount}</p>
            <p className="text-[10px] text-ink-secondary">Followers</p>
          </div>
          <div
            className="p-2 rounded-xl hover:bg-oled-elevated cursor-pointer transition-colors"
            onClick={onOpenRoom}
          >
            <p className="font-mono text-sm font-semibold text-accent-green">Open</p>
            <p className="text-[10px] text-ink-secondary">My Room</p>
          </div>
        </div>
      </div>

      {/* People in Your Orbit (2-Hop BFS Recommendations) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h4 className="text-xs font-semibold text-white">People in your orbit</h4>
            <p className="text-[11px] text-ink-secondary">Connected via mutual friends</p>
          </div>
          <span className="font-mono text-[10px] text-ink-muted">2-hop graph</span>
        </div>

        <div className="space-y-2">
          {recommendations.map(({ user, mutuals, isFollowing }) => {
            const mutualNames = mutuals.map((m) => m.name.split(' ')[0]);
            const subLabel =
              mutualNames.length > 0
                ? `Followed by ${mutualNames.slice(0, 2).join(', ')}${
                    mutualNames.length > 2 ? ` +${mutualNames.length - 2}` : ''
                  }`
                : user.handle;

            return (
              <div
                key={user.id}
                onClick={() => onOpenProfile(user.id)}
                className="p-3 rounded-2xl bg-oled-surface hairline-border hover:border-white/15 transition-all flex items-center justify-between gap-2.5 cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={user.avatar}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                    alt={user.name}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{user.name}</p>
                    <p className="text-[10px] text-ink-secondary truncate">{subLabel}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFollow(user.id);
                  }}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium shrink-0 transition-all ${
                    isFollowing
                      ? 'bg-oled-elevated text-ink-secondary hover:text-white hairline-border'
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

      {/* Calm Feed Note */}
      <div className="p-4 rounded-2xl bg-oled-black hairline-border space-y-1.5">
        <p className="text-xs font-medium text-white flex items-center gap-1.5">
          <Shield size={14} className="text-accent-green" />
          <span>Zero engagement traps</span>
        </p>
        <p className="text-[11px] text-ink-secondary leading-relaxed">
          Thoughts are ordered by fresh activity and mutual connection strength—never rage-bait or
          paid promotions.
        </p>
      </div>
    </aside>
  );
}
