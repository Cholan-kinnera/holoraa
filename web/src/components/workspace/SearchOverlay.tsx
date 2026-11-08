"use client";

import React, { useEffect, useRef, useState } from "react";
import { searchUsersAction } from "@/app/app/actions";
import type { UserSummary } from "@/lib/auth/flows";
import { Avatar } from "../ui/Avatar";
import { FollowButton } from "../ui/FollowButton";
import { Search, X } from "../ui/Icons";
import { SearchResultsSkeleton } from "../ui/Skeleton";

export interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: UserSummary) => void;
  onToggleFollow?: (username: string, nextState: boolean) => Promise<void> | void;
}

export function SearchOverlay(props: SearchOverlayProps) {
  if (!props.isOpen) return null;
  return <SearchOverlayContent {...props} />;
}

function SearchOverlayContent({
  onClose,
  onSelectUser,
  onToggleFollow,
}: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Outside click (pointerdown) and Escape key dismissal
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (
        overlayRef.current &&
        (e.target === null || !(e.target instanceof Node) || !overlayRef.current.contains(e.target))
      ) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
        );
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          onSelectUser(selected);
          onClose();
        }
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, results, selectedIndex, onSelectUser]);

  // 250ms debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    let active = true;

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await searchUsersAction(trimmed, 15);
        if (!active) return;
        if (res.ok) {
          setResults(res.users);
          setSelectedIndex(0);
          setErrorMessage(null);
        } else {
          setErrorMessage(res.message);
          setResults([]);
        }
      } catch {
        if (!active) return;
        setErrorMessage("Something went wrong. Try again.");
        setResults([]);
      } finally {
        if (active) setIsLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const visibleResults = query.trim() ? results : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 p-4"
    >
      <div
        ref={overlayRef}
        className="w-full max-w-xl rounded-[28px] bg-oled-sidebar hairline-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        <h2 id="search-modal-title" className="sr-only">
          Search people
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
            placeholder="Search people by username or name..."
            className="flex-1 bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none"
            aria-label="Search people by username or name"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setSelectedIndex(0);
              }}
              className="p-1 text-ink-muted hover:text-white"
              aria-label="Clear search input"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 rounded-md bg-oled-surface text-[11px] text-ink-secondary hover:text-white font-mono"
            aria-label="Close search dialog"
          >
            ESC
          </button>
        </div>

        {/* Status / Results List */}
        <div className="max-h-[70vh] sm:max-h-96 overflow-y-auto p-2 space-y-1">
          {isLoading && <SearchResultsSkeleton />}

          {!isLoading && errorMessage && (
            <div className="p-8 text-center text-red-400" role="alert">
              <p className="text-xs font-medium">{errorMessage}</p>
            </div>
          )}

          {!isLoading && !errorMessage && query.trim() && visibleResults.length === 0 && (
            <div className="p-8 text-center text-ink-muted" role="status">
              <Search size={20} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium text-white">No people found</p>
              <p className="text-[11px] text-ink-secondary mt-1">
                No profiles match &ldquo;{query}&rdquo;
              </p>
            </div>
          )}

          {!isLoading && !errorMessage && !query.trim() && (
            <div className="p-8 text-center text-ink-muted">
              <Search size={20} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium text-white">Find people on Holoraa</p>
              <p className="text-[11px] text-ink-secondary mt-1">
                Type at least one character to search by username or display name.
              </p>
            </div>
          )}

          {!isLoading &&
            !errorMessage &&
            visibleResults.map((user, idx) => {
              const isSelected = selectedIndex === idx;

              return (
                <div
                  key={user.id}
                  onClick={() => {
                    onSelectUser(user);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-white/[0.08] hairline-border"
                      : "hover:bg-oled-surface border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={user.avatarUrl}
                      alt={user.displayName ?? user.username}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white">
                          {user.displayName ?? user.username}
                        </span>
                        <span className="text-[11px] text-ink-secondary">
                          @{user.username}
                        </span>
                      </div>
                      {user.bio && (
                        <p className="text-[11px] text-ink-secondary truncate">{user.bio}</p>
                      )}
                    </div>
                  </div>
                  {onToggleFollow && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <FollowButton
                        isFollowing={user.isFollowing}
                        onToggle={() => onToggleFollow(user.username, !user.isFollowing)}
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
