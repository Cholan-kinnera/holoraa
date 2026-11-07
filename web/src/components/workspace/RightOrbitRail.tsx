'use client';

import React, { useState } from 'react';
import type { ConversationThread } from '../../lib/data/mock-data';
import type { DirectoryUser } from '../../lib/dsa/search-graph';
import { computeOrbitRecommendations } from '../../lib/dsa/search-graph';
import {
  BellOff,
  Flag,
  Image as ImageIcon,
  Phone,
  Shield,
  Slash,
  Video,
  X,
} from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import { FollowButton } from '../ui/FollowButton';
import type { WorkspaceTab } from './IconRail';

interface RightOrbitRailProps {
  currentUser: DirectoryUser;
  peopleDirectory: Record<string, DirectoryUser>;
  socialGraph: Record<string, Set<string>>;
  currentUserId: string;
  onOpenProfile: (userId: string) => void;
  onOpenRoom: () => void;
  onToggleFollow: (userId: string) => void;
  selfNote: string;
  isOpen?: boolean;
  onClose?: () => void;
  // Contextual Chat Details
  activeTab?: WorkspaceTab;
  activeChat?: ConversationThread;
  onShowNotice?: (msg: string) => void;
  onOpenContactSafety?: () => void;
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
  isOpen = true,
  onClose,
  activeTab = 'dms',
  activeChat,
  onShowNotice,
  onOpenContactSafety,
}: RightOrbitRailProps) {
  const [isMuted, setIsMuted] = useState(false);
  const recommendations = computeOrbitRecommendations(currentUserId, socialGraph, peopleDirectory, 5);
  const followingCount = (socialGraph[currentUserId] || new Set<string>()).size;

  if (!isOpen) {
    return null;
  }

  // Find active chat participant in directory if available
  const chatPartnerId = activeChat?.id && peopleDirectory[activeChat.id] ? activeChat.id : null;
  const chatPartner = chatPartnerId ? peopleDirectory[chatPartnerId] : null;

  // Extract media shared in this conversation
  const sharedMedia = activeChat
    ? activeChat.messages.filter((m) => m.photo).map((m) => m.photo as string)
    : [];

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      onShowNotice?.(next ? `Muted notifications for ${activeChat?.name ?? 'chat'}` : 'Notifications unmuted');
      return next;
    });
  };

  return (
    <aside
      className="w-76 xl:w-80 h-full flex flex-col bg-oled-sidebar hairline-l shrink-0 z-10 transition-all duration-200"
      aria-label="Orbit and Profile Sidebar"
    >
      {/* Horizon Header (56px) */}
      <div className="h-14 px-5 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-sidebar/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-coral" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            {activeTab === 'dms' && activeChat ? 'Conversation Details' : 'Orbit & Profile'}
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-oled-elevated transition-colors"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Contextual Conversation Participant Details (when in DMs) */}
        {activeTab === 'dms' && activeChat && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-oled-surface hairline-border flex flex-col items-center text-center">
              <Avatar
                src={activeChat.avatar}
                alt={activeChat.name}
                size="2xl"
                presence={activeChat.online ? 'online' : undefined}
              />
              <h3 className="text-sm font-semibold text-white mt-3">{activeChat.name}</h3>
              <p className="text-[11px] text-ink-secondary mt-0.5">
                {chatPartner ? chatPartner.handle : activeChat.subtitle}
              </p>
              {chatPartner?.bio && (
                <p className="text-xs text-neutral-300 mt-2 leading-relaxed px-1">
                  {chatPartner.bio}
                </p>
              )}

              {/* Quick Action Pills */}
              <div className="grid grid-cols-4 gap-2 w-full mt-4 pt-3 hairline-t">
                <button
                  type="button"
                  onClick={() => onShowNotice?.(`Calling ${activeChat.name}...`)}
                  className="p-2 rounded-xl bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white flex flex-col items-center gap-1 transition-colors"
                  title="Voice Call"
                >
                  <Phone size={14} />
                  <span className="text-[10px]">Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShowNotice?.(`Starting video with ${activeChat.name}...`)}
                  className="p-2 rounded-xl bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white flex flex-col items-center gap-1 transition-colors"
                  title="Video Call"
                >
                  <Video size={14} />
                  <span className="text-[10px]">Video</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`p-2 rounded-xl flex flex-col items-center gap-1 transition-colors ${
                    isMuted
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white'
                  }`}
                  title={isMuted ? 'Unmute chat' : 'Mute chat'}
                >
                  <BellOff size={14} />
                  <span className="text-[10px]">{isMuted ? 'Muted' : 'Mute'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (chatPartnerId) {
                      onOpenProfile(chatPartnerId);
                    } else {
                      onOpenContactSafety?.();
                    }
                  }}
                  className="p-2 rounded-xl bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white flex flex-col items-center gap-1 transition-colors"
                  title="Profile or Safety"
                >
                  <Shield size={14} />
                  <span className="text-[10px]">Safety</span>
                </button>
              </div>
            </div>

            {/* Shared Media Gallery */}
            <div className="p-4 rounded-2xl bg-oled-surface hairline-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon size={14} className="text-ink-secondary" />
                  <h4 className="text-xs font-semibold text-white">Shared Media</h4>
                </div>
                <span className="font-mono text-[10px] text-ink-muted">
                  {sharedMedia.length} {sharedMedia.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              {sharedMedia.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {sharedMedia.map((photo, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-xl overflow-hidden hairline-border bg-oled-elevated cursor-pointer group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt="Shared media"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted py-2 text-center">
                  No photos or moments shared yet.
                </p>
              )}
            </div>

            {/* Privacy & Safety in this chat */}
            <div className="p-3.5 rounded-2xl bg-oled-surface hairline-border space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-white">
                <Shield size={13} className="text-accent-green" />
                <span>Encrypted & Private</span>
              </div>
              <p className="text-[11px] text-ink-secondary leading-relaxed">
                Messages in this chat are end-to-end encrypted. No tracking telemetry or ad profiling.
              </p>
              <div className="pt-2 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() => onShowNotice?.(`Blocked @${activeChat.name.toLowerCase()}`)}
                  className="flex items-center gap-1 text-ink-secondary hover:text-rose-400 transition-colors"
                >
                  <Slash size={12} />
                  <span>Block user</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShowNotice?.('Report submitted for review')}
                  className="flex items-center gap-1 text-ink-secondary hover:text-white transition-colors"
                >
                  <Flag size={12} />
                  <span>Report</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Social Graph Summary Card (shown in Spot, Spaces, Room tabs, or below DM details) */}
        {activeTab !== 'dms' && (
          <div className="p-4 rounded-2xl bg-oled-surface hairline-border space-y-3.5">
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-3 cursor-pointer group"
                onClick={() => onOpenProfile(currentUserId)}
              >
                <Avatar
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  size="lg"
                />
                <div>
                  <h3 className="text-xs font-semibold text-white group-hover:text-accent-coral transition-colors">
                    {currentUser.name}
                  </h3>
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
        )}

        {/* People in Your Orbit (2-Hop BFS Recommendations) - Always Present for Discovery & Tests */}
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
                  : `${user.handle}`;

              return (
                <div
                  key={user.id}
                  className="p-2.5 rounded-2xl bg-oled-surface hover:bg-oled-elevated hairline-border flex items-center justify-between transition-colors"
                >
                  <div
                    className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                    onClick={() => onOpenProfile(user.id)}
                  >
                    <Avatar
                      src={user.avatar}
                      alt={user.name}
                      size="sm"
                    />
                    <div className="truncate">
                      <p className="text-xs font-medium text-white truncate hover:underline">
                        {user.name}
                      </p>
                      <p className="text-[10px] text-ink-secondary truncate">{subLabel}</p>
                    </div>
                  </div>

                  <FollowButton
                    isFollowing={isFollowing}
                    onToggle={() => onToggleFollow(user.id)}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Calm Privacy Notice */}
        <div className="p-4 rounded-2xl bg-oled-surface hairline-border space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-white">
            <Shield size={14} className="text-accent-green" />
            <span>Zero engagement traps</span>
          </div>
          <p className="text-[11px] text-ink-secondary leading-relaxed">
            Thoughts are ordered by fresh activity and mutual connection strength—never rage-bait or
            paid promotions.
          </p>
        </div>
      </div>
    </aside>
  );
}
