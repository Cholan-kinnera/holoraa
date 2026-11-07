'use client';

import React, { useState } from 'react';
import type { ConversationThread, SpaceData } from '../../lib/data/mock-data';
import {
  CheckCheck,
  Headphones,
  Image as ImageIcon,
  LinkIcon,
  Maximize2,
  Mic,
  PhoneOff,
  Search,
  Sparkles,
  SquarePen,
  Users,
  X,
} from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import type { WorkspaceTab } from './IconRail';

interface ContextDrawerProps {
  activeTab: WorkspaceTab;
  chats: Record<string, ConversationThread>;
  activeChatKey: string;
  onSelectChat: (key: string) => void;
  selfNote: string;
  onUpdateSelfNote: () => void;
  spotFilter: 'foryou' | 'following' | 'media';
  onSelectSpotFilter: (filter: 'foryou' | 'following' | 'media') => void;
  spotSearchQuery: string;
  onSpotSearch: (q: string) => void;
  followingCount: number;
  spaces: Record<string, SpaceData>;
  currentSpaceKey: string;
  onSelectSpace: (key: string) => void;
  inVoiceLounge: boolean;
  onToggleVoiceLounge: () => void;
  onOpenRoom: () => void;
  onOpenCommandSearch: () => void;
  onCopyInvite: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export function ContextDrawer({
  activeTab,
  chats,
  activeChatKey,
  onSelectChat,
  selfNote,
  onUpdateSelfNote,
  spotFilter,
  onSelectSpotFilter,
  spotSearchQuery,
  onSpotSearch,
  followingCount,
  spaces,
  currentSpaceKey,
  onSelectSpace,
  inVoiceLounge,
  onToggleVoiceLounge,
  onOpenRoom,
  onOpenCommandSearch,
  onCopyInvite,
  isOpen = true,
  onClose,
}: ContextDrawerProps) {
  const [chatSearch, setChatSearch] = useState('');

  const currentSpace = spaces[currentSpaceKey] ?? spaces['design'] ?? Object.values(spaces)[0];

  if (!isOpen) {
    return null;
  }

  return (
    <section
      className="w-76 xl:w-80 h-full bg-oled-sidebar hairline-r flex flex-col justify-between shrink-0 overflow-hidden z-10"
      aria-label="Navigation and Context Drawer"
    >
      {/* ------------------------------------------------------------------- */}
      {/* SIDEBAR A: DIRECT MESSAGES & INSTAGRAM-STYLE NOTES TRAY             */}
      {/* ------------------------------------------------------------------- */}
      {(activeTab === 'dms' || activeTab === 'room') && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Horizon Header (56px) */}
          <div className="h-14 px-5 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-sidebar/80 backdrop-blur-md">
            <h2 className="font-semibold text-base text-white tracking-tight">Messages</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenCommandSearch}
                className="p-2 rounded-full hover:bg-oled-elevated text-ink-secondary hover:text-white transition-colors"
                title="Find Person or New Chat"
                aria-label="Find Person or New Chat"
              >
                <SquarePen size={16} />
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-oled-elevated text-ink-secondary hover:text-white transition-colors md:hidden"
                  title="Close sidebar"
                  aria-label="Close sidebar"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Clean Search Input */}
          <div className="p-3">
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
                <Search size={14} />
              </div>
              <input
                type="text"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder="Search chats..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-oled-surface hairline-border text-xs text-white placeholder-ink-muted focus:outline-none focus:border-white/20 transition-all"
              />
              {chatSearch.trim() && (
                <button
                  type="button"
                  onClick={() => setChatSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-white transition-colors"
                  aria-label="Clear chat search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Instagram-Style Horizontal Notes Tray */}
          <div className="px-4 py-3 hairline-b">
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
              {/* Self Note */}
              <button
                type="button"
                onClick={onUpdateSelfNote}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div className="relative flex flex-col items-center">
                  <div className="px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[10px] text-ink-secondary max-w-[74px] truncate mb-1">
                    {selfNote || 'Note...'}
                  </div>
                  <Avatar
                    src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80"
                    alt="Your note"
                    size="xl"
                  />
                </div>
                <span className="text-[11px] text-ink-secondary">Your note</span>
              </button>

              {/* Aanya Note */}
              <button
                type="button"
                onClick={() => onSelectChat('aanya')}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div className="relative flex flex-col items-center">
                  <div className="px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[10px] text-white mb-1">
                    Fred again.. 🎧
                  </div>
                  <Avatar
                    src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                    alt="Aanya"
                    size="xl"
                    ring="coral"
                  />
                </div>
                <span className="text-[11px] text-white">Aanya</span>
              </button>

              {/* Rohan Note (In Room) */}
              <button
                type="button"
                onClick={onOpenRoom}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div className="relative flex flex-col items-center">
                  <div className="px-2 py-0.5 rounded-full bg-accent-green/15 text-accent-green text-[10px] font-medium mb-1">
                    In room 🎙️
                  </div>
                  <Avatar
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                    alt="Rohan"
                    size="xl"
                    ring="green"
                  />
                </div>
                <span className="text-[11px] text-ink-secondary">Rohan</span>
              </button>

              {/* Meera Note */}
              <button
                type="button"
                onClick={() => onSelectChat('meera')}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div className="relative flex flex-col items-center">
                  <div className="px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[10px] text-white mb-1">
                    iced matcha
                  </div>
                  <Avatar
                    src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
                    alt="Meera"
                    size="xl"
                  />
                </div>
                <span className="text-[11px] text-ink-secondary">Meera</span>
              </button>
            </div>
          </div>

          {/* Direct Messages List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {(() => {
              const matchingKeys = Object.keys(chats).filter((key) => {
                const chat = chats[key];
                if (!chat) return false;
                if (!chatSearch.trim()) return true;
                const q = chatSearch.toLowerCase();
                return chat.name.toLowerCase().includes(q) || chat.subtitle.toLowerCase().includes(q);
              });

              if (matchingKeys.length === 0) {
                return (
                  <div className="p-8 text-center flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-oled-surface hairline-border flex items-center justify-center text-ink-muted mb-2.5">
                      <Search size={16} />
                    </div>
                    <p className="text-xs font-semibold text-white">No chats found</p>
                    <p className="text-[11px] text-ink-secondary mt-1">
                      No conversation matches &ldquo;{chatSearch}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={() => setChatSearch('')}
                      className="mt-3 px-3 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-white transition-colors"
                    >
                      Clear search
                    </button>
                  </div>
                );
              }

              return matchingKeys.map((key) => {
                const chat = chats[key];
                if (!chat) return null;

                const isSelected = activeChatKey === key;
                const last = chat.messages[chat.messages.length - 1];

                return (
                  <div
                    key={key}
                    onClick={() => onSelectChat(key)}
                    className={`relative px-3 py-2.5 rounded-2xl cursor-pointer transition-all flex items-center gap-3 ${
                      isSelected
                        ? 'bg-oled-elevated hairline-border shadow-sm'
                        : 'hover:bg-oled-surface border border-transparent'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent-coral" />
                    )}
                    <Avatar
                      src={chat.avatar}
                      alt={chat.name}
                      size="lg"
                      presence={chat.online ? 'online' : undefined}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white truncate">{chat.name}</span>
                        <span className="font-mono text-[10px] text-ink-muted">
                          {last ? last.time : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p
                          className={`text-xs ${
                            chat.unread ? 'text-white font-medium' : 'text-ink-secondary'
                          } truncate`}
                        >
                          {last ? (last.self ? 'You: ' + last.text : last.text) : ''}
                        </p>
                        {chat.unread > 0 ? (
                          <span className="min-w-4 h-4 px-1 rounded-full bg-accent-coral text-[10px] font-bold text-white flex items-center justify-center shrink-0 ml-2">
                            {chat.unread}
                          </span>
                        ) : (
                          last &&
                          last.self && (
                            <CheckCheck size={14} className="text-ink-secondary shrink-0 ml-1" />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* SIDEBAR B: THE SPOT (SEARCH, FILTERS & TRENDING VIBES)              */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'spot' && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Horizon Header (56px) */}
          <div className="h-14 px-5 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-sidebar/80 backdrop-blur-md">
            <div>
              <h2 className="font-semibold text-base text-white tracking-tight">The Spot</h2>
              <p className="text-[10px] text-ink-secondary">Thoughts, notes & mutual orbit</p>
            </div>
            <button
              type="button"
              onClick={onOpenCommandSearch}
              className="px-2.5 py-1 rounded-lg bg-oled-surface hairline-border font-mono text-[10px] text-ink-secondary hover:text-white transition-colors"
            >
              ⌘K
            </button>
          </div>

          {/* Search Input */}
          <div className="p-3">
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
                <Search size={14} />
              </div>
              <input
                type="text"
                value={spotSearchQuery}
                onChange={(e) => onSpotSearch(e.target.value)}
                placeholder="Search people, @handles, thoughts..."
                className="w-full pl-9 pr-7 py-2 rounded-xl bg-oled-surface hairline-border text-xs text-white placeholder-ink-muted focus:outline-none focus:border-white/25 transition-all"
              />
              {spotSearchQuery && (
                <button
                  type="button"
                  onClick={() => onSpotSearch('')}
                  className="text-ink-muted hover:text-white absolute right-2.5 top-1/2 -translate-y-1/2"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Filter Views */}
          <div className="px-3 space-y-1 pb-4 hairline-b">
            <button
              type="button"
              onClick={() => onSelectSpotFilter('foryou')}
              className={`w-full px-3 py-2 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-all ${
                spotFilter === 'foryou'
                  ? 'bg-white/12 text-white border border-white/20 shadow-sm'
                  : 'text-ink-secondary hover:text-white hover:bg-oled-surface border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Sparkles size={14} /> For You (Calm Graph)
              </span>
              <span className="font-mono text-[10px] opacity-75">Live</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectSpotFilter('following')}
              className={`w-full px-3 py-2 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-all ${
                spotFilter === 'following'
                  ? 'bg-white/12 text-white border border-white/20 shadow-sm'
                  : 'text-ink-secondary hover:text-white hover:bg-oled-surface border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Users size={14} /> Following
              </span>
              <span className="font-mono text-[10px] text-ink-muted">{followingCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectSpotFilter('media')}
              className={`w-full px-3 py-2 rounded-xl text-left text-xs font-medium flex items-center justify-between transition-all ${
                spotFilter === 'media'
                  ? 'bg-white/12 text-white border border-white/20 shadow-sm'
                  : 'text-ink-secondary hover:text-white hover:bg-oled-surface border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <ImageIcon size={14} /> Photos & Moments
              </span>
            </button>
          </div>

          {/* Trending Vibes */}
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div>
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                  Quiet Vibes
                </span>
                <button
                  type="button"
                  onClick={() => onSpotSearch('')}
                  className="text-[10px] text-ink-secondary hover:text-white"
                >
                  All
                </button>
              </div>
              <div className="space-y-1">
                {[
                  { tag: 'late night', title: '🌙 late night', sub: 'Synth jams & coding', count: 14 },
                  { tag: 'film', title: '🎞️ analog film', sub: '35mm scans & cameras', count: 9 },
                  { tag: 'coffee', title: '☕ blr coffee', sub: 'Pour-overs & cafes', count: 11 },
                  { tag: 'building', title: '✨ building', sub: 'Side projects & craft', count: 19 },
                ].map(({ tag, title, sub, count }) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onSpotSearch(tag)}
                    className="w-full px-3 py-2 rounded-xl hover:bg-oled-surface text-left flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <p className="text-xs text-white font-medium">{title}</p>
                      <p className="text-[10px] text-ink-secondary">{sub}</p>
                    </div>
                    <span className="font-mono text-[10px] text-ink-muted group-hover:text-white">
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* SIDEBAR C: SPACES (CHANNELS & COZY VOICE LOUNGE)                    */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'spaces' && currentSpace && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Horizon Header (56px) */}
          <div className="h-14 px-5 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-sidebar/80 backdrop-blur-md">
            <div>
              <h2 className="font-semibold text-base text-white">{currentSpace.name}</h2>
              <p className="text-[10px] text-ink-secondary">{currentSpace.members}</p>
            </div>
            <button
              type="button"
              onClick={onCopyInvite}
              className="px-2.5 py-1 rounded-full bg-oled-elevated hover:bg-neutral-800 text-[11px] text-white hairline-border flex items-center gap-1 transition-colors"
            >
              <LinkIcon size={12} />
              <span>Invite</span>
            </button>
          </div>

          <div className="p-3">
            {/* Space Pills */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectSpace('design')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  currentSpaceKey === 'design'
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-oled-surface text-ink-secondary hover:text-white border border-transparent'
                }`}
              >
                Design Club
              </button>
              <button
                type="button"
                onClick={() => onSelectSpace('late')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  currentSpaceKey === 'late'
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-oled-surface text-ink-secondary hover:text-white border border-transparent'
                }`}
              >
                Late Night Crew
              </button>
            </div>
          </div>

          {/* Channels & Voice Lounge */}
          <div className="flex-1 overflow-y-auto p-3 space-y-6">
            <div>
              <p className="px-2.5 mb-1.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                Channels
              </p>
              <div className="space-y-0.5">
                {currentSpace.channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => onSelectChat(ch.id)}
                    className="w-full px-3 py-2 rounded-xl text-left text-xs text-ink-secondary hover:text-white hover:bg-oled-surface flex items-center justify-between transition-colors"
                  >
                    <span># {ch.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quiet Voice Lounge Card */}
            <div>
              <p className="px-2.5 mb-1.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                Voice Lounge
              </p>
              <div className="p-3 rounded-2xl bg-oled-surface hairline-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
                    <span className="text-xs font-medium text-white">Late Night Lounge</span>
                  </div>
                  <span className="text-[11px] text-ink-secondary">2 here</span>
                </div>

                <div className="space-y-2 pl-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar
                        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                        alt="Aanya"
                        size="xs"
                        ring="green"
                      />
                      <span className="text-xs text-neutral-200">Aanya</span>
                    </div>
                    <Mic size={12} className="text-accent-green" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar
                        src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80"
                        alt="Rohan"
                        size="xs"
                      />
                      <span className="text-xs text-ink-secondary">Rohan</span>
                    </div>
                    <Headphones size={12} className="text-ink-muted" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onToggleVoiceLounge}
                  className="w-full py-2 rounded-xl bg-oled-elevated hover:bg-neutral-800 text-xs font-medium text-white transition-all"
                >
                  {inVoiceLounge ? 'Connected · Leave' : 'Join Lounge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Connected Voice Bar */}
      {inVoiceLounge && (
        <div className="p-3 m-2 rounded-2xl bg-oled-surface hairline-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-ping shrink-0" />
            <div className="truncate">
              <p className="text-xs font-medium text-white truncate">Late Night Lounge</p>
              <p className="text-[10px] text-accent-green">Voice connected</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenRoom}
              className="p-1.5 rounded-lg hover:bg-oled-elevated text-ink-secondary hover:text-white"
              title="Expand Room"
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              onClick={onToggleVoiceLounge}
              className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400"
              title="Leave Voice"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
