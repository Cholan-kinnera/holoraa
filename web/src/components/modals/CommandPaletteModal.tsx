'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import { buildUserSearchTrie, searchPeople } from '../../lib/dsa/search-graph';
import { Search, X } from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import { FollowButton } from '../ui/FollowButton';

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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
      setSelectedIndex(0);
    }
  }

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Outside click dismissal
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: PointerEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose]);

  // Keyboard navigation for arrow keys and Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0
        );
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          onClose();
          onSelectUser(selected.user.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, results, selectedIndex, onSelectUser]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmd-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 p-4"
    >
      <div ref={modalRef} className="w-full max-w-xl rounded-[28px] bg-oled-sidebar hairline-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <h2 id="cmd-modal-title" className="sr-only">
          Search people and thoughts
        </h2>

        {/* Input Bar */}
        <div className="p-4 hairline-b flex items-center gap-3">
          <div className="text-ink-secondary">
            <Search size={16} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search people by name, @handle, mutuals, or vibes..."
            className="flex-1 bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
              }}
              className="p-1 text-ink-muted hover:text-white"
              aria-label="Clear query"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 rounded-md bg-oled-surface text-[11px] text-ink-secondary hover:text-white font-mono"
          >
            ESC
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2.5 hairline-b flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[11px] text-ink-muted shrink-0 mr-1">Try:</span>
            {['aanya', 'film', 'coffee', 'synth'].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setQuery(chip);
                  setSelectedIndex(0);
                }}
                className={`px-2.5 py-0.5 rounded-full text-[11px] hairline-border transition-colors ${
                  query.toLowerCase() === chip
                    ? 'bg-white text-black font-medium'
                    : 'bg-oled-surface text-ink-secondary hover:text-white'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          <span className="font-mono text-[10px] text-ink-muted shrink-0 hidden sm:inline">
            {results.length} {results.length === 1 ? 'result' : 'results'} (0.2ms)
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="p-8 text-center text-ink-muted">
              <Search size={20} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium text-white">No people found</p>
              <p className="text-[11px] text-ink-secondary mt-1">
                No profiles match &ldquo;{query}&rdquo;
              </p>
            </div>
          ) : (
            results.map(({ user, mutuals }, idx) => {
              const isFollowing = myFollowing.has(user.id);
              const isSelected = selectedIndex === idx;

              return (
                <div
                  key={user.id}
                  onClick={() => {
                    onClose();
                    onSelectUser(user.id);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-white/[0.08] hairline-border'
                      : 'hover:bg-oled-surface border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={user.avatar}
                      alt={user.name}
                      size="lg"
                      presence={user.online ? 'online' : undefined}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white">{user.name}</span>
                        <span className="text-[11px] text-ink-secondary">{user.handle}</span>
                      </div>
                      <p className="text-[11px] text-ink-secondary truncate">{user.bio}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-mono text-[10px] text-ink-muted hidden sm:inline">
                      {mutuals.length} mutuals
                    </span>
                    <FollowButton
                      isFollowing={isFollowing}
                      onToggle={() => onToggleFollow(user.id)}
                      size="sm"
                    />
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
