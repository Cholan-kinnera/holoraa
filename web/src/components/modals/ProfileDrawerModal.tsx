'use client';

import React, { useEffect } from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import { getMutualFollowers } from '../../lib/dsa/search-graph';
import { X } from '../ui/Icons';

interface ProfileDrawerModalProps {
  userId: string | null;
  onClose: () => void;
  peopleDirectory: Record<string, DirectoryUser>;
  socialGraph: Record<string, Set<string>>;
  currentUserId: string;
  onToggleFollow: (userId: string) => void;
  onOpenDirectChat: (userId: string) => void;
}

export function ProfileDrawerModal({
  userId,
  onClose,
  peopleDirectory,
  socialGraph,
  currentUserId,
  onToggleFollow,
  onOpenDirectChat,
}: ProfileDrawerModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && userId) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userId, onClose]);

  if (!userId) return null;

  const person = peopleDirectory[userId] ?? peopleDirectory.aanya;
  if (!person) return null;

  const isMe = person.id === currentUserId;
  const myFollowing = socialGraph[currentUserId] ?? new Set<string>();
  const isFollowing = myFollowing.has(person.id);
  const mutuals = getMutualFollowers(currentUserId, person.id, socialGraph, peopleDirectory);
  const personFollowing = socialGraph[person.id];
  const followingCount = personFollowing ? personFollowing.size : 12;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-name"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-[28px] bg-oled-sidebar hairline-border p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={person.avatar}
              className="w-16 h-16 rounded-full object-cover ring-2 ring-white/10"
              alt={person.name}
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 id="profile-modal-name" className="font-semibold text-base text-white">
                  {person.name}
                </h3>
                {person.note && (
                  <span className="px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[10px] text-neutral-300">
                    {person.note}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-secondary">{person.handle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-ink-secondary hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-neutral-200 leading-relaxed">{person.bio}</p>

        <div className="flex items-center gap-6 py-3 hairline-t hairline-b text-xs">
          <div>
            <strong className="font-mono text-white">{person.followersCount}</strong>{' '}
            <span className="text-ink-secondary">followers</span>
          </div>
          <div>
            <strong className="font-mono text-white">{followingCount}</strong>{' '}
            <span className="text-ink-secondary">following</span>
          </div>
          {!isMe && (
            <div className="text-accent-coral font-mono text-[11px]">
              {mutuals.length} mutuals
            </div>
          )}
        </div>

        {!isMe && mutuals.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-ink-secondary">
            <div className="flex -space-x-1.5">
              {mutuals.slice(0, 3).map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={m.avatar}
                  className="w-5 h-5 rounded-full object-cover ring-1 ring-black"
                  alt={m.name}
                />
              ))}
            </div>
            <span>Followed by {mutuals.map((m) => m.name.split(' ')[0]).join(', ')}</span>
          </div>
        )}

        <div className="flex items-center gap-2.5 pt-1">
          {!isMe ? (
            <>
              <button
                type="button"
                onClick={() => onToggleFollow(person.id)}
                className={`flex-1 py-2.5 rounded-full text-xs font-medium transition-all ${
                  isFollowing
                    ? 'bg-oled-elevated text-white hairline-border hover:bg-neutral-800'
                    : 'bg-white text-black hover:bg-neutral-200'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDirectChat(person.id);
                }}
                className="flex-1 py-2.5 rounded-full bg-oled-surface hover:bg-oled-elevated text-white hairline-border text-xs font-medium transition-all"
              >
                Message
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-full bg-white text-black text-xs font-medium hover:bg-neutral-200"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
