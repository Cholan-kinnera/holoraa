'use client';

import React from 'react';
import { DoorOpen, Hash, MessageCircle, Search, Sliders, Sparkles } from '../ui/Icons';
import { BrandMark } from '../ui/Brand';
import { Avatar } from '../ui/Avatar';

export type WorkspaceTab = 'dms' | 'spot' | 'spaces' | 'room';

interface IconRailProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onReturnToLanding: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenProfile: (userId: string) => void;
  currentUserId: string;
  hasUnread: boolean;
  hasKnock: boolean;
  avatarUrl: string;
}

export function IconRail({
  activeTab,
  onSelectTab,
  onReturnToLanding,
  onOpenSearch,
  onOpenSettings,
  onOpenProfile,
  currentUserId,
  hasUnread,
  hasKnock,
  avatarUrl,
}: IconRailProps) {
  return (
    <aside
      className="w-16 h-full bg-oled-black hairline-r flex flex-col items-center py-5 justify-between shrink-0 z-20"
      aria-label="Workspace Navigation"
    >
      {/* Top Brand Mark (Returns to Landing) */}
      <button
        type="button"
        onClick={onReturnToLanding}
        className="w-10 h-10 rounded-2xl bg-oled-surface hover:bg-oled-elevated hairline-border flex items-center justify-center transition-all cursor-pointer group"
        title="Back to Landing Page"
      >
        <BrandMark className="group-hover:scale-105 transition-transform" />
      </button>

      {/* Center Primary Navigation Icons */}
      <div className="flex flex-col items-center gap-3">
        {/* 1. Direct Messages */}
        <button
          type="button"
          onClick={() => onSelectTab('dms')}
          className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
            activeTab === 'dms'
              ? 'bg-white text-black shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Messages"
          aria-label="Messages"
        >
          <MessageCircle size={20} />
          {hasUnread && activeTab !== 'dms' && (
            <span className="w-2 h-2 rounded-full bg-accent-coral absolute top-2 right-2 ring-2 ring-black" />
          )}
        </button>

        {/* 2. The Spot */}
        <button
          type="button"
          onClick={() => onSelectTab('spot')}
          className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
            activeTab === 'spot'
              ? 'bg-white text-black shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="The Spot · Thoughts & People"
          aria-label="The Spot · Thoughts & People"
        >
          <Sparkles size={20} />
        </button>

        {/* 3. Spaces */}
        <button
          type="button"
          onClick={() => onSelectTab('spaces')}
          className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
            activeTab === 'spaces'
              ? 'bg-white text-black shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Spaces"
          aria-label="Spaces"
        >
          <Hash size={20} />
        </button>

        {/* 4. My Personal Room */}
        <button
          type="button"
          onClick={() => onSelectTab('room')}
          className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
            activeTab === 'room'
              ? 'bg-white text-black shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="My Personal Room"
          aria-label="My Personal Room"
        >
          <DoorOpen size={20} />
          {hasKnock && (
            <span className="w-2.5 h-2.5 rounded-full bg-accent-green absolute top-2 right-2 animate-ping" />
          )}
        </button>

        <div className="w-6 hairline-t my-1 opacity-60" />

        {/* Global Command-K Search Trigger */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-11 h-11 rounded-2xl text-neutral-400 hover:text-white hover:bg-oled-surface flex items-center justify-center transition-all"
          title="Search People & Thoughts (⌘K)"
          aria-label="Search People & Thoughts"
        >
          <Search size={20} />
        </button>
      </div>

      {/* Bottom Profile & Settings */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-2xl text-neutral-400 hover:text-white hover:bg-oled-surface flex items-center justify-center transition-all"
          title="Preferences & Privacy"
          aria-label="Preferences & Privacy"
        >
          <Sliders size={16} />
        </button>

        <button
          type="button"
          onClick={() => onOpenProfile(currentUserId)}
          className="relative group focus:outline-none"
          title="View Profile"
          aria-label="View Your Profile"
        >
          <Avatar
            src={avatarUrl}
            alt="You"
            size="md"
            presence="online"
          />
        </button>
      </div>
    </aside>
  );
}
