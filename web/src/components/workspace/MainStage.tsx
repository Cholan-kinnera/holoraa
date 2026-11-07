'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { ConversationThread } from '../../lib/data/mock-data';
import type { DirectoryUser, ThoughtRecord } from '../../lib/dsa/search-graph';
import {
  CheckCheck,
  CornerUpLeft,
  Copy,
  DoorOpen,
  Headphones,
  Heart,
  Image as ImageIcon,
  Mic,
  Monitor,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  Plus,
  Search,
  Send,
  Shield,
  Users,
  Video,
  X,
} from '../ui/Icons';
import { Avatar } from '../ui/Avatar';
import type { WorkspaceTab } from './IconRail';

interface MainStageProps {
  activeTab: WorkspaceTab;
  currentChat: ConversationThread;
  activeChatKey: string;
  onSendMessage: (text: string, photo?: string | null) => void;
  onReactMessage: (msgId: string, emoji: string) => void;
  replyDraft: { author: string; text: string } | null;
  onStartReply: (author: string, text: string) => void;
  onClearReply: () => void;
  onOpenUserProfile: (userId: string) => void;
  onOpenContactOptions: () => void;
  // The Spot props
  thoughts: ThoughtRecord[];
  peopleDirectory: Record<string, DirectoryUser>;
  currentUserId: string;
  onPublishThought: (text: string, mood: string, photoUrl: string | null, syncToNote: boolean) => void;
  onToggleLikeThought: (thoughtId: string) => void;
  onBridgeThoughtToDM: (thoughtId: string) => void;
  onToggleFollow: (userId: string) => void;
  isFollowingUser: (userId: string) => boolean;
  onOpenCommandSearch: () => void;
  spotFilter?: 'foryou' | 'following' | 'media';
  onSelectSpotFilter?: (filter: 'foryou' | 'following' | 'media') => void;
  // Personal Room props
  roomKnockActive: boolean;
  onAdmitKnock: () => void;
  onDismissKnock: () => void;
  roomTiles: Array<{ id: string; name: string; avatar: string; isSpeaking: boolean }>;
  roomLocked: boolean;
  onToggleRoomLock: () => void;
  onLeaveRoom: () => void;
  onShowNotice: (msg: string) => void;
  onOpenRoom?: () => void;
  // Shell Proportions & Collapse State
  isRightRailOpen?: boolean;
  onToggleRightRail?: () => void;
  mobilePane?: 'drawer' | 'stage';
  onBackToDrawer?: () => void;
}

export function MainStage({
  activeTab,
  currentChat,
  activeChatKey,
  onSendMessage,
  onReactMessage,
  replyDraft,
  onStartReply,
  onClearReply,
  onOpenUserProfile,
  onOpenContactOptions,
  thoughts,
  peopleDirectory,
  currentUserId,
  onPublishThought,
  onToggleLikeThought,
  onBridgeThoughtToDM,
  onToggleFollow,
  isFollowingUser,
  onOpenCommandSearch,
  spotFilter = 'foryou',
  onSelectSpotFilter,
  roomKnockActive,
  onAdmitKnock,
  onDismissKnock,
  roomTiles,
  roomLocked,
  onToggleRoomLock,
  onLeaveRoom,
  onShowNotice,
  onOpenRoom,
  isRightRailOpen = true,
  onToggleRightRail,
  mobilePane = 'stage',
  onBackToDrawer,
}: MainStageProps) {
  // Chat state
  const [composerText, setComposerText] = useState('');
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Spot composer state
  const [thoughtText, setThoughtText] = useState('');
  const [selectedMood, setSelectedMood] = useState('✨ building');
  const [includePhoto, setIncludePhoto] = useState(false);
  const [syncToNote, setSyncToNote] = useState(true);

  // Call dock toggles
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composerText.trim()) return;
    onSendMessage(composerText.trim());
    setComposerText('');
    onClearReply();
    setShowPlusMenu(false);
  };

  const handleThoughtSubmit = () => {
    if (!thoughtText.trim()) {
      onShowNotice('Write a quick thought first');
      return;
    }
    const samplePhoto = includePhoto
      ? 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80'
      : null;
    onPublishThought(thoughtText.trim(), selectedMood, samplePhoto, syncToNote);
    setThoughtText('');
    setIncludePhoto(false);
  };

  // Group consecutive messages by same author
  const messageGroups = useMemo(() => {
    interface MessageGroup {
      author: string;
      self: boolean;
      messages: typeof currentChat.messages;
    }
    const groups: MessageGroup[] = [];
    for (const msg of currentChat.messages) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.self === msg.self && lastGroup.author === msg.author) {
        lastGroup.messages.push(msg);
      } else {
        groups.push({
          author: msg.author,
          self: msg.self,
          messages: [msg],
        });
      }
    }
    return groups;
  }, [currentChat]);

  return (
    <section
      className="flex-1 min-w-0 h-full bg-oled-black flex flex-col overflow-hidden relative"
      aria-label="Main Workspace Content"
    >
      {/* =================================================================== */}
      {/* STAGE 1: CONVERSATION VIEW (DMS & CHANNELS)                         */}
      {/* =================================================================== */}
      {(activeTab === 'dms' || activeTab === 'spaces') && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Horizon Header (56px) */}
          <header className="h-14 px-5 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-black/85 backdrop-blur-md z-10">
            <div className="flex items-center gap-3 min-w-0">
              {onBackToDrawer && mobilePane === 'stage' && (
                <button
                  type="button"
                  onClick={onBackToDrawer}
                  className="p-1.5 -ml-1 rounded-full text-ink-secondary hover:text-white hover:bg-oled-surface md:hidden"
                  title="Back to conversation list"
                  aria-label="Back to conversation list"
                >
                  <CornerUpLeft size={16} />
                </button>
              )}
              <div
                onClick={() => onOpenUserProfile(activeChatKey)}
                className="flex items-center gap-3 min-w-0 cursor-pointer group"
              >
                <Avatar
                  src={currentChat.avatar}
                  alt={currentChat.name}
                  size="md"
                  presence={currentChat.online ? 'online' : undefined}
                />
                <div className="min-w-0">
                  <h1 className="text-sm font-semibold text-white truncate group-hover:underline">
                    {currentChat.name}
                  </h1>
                  <p className="text-[11px] text-ink-secondary truncate">{currentChat.subtitle}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-ink-secondary">
              <button
                type="button"
                onClick={() => onShowNotice('Starting voice call...')}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="Voice Call"
                aria-label="Start Voice Call"
              >
                <Phone size={16} />
              </button>
              <button
                type="button"
                onClick={() => onShowNotice('Starting video call...')}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="Video Call"
                aria-label="Start Video Call"
              >
                <Video size={16} />
              </button>
              {onToggleRightRail && (
                <button
                  type="button"
                  onClick={onToggleRightRail}
                  className={`p-2 rounded-full transition-colors ${
                    isRightRailOpen
                      ? 'bg-white/12 text-white'
                      : 'hover:bg-oled-surface hover:text-white text-ink-secondary'
                  }`}
                  title={isRightRailOpen ? 'Collapse Orbit Sidebar' : 'Show Orbit Sidebar'}
                  aria-label="Toggle Orbit Sidebar"
                >
                  <Users size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={onOpenContactOptions}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="More Options"
                aria-label="More Options"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </header>

          {/* Centered Conversation Measure Container */}
          <div className="flex-1 overflow-hidden flex flex-col justify-between">
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
              <div className="max-w-3xl mx-auto w-full space-y-4">
                {/* Empty State vs Active History */}
                {currentChat.messages.length === 0 ? (
                  <div className="py-14 px-6 flex flex-col items-center text-center max-w-md mx-auto">
                    <Avatar
                      src={currentChat.avatar}
                      alt={currentChat.name}
                      size="2xl"
                      presence={currentChat.online ? 'online' : undefined}
                    />
                    <h2 className="text-base font-semibold text-white mt-4">{currentChat.name}</h2>
                    <p className="text-xs text-ink-secondary mt-1">{currentChat.subtitle}</p>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-oled-surface hairline-border text-[11px] text-ink-muted mt-3">
                      <Shield size={12} className="text-accent-green" />
                      <span>Encrypted conversation · Zero ad telemetry</span>
                    </div>
                    <p className="text-xs text-neutral-300 mt-6 mb-3">
                      No messages yet. Send an icebreaker to start chatting:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSendMessage('Hey! How is your day going? 👋')}
                        className="px-3.5 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-white transition-colors"
                      >
                        Say hello 👋
                      </button>
                      <button
                        type="button"
                        onClick={() => onSendMessage('Hey, are you free for a coffee catchup soon? ☕')}
                        className="px-3.5 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-white transition-colors"
                      >
                        Coffee catchup ☕
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSendMessage('Come hang out in my room: holoraa.app/arjun');
                          onOpenRoom?.();
                        }}
                        className="px-3.5 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-white transition-colors"
                      >
                        Invite to room 🎙️
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Dignified Conversation Starter Card */}
                    <div className="py-8 flex flex-col items-center text-center border-b hairline-border pb-8 mb-4">
                      <Avatar
                        src={currentChat.avatar}
                        alt={currentChat.name}
                        size="2xl"
                        presence={currentChat.online ? 'online' : undefined}
                      />
                      <h2 className="text-base font-semibold text-white mt-3.5 tracking-tight">
                        {currentChat.name}
                      </h2>
                      <p className="text-xs text-ink-secondary mt-1">{currentChat.subtitle}</p>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-oled-surface hairline-border text-[11px] text-ink-muted mt-3">
                        <Shield size={12} className="text-accent-green" />
                        <span>Quiet, private conversation · Zero ad telemetry</span>
                      </div>
                    </div>

                    <div className="text-center my-3">
                      <span className="text-[11px] text-ink-muted bg-oled-surface px-3 py-1 rounded-full hairline-border">
                        Today
                      </span>
                    </div>

                    {/* Grouped Messages Flow */}
                    <div className="space-y-4">
                      {messageGroups.map((group, groupIdx) => (
                        <div
                          key={`grp_${groupIdx}`}
                          className={`flex flex-col ${group.self ? 'items-end' : 'items-start'} space-y-1`}
                        >
                          {group.messages.map((msg, msgIdx) => {
                            const isFirst = msgIdx === 0;
                            const isLast = msgIdx === group.messages.length - 1;
                            const isSingle = group.messages.length === 1;

                            let radiusClass = '';
                            if (group.self) {
                              if (isSingle) {
                                radiusClass = 'rounded-[20px] rounded-br-[4px]';
                              } else if (isFirst) {
                                radiusClass = 'rounded-[20px] rounded-br-md';
                              } else if (isLast) {
                                radiusClass = 'rounded-[20px] rounded-tr-md rounded-br-[4px]';
                              } else {
                                radiusClass = 'rounded-[20px] rounded-r-md';
                              }
                            } else {
                              if (isSingle) {
                                radiusClass = 'rounded-[20px] rounded-bl-[4px]';
                              } else if (isFirst) {
                                radiusClass = 'rounded-[20px] rounded-bl-md';
                              } else if (isLast) {
                                radiusClass = 'rounded-[20px] rounded-tl-md rounded-bl-[4px]';
                              } else {
                                radiusClass = 'rounded-[20px] rounded-l-md';
                              }
                            }

                            const isVoiceNote = msg.text.includes('Voice note') || msg.text.startsWith('🎙️');
                            const isRoomInvite = msg.text.includes('holoraa.app/arjun');

                            return (
                              <div
                                key={msg.id}
                                className={`group relative flex flex-col ${
                                  group.self ? 'items-end' : 'items-start'
                                }`}
                              >
                                <div
                                  className={`flex items-end gap-2.5 max-w-lg ${
                                    group.self ? 'flex-row-reverse' : ''
                                  }`}
                                >
                                  {/* Avatar or Spacer on received side */}
                                  {!group.self && (
                                    isLast ? (
                                      <Avatar
                                        src={currentChat.avatar}
                                        alt={currentChat.name}
                                        size="sm"
                                      />
                                    ) : (
                                      <div className="w-8 shrink-0" aria-hidden="true" />
                                    )
                                  )}

                                  <div
                                    className={`relative px-4 py-2.5 text-[13px] leading-relaxed shadow-sm ${radiusClass} ${
                                      group.self
                                        ? 'bg-accent-coral text-white'
                                        : 'bg-oled-bubble text-ink-primary hairline-border'
                                    }`}
                                  >
                                    {/* Quoted reply if present */}
                                    {msg.replyTo && (
                                      <div
                                        className={`mb-1.5 pl-2.5 border-l-2 text-[11px] truncate max-w-[240px] ${
                                          group.self
                                            ? 'border-white/50 text-white/80'
                                            : 'border-accent-coral text-ink-secondary'
                                        }`}
                                      >
                                        {msg.replyTo.author}: {msg.replyTo.text}
                                      </div>
                                    )}

                                    {/* Photo preview */}
                                    {msg.photo && (
                                      <div className="relative rounded-[14px] overflow-hidden mb-2 max-w-xs hairline-border">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={msg.photo}
                                          alt="Moment"
                                          className="w-full h-48 object-cover"
                                          loading="lazy"
                                        />
                                      </div>
                                    )}

                                    {/* Rich Voice Note Player */}
                                    {isVoiceNote ? (
                                      <div className="py-1 min-w-[220px]">
                                        <div className="flex items-center gap-2.5">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPlayingVoiceId((prev) => (prev === msg.id ? null : msg.id))
                                            }
                                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                              group.self
                                                ? 'bg-white/20 hover:bg-white/30 text-white'
                                                : 'bg-accent-green/20 hover:bg-accent-green/30 text-accent-green'
                                            }`}
                                            aria-label={
                                              playingVoiceId === msg.id ? 'Pause voice note' : 'Play voice note'
                                            }
                                          >
                                            {playingVoiceId === msg.id ? (
                                              <Pause size={13} />
                                            ) : (
                                              <Play size={13} className="ml-0.5" />
                                            )}
                                          </button>
                                          <div className="flex items-center gap-0.5 flex-1">
                                            {[8, 14, 18, 12, 22, 16, 26, 20, 14, 24, 18, 12, 16, 22, 14, 8].map(
                                              (h, barIdx) => (
                                                <span
                                                  key={barIdx}
                                                  className={`w-1 rounded-full transition-all ${
                                                    playingVoiceId === msg.id && barIdx <= 7
                                                      ? 'bg-white'
                                                      : group.self
                                                      ? 'bg-white/40'
                                                      : 'bg-white/25'
                                                  } ${
                                                    h === 8
                                                      ? 'h-2'
                                                      : h === 12
                                                      ? 'h-3'
                                                      : h === 14
                                                      ? 'h-3.5'
                                                      : h === 16
                                                      ? 'h-4'
                                                      : h === 18
                                                      ? 'h-4.5'
                                                      : h === 20
                                                      ? 'h-5'
                                                      : h === 22
                                                      ? 'h-5.5'
                                                      : h === 24
                                                      ? 'h-6'
                                                      : 'h-6.5'
                                                  }`}
                                                />
                                              )
                                            )}
                                          </div>
                                          <span
                                            className={`font-mono text-[10px] shrink-0 ${
                                              group.self ? 'text-white/80' : 'text-ink-secondary'
                                            }`}
                                          >
                                            0:12
                                          </span>
                                        </div>
                                      </div>
                                    ) : isRoomInvite ? (
                                      /* Rich Room Invite Card */
                                      <div className="p-3 rounded-2xl bg-white/[0.06] border border-white/10 my-1 max-w-sm space-y-2">
                                        <div className="flex items-center gap-2.5">
                                          <div className="w-8 h-8 rounded-xl bg-accent-green/20 text-accent-green flex items-center justify-center shrink-0">
                                            <DoorOpen size={16} />
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-white">Arjun&apos;s Room</p>
                                            <p className="text-[10px] text-ink-secondary truncate">
                                              Live audio & video space
                                            </p>
                                          </div>
                                        </div>
                                        <p className="text-xs text-neutral-300">
                                          Come hang out in my room: holoraa.app/arjun
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => onOpenRoom?.()}
                                          className="w-full py-1.5 rounded-xl bg-accent-coral hover:bg-accent-coral/90 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                        >
                                          <DoorOpen size={13} />
                                          <span>Join Room</span>
                                        </button>
                                      </div>
                                    ) : (
                                      /* Standard Text Message */
                                      <div className="flex items-end justify-between gap-3">
                                        <span>{msg.text}</span>
                                        <span
                                          className={`font-mono text-[10px] shrink-0 flex items-center gap-1 ${
                                            group.self ? 'text-white/75' : 'text-ink-muted'
                                          }`}
                                        >
                                          {msg.time}
                                          {group.self && <CheckCheck size={12} />}
                                        </span>
                                      </div>
                                    )}

                                    {/* Hover Action Pill */}
                                    <div
                                      className={`opacity-0 group-hover:opacity-100 transition-opacity absolute -top-3.5 ${
                                        group.self ? 'left-2' : 'right-2'
                                      } px-2 py-0.5 rounded-full bg-oled-elevated hairline-border shadow-lg flex items-center gap-1.5 text-xs z-10`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => onReactMessage(msg.id, '❤️')}
                                        className="hover:scale-125 transition-transform"
                                        aria-label="React with Heart"
                                      >
                                        ❤️
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onReactMessage(msg.id, '🔥')}
                                        className="hover:scale-125 transition-transform"
                                        aria-label="React with Fire"
                                      >
                                        🔥
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onStartReply(msg.author, msg.text)}
                                        className="text-ink-secondary hover:text-white ml-1"
                                        title="Reply"
                                        aria-label="Reply to message"
                                      >
                                        <CornerUpLeft size={12} />
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* Reactions pill */}
                                {msg.reactions && msg.reactions.length > 0 && (
                                  <div
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[11px] -mt-1.5 z-10 ${
                                      group.self ? 'mr-1' : 'ml-10'
                                    }`}
                                  >
                                    {msg.reactions.map((r, i) => (
                                      <span key={i}>{r}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quoted Reply Bar */}
            {replyDraft && (
              <div className="bg-oled-surface hairline-t py-2 px-4 sm:px-6">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                  <div className="border-l-2 border-accent-coral pl-3 text-xs min-w-0">
                    <p className="font-medium text-white">{replyDraft.author}</p>
                    <p className="text-ink-secondary truncate">{replyDraft.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClearReply}
                    className="p-1 text-ink-secondary hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Centered Composer */}
            <div className="px-4 sm:px-6 py-4 bg-oled-black border-t hairline-border relative">
              <div className="max-w-3xl mx-auto w-full relative">
                {showPlusMenu && (
                  <div className="absolute bottom-16 left-0 w-56 p-1.5 rounded-2xl bg-oled-elevated hairline-border shadow-2xl z-30">
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        onSendMessage(
                          'Studio lighting right now',
                          'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=700&auto=format&fit=crop&q=80'
                        );
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white hover:bg-white/5 transition-colors"
                    >
                      <ImageIcon size={16} className="text-accent-coral" />
                      <span>Photo or Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        onSendMessage('🎙️ Voice note (0:12)  ━━●───────');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white hover:bg-white/5 transition-colors"
                    >
                      <Mic size={16} className="text-accent-green" />
                      <span>Voice Note</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setComposerText('Come hang out in my room: holoraa.app/arjun');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white hover:bg-white/5 transition-colors"
                    >
                      <DoorOpen size={16} className="text-neutral-300" />
                      <span>Invite to My Room</span>
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleChatSubmit}
                  className="flex items-center gap-2.5 bg-oled-surface hairline-border rounded-full px-3 py-2 focus-within:border-white/20 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setShowPlusMenu((prev) => !prev)}
                    className="w-8 h-8 rounded-full bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white flex items-center justify-center shrink-0 transition-colors"
                    title="Add attachment"
                  >
                    <Plus size={16} />
                  </button>

                  <input
                    type="text"
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    autoComplete="off"
                    placeholder={`Message ${currentChat.name}...`}
                    className="flex-1 bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none px-2"
                  />

                  <button
                    type="submit"
                    className="px-4 py-2 rounded-full bg-accent-coral hover:bg-accent-coral/90 text-white text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5 shadow-sm"
                  >
                    <span>Send</span>
                    <Send size={12} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STAGE 2: THE SPOT (THOUGHTS STREAM & CALM ORBIT)                    */}
      {/* =================================================================== */}
      {activeTab === 'spot' && (
        <div className="flex-1 h-full flex flex-col overflow-hidden">
          {/* Horizon Header (56px) */}
          <header className="h-14 px-6 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-black/85 backdrop-blur-md z-10">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-white tracking-tight">The Spot</h1>
              {onSelectSpotFilter && (
                <div className="hidden sm:flex items-center p-0.5 rounded-full bg-oled-surface hairline-border gap-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => onSelectSpotFilter('foryou')}
                    className={`px-3 py-1 rounded-full transition-all ${
                      spotFilter === 'foryou'
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-ink-secondary hover:text-white'
                    }`}
                  >
                    For You
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSpotFilter('following')}
                    className={`px-3 py-1 rounded-full transition-all ${
                      spotFilter === 'following'
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-ink-secondary hover:text-white'
                    }`}
                  >
                    Following
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSpotFilter('media')}
                    className={`px-3 py-1 rounded-full transition-all ${
                      spotFilter === 'media'
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-ink-secondary hover:text-white'
                    }`}
                  >
                    Media
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenCommandSearch}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-ink-secondary hover:text-white transition-colors"
              >
                <Search size={14} />
                <span>Find people</span>
              </button>
              {onToggleRightRail && (
                <button
                  type="button"
                  onClick={onToggleRightRail}
                  className={`p-2 rounded-full transition-colors ${
                    isRightRailOpen
                      ? 'bg-white/12 text-white'
                      : 'hover:bg-oled-surface hover:text-white text-ink-secondary'
                  }`}
                  title={isRightRailOpen ? 'Collapse Orbit Sidebar' : 'Show Orbit Sidebar'}
                >
                  <Users size={16} />
                </button>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.07]">
            {/* Centered Drop a Thought Composer */}
            <div className="p-5 sm:px-8 bg-oled-black">
              <div className="max-w-2xl mx-auto flex items-start gap-4">
                <Avatar
                  src={peopleDirectory[currentUserId]?.avatar}
                  alt="You"
                  size="lg"
                />
                <div className="flex-1 space-y-3">
                  <textarea
                    rows={2}
                    value={thoughtText}
                    onChange={(e) => setThoughtText(e.target.value)}
                    placeholder="Drop a thought, song, or moment..."
                    className="w-full bg-transparent text-sm text-white placeholder-ink-muted focus:outline-none resize-none leading-relaxed"
                  />

                  {includePhoto && (
                    <div className="relative rounded-2xl overflow-hidden max-w-xs hairline-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=700&auto=format&fit=crop&q=80"
                        className="w-full h-40 object-cover"
                        alt="Preview"
                        loading="lazy"
                      />
                      <button
                        type="button"
                        onClick={() => setIncludePhoto(false)}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {['✨ building', '🎧 listening', '☕ blr coffee', '🌙 late night', '🎞️ analog film'].map((mood) => (
                        <button
                          key={mood}
                          type="button"
                          onClick={() => setSelectedMood(mood)}
                          className={`px-3 py-1 rounded-full text-[11px] hairline-border transition-colors ${
                            selectedMood === mood
                              ? 'bg-oled-elevated text-white font-medium'
                              : 'bg-oled-surface text-ink-secondary hover:text-white'
                          }`}
                        >
                          {mood}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setIncludePhoto(!includePhoto)}
                        className="p-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated text-ink-secondary hover:text-white hairline-border transition-colors"
                        title="Attach Photo"
                      >
                        <ImageIcon size={14} />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] text-ink-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={syncToNote}
                          onChange={(e) => setSyncToNote(e.target.checked)}
                          className="w-3.5 h-3.5 accent-white rounded"
                        />
                        <span>Sync to Note</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleThoughtSubmit}
                        className="px-4 py-1.5 rounded-full bg-accent-coral hover:bg-accent-coral/90 text-white text-xs font-semibold transition-all shadow-sm"
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Empty state when stream has no thoughts */}
            {thoughts.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-oled-surface hairline-border flex items-center justify-center text-ink-muted mb-3">
                  <Search size={20} />
                </div>
                <h3 className="text-sm font-semibold text-white">No thoughts found</h3>
                <p className="text-xs text-ink-secondary mt-1">
                  No thoughts match your current view or filter. Drop a note above to start the orbit.
                </p>
                {onSelectSpotFilter && spotFilter !== 'foryou' && (
                  <button
                    type="button"
                    onClick={() => onSelectSpotFilter('foryou')}
                    className="mt-4 px-4 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-white transition-colors"
                  >
                    Switch to For You
                  </button>
                )}
              </div>
            ) : (
              /* Stream of Thoughts */
              thoughts.map((t) => {
                const author = peopleDirectory[t.authorId] ?? {
                  id: t.authorId,
                  name: 'User',
                  handle: `@${t.authorId}`,
                  avatar: '',
                  bio: '',
                  location: '',
                  mood: '',
                  followersCount: 0,
                  followingCount: 0,
                };
                const isFollowing = isFollowingUser(author.id);

                return (
                  <div key={t.id} className="p-5 sm:px-8 hover:bg-oled-surface/30 transition-colors">
                    <div className="max-w-2xl mx-auto flex items-start gap-4">
                      <button
                        type="button"
                        onClick={() => onOpenUserProfile(author.id)}
                        className="shrink-0 focus:outline-none"
                      >
                        <Avatar
                          src={author.avatar}
                          alt={author.name}
                          size="md"
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenUserProfile(author.id)}
                              className="text-xs font-semibold text-white hover:underline truncate"
                            >
                              {author.name}
                            </button>
                            <span className="text-[11px] text-ink-secondary truncate">
                              {author.handle}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-oled-surface hairline-border text-[10px] text-neutral-300 shrink-0">
                              {t.mood}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-ink-muted shrink-0">
                            {t.timeLabel}
                          </span>
                        </div>

                        <p className="text-sm text-neutral-200 mt-2 leading-relaxed">{t.text}</p>

                        {t.photo && (
                          <div className="mt-3 rounded-[18px] overflow-hidden hairline-border max-w-lg aspect-[4/3] sm:aspect-[16/9] bg-oled-elevated group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={t.photo}
                              alt="Moment"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-3.5 pt-1 text-xs text-ink-secondary">
                          <div className="flex items-center gap-4">
                            <button
                              type="button"
                              onClick={() => onToggleLikeThought(t.id)}
                              className={`flex items-center gap-1.5 transition-colors ${
                                t.likedByMe ? 'text-rose-400 font-semibold' : 'hover:text-white'
                              }`}
                            >
                              <Heart
                                size={14}
                                className={t.likedByMe ? 'fill-rose-400 text-rose-400' : ''}
                              />
                              <span>{t.likes}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onBridgeThoughtToDM(t.id)}
                              className="btn-reply-dm"
                              title="Reply in 1-on-1 private Direct Messages"
                            >
                              <span>Reply in DM →</span>
                            </button>
                          </div>

                          {author.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => onToggleFollow(author.id)}
                              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                                isFollowing
                                  ? 'bg-oled-surface text-ink-secondary hover:text-white hairline-border'
                                  : 'bg-accent-coral/15 text-accent-coral font-medium hover:bg-accent-coral/25'
                              }`}
                            >
                              {isFollowing ? 'Following' : '+ Follow'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STAGE 3: MY PERSONAL ROOM (KNOCK WAITING ROOM & LIVE STAGE)        */}
      {/* =================================================================== */}
      {activeTab === 'room' && (
        <div className="flex-1 flex flex-col h-full bg-oled-black justify-between relative overflow-hidden">
          {/* Horizon Header (56px) */}
          <header className="h-14 px-6 border-b hairline-border flex items-center justify-between shrink-0 bg-oled-black/85 backdrop-blur-md z-10">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-sm text-white">Arjun&apos;s Room</h2>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText('https://holoraa.app/arjun');
                  onShowNotice('Room link copied to clipboard');
                }}
                className="px-3 py-1 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-ink-secondary hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <span>holoraa.app/arjun</span>
                <Copy size={12} />
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleRoomLock}
                className="px-3.5 py-1.5 rounded-full bg-oled-surface hairline-border text-xs text-white flex items-center gap-2 transition-colors"
              >
                <Shield size={14} className={roomLocked ? 'text-rose-400' : 'text-accent-green'} />
                <span>{roomLocked ? 'Room locked' : 'Waiting room on'}</span>
              </button>
              {onToggleRightRail && (
                <button
                  type="button"
                  onClick={onToggleRightRail}
                  className={`p-2 rounded-full transition-colors ${
                    isRightRailOpen
                      ? 'bg-white/12 text-white'
                      : 'hover:bg-oled-surface hover:text-white text-ink-secondary'
                  }`}
                  title={isRightRailOpen ? 'Collapse Orbit Sidebar' : 'Show Orbit Sidebar'}
                >
                  <Users size={16} />
                </button>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-between">
            {/* Floating Glassmorphic Knock Notification */}
            {roomKnockActive && (
              <div className="my-2 mx-auto max-w-md w-full p-4 rounded-2xl bg-oled-elevated/95 backdrop-blur-xl hairline-border shadow-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Avatar
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                    alt="Rohan"
                    size="md"
                    presence="knock"
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">Rohan wants to join</p>
                    <p className="text-[11px] text-ink-secondary">Waiting in lobby</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onAdmitKnock}
                    className="px-3.5 py-1.5 rounded-full bg-accent-coral hover:bg-accent-coral/90 text-white text-xs font-semibold transition-colors shadow-sm"
                  >
                    Let in
                  </button>
                  <button
                    type="button"
                    onClick={onDismissKnock}
                    className="p-1.5 rounded-full text-ink-secondary hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Audio / Video Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 my-auto py-4 max-w-4xl w-full mx-auto">
              {roomTiles.map((tile) => (
                <div
                  key={tile.id}
                  className={`aspect-video rounded-[24px] bg-oled-surface hairline-border flex flex-col items-center justify-center relative p-6 ${
                    tile.isSpeaking ? 'voice-active-ring' : ''
                  }`}
                >
                  <Avatar
                    src={tile.avatar}
                    alt={tile.name}
                    size="2xl"
                    ring={tile.isSpeaking ? 'green' : undefined}
                  />
                  <span className="mt-3 text-xs font-medium text-white">{tile.name}</span>
                  <span className="absolute bottom-3.5 left-4 text-[11px] text-accent-green flex items-center gap-1">
                    {tile.isSpeaking ? (
                      <>
                        <Mic size={12} /> Speaking
                      </>
                    ) : (
                      <>
                        <Headphones size={12} /> Listening
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Call Controls Dock */}
            <div className="mx-auto px-4 py-2.5 rounded-full bg-oled-surface hairline-border flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMicMuted(!micMuted)}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  micMuted ? 'bg-rose-500/20 text-rose-400' : 'bg-oled-elevated text-white hover:bg-neutral-800'
                }`}
                title="Mute / Unmute"
              >
                <Mic size={16} />
              </button>
              <button
                type="button"
                onClick={() => setCameraOn(!cameraOn)}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  cameraOn ? 'bg-white/20 text-white border border-white/30' : 'bg-oled-elevated text-white hover:bg-neutral-800'
                }`}
                title="Camera"
              >
                <Video size={16} />
              </button>
              <button
                type="button"
                onClick={() => onShowNotice('Sharing your screen')}
                className="w-10 h-10 rounded-full bg-oled-elevated hover:bg-neutral-800 text-white flex items-center justify-center transition-colors"
                title="Share Screen"
              >
                <Monitor size={16} />
              </button>
              <button
                type="button"
                onClick={onLeaveRoom}
                className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
