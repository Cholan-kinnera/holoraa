'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import { buildUserSearchTrie, searchPeople } from '../../lib/dsa/search-graph';
import { Search } from '../ui/Icons';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  peopleDirectory: Record<string, DirectoryUser>;
  socialGraph: Record<string, Set<string>>;
  currentUserId: string;
  onSelectUser: (userId: string) => void;
  onToggleFollow: (userId: string) => void;
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  peopleDirectory,
  socialGraph,
  currentUserId,
  onSelectUser,
  onToggleFollow,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const trie = useMemo(() => buildUserSearchTrie(peopleDirectory), [peopleDirectory]);
  const results = useMemo(
    () => searchPeople(query, peopleDirectory, trie, currentUserId, socialGraph),
    [query, peopleDirectory, trie, currentUserId, socialGraph]
  );

  const myFollowing = socialGraph[currentUserId] || new Set<string>();

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setQuery('');
    }
  }

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmd-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center pt-20 p-4"
    >
      <div className="w-full max-w-xl rounded-[28px] bg-oled-sidebar hairline-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <h2 id="cmd-modal-title" className="sr-only">
          Search people and thoughts
        </h2>

        <div className="p-4 hairline-b flex items-center gap-3">
          <div className="text-ink-secondary">
            <Search size={16} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name, @handle, mutuals, or thoughts..."
            className="flex-1 bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 rounded-md bg-oled-surface text-[11px] text-ink-secondary hover:text-white"
          >
            ESC
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-3 space-y-2">
          {results.length === 0 ? (
            <p className="p-6 text-center text-xs text-ink-muted">No people found matching &quot;{query}&quot;</p>
          ) : (
            results.map(({ user, mutuals }) => {
              const isFollowing = myFollowing.has(user.id);
              return (
                <div
                  key={user.id}
                  onClick={() => {
                    onClose();
                    onSelectUser(user.id);
                  }}
                  className="p-3 rounded-2xl hover:bg-oled-surface flex items-center justify-between gap-3 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={user.avatar}
                      className="w-10 h-10 rounded-full object-cover shrink-0"
                      alt={user.name}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-white">{user.name}</span>
                        <span className="text-[11px] text-ink-secondary">{user.handle}</span>
                      </div>
                      <p className="text-[11px] text-ink-secondary truncate">{user.bio}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-ink-muted hidden sm:inline">
                      {mutuals.length} mutuals
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFollow(user.id);
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        isFollowing
                          ? 'bg-oled-elevated text-white hairline-border'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
