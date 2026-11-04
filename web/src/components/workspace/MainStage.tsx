'use client';

import React, { useRef, useState } from 'react';
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
  Phone,
  Plus,
  Search,
  Send,
  Shield,
  Video,
  X,
} from '../ui/Icons';
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
  // Personal Room props
  roomKnockActive: boolean;
  onAdmitKnock: () => void;
  onDismissKnock: () => void;
  roomTiles: Array<{ id: string; name: string; avatar: string; isSpeaking: boolean }>;
  roomLocked: boolean;
  onToggleRoomLock: () => void;
  onLeaveRoom: () => void;
  onShowNotice: (msg: string) => void;
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
  roomKnockActive,
  onAdmitKnock,
  onDismissKnock,
  roomTiles,
  roomLocked,
  onToggleRoomLock,
  onLeaveRoom,
  onShowNotice,
}: MainStageProps) {
  // Chat state
  const [composerText, setComposerText] = useState('');
  const [showPlusMenu, setShowPlusMenu] = useState(false);

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

  return (
    <section className="flex-1 h-full bg-oled-black flex flex-col overflow-hidden relative">
      {/* =================================================================== */}
      {/* STAGE 1: CONVERSATION VIEW (DMS & CHANNELS)                         */}
      {/* =================================================================== */}
      {(activeTab === 'dms' || activeTab === 'spaces') && (
        <div className="flex-1 flex flex-col h-full">
          {/* Header */}
          <header className="h-14 px-6 hairline-b flex items-center justify-between shrink-0 bg-oled-black/80 backdrop-blur-md z-10">
            <div
              onClick={() => onOpenUserProfile(activeChatKey)}
              className="flex items-center gap-3 min-w-0 cursor-pointer group"
            >
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentChat.avatar}
                  alt={currentChat.name}
                  className="w-9 h-9 rounded-full object-cover group-hover:opacity-90 transition-opacity"
                />
                {currentChat.online && (
                  <span className="w-2.5 h-2.5 rounded-full bg-accent-green ring-2 ring-black absolute bottom-0 right-0" />
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-medium text-white truncate group-hover:underline">
                  {currentChat.name}
                </h1>
                <p className="text-[11px] text-ink-secondary truncate">{currentChat.subtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-ink-secondary">
              <button
                type="button"
                onClick={() => onShowNotice('Starting voice call...')}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="Voice Call"
              >
                <Phone size={16} />
              </button>
              <button
                type="button"
                onClick={() => onShowNotice('Starting video call...')}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="Video Call"
              >
                <Video size={16} />
              </button>
              <button
                type="button"
                onClick={onOpenContactOptions}
                className="p-2 rounded-full hover:bg-oled-surface hover:text-white transition-colors"
                title="More Options"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </header>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6 space-y-3">
            <div className="text-center my-2">
              <span className="text-[11px] text-ink-muted">Today</span>
            </div>

            <div className="space-y-2.5">
              {currentChat.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`group flex flex-col ${msg.self ? 'items-end' : 'items-start'}`}
                >
                  <div className={`flex items-end gap-2 max-w-md ${msg.self ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`relative px-4 py-2.5 rounded-[18px] text-[13px] leading-relaxed ${
                        msg.self
                          ? 'bg-accent-coral text-white rounded-br-[4px] shadow-md'
                          : 'bg-oled-bubble text-ink-primary hairline-border rounded-bl-[4px] shadow-sm'
                      }`}
                    >
                      {msg.replyTo && (
                        <div
                          className={`mb-1.5 pl-2.5 border-l-2 text-[11px] truncate max-w-[240px] ${
                            msg.self
                              ? 'border-white/50 text-white/80'
                              : 'border-accent-coral text-ink-secondary'
                          }`}
                        >
                          {msg.replyTo.author}: {msg.replyTo.text}
                        </div>
                      )}

                      {msg.photo && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={msg.photo}
                          alt="Moment"
                          className="w-full max-w-xs h-48 object-cover rounded-[14px] mb-1.5"
                        />
                      )}

                      <div className="flex items-end justify-between gap-3">
                        <span>{msg.text}</span>
                        <span
                          className={`font-mono text-[10px] shrink-0 flex items-center gap-1 ${
                            msg.self ? 'text-white/75' : 'text-ink-muted'
                          }`}
                        >
                          {msg.time}
                          {msg.self && <CheckCheck size={12} />}
                        </span>
                      </div>

                      {/* Hover Action Pill */}
                      <div
                        className={`opacity-0 group-hover:opacity-100 transition-opacity absolute -top-3.5 ${
                          msg.self ? 'left-2' : 'right-2'
                        } px-2 py-0.5 rounded-full bg-oled-elevated hairline-border shadow-lg flex items-center gap-1.5 text-xs z-10`}
                      >
                        <button
                          type="button"
                          onClick={() => onReactMessage(msg.id, '❤️')}
                          className="hover:scale-125 transition-transform"
                        >
                          ❤️
                        </button>
                        <button
                          type="button"
                          onClick={() => onReactMessage(msg.id, '🔥')}
                          className="hover:scale-125 transition-transform"
                        >
                          🔥
                        </button>
                        <button
                          type="button"
                          onClick={() => onStartReply(msg.author, msg.text)}
                          className="text-ink-secondary hover:text-white ml-1"
                          title="Reply"
                        >
                          <CornerUpLeft size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-oled-elevated hairline-border text-[11px] -mt-1.5 z-10">
                      {msg.reactions.map((r, i) => (
                        <span key={i}>{r}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Quoted Reply Bar */}
          {replyDraft && (
            <div className="px-6 py-2.5 bg-oled-surface hairline-t flex items-center justify-between">
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
          )}

          {/* Composer */}
          <div className="px-5 py-4 bg-oled-black relative">
            {showPlusMenu && (
              <div className="absolute bottom-20 left-6 w-52 p-1.5 rounded-2xl bg-oled-elevated hairline-border shadow-2xl z-30">
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
              className="flex items-center gap-2.5 bg-oled-surface hairline-border rounded-full px-2.5 py-1.5 focus-within:border-white/20 transition-colors"
            >
              <button
                type="button"
                onClick={() => setShowPlusMenu(!showPlusMenu)}
                className="w-8 h-8 rounded-full bg-oled-elevated hover:bg-neutral-800 text-ink-secondary hover:text-white flex items-center justify-center shrink-0 transition-colors"
                title="Add"
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
                className="px-3.5 py-1.5 rounded-full bg-white text-black hover:bg-neutral-200 text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5"
              >
                <span>Send</span>
                <Send size={12} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STAGE 2: THE SPOT (THOUGHTS STREAM & CALM ORBIT)                    */}
      {/* =================================================================== */}
      {activeTab === 'spot' && (
        <div className="flex-1 h-full flex flex-col overflow-hidden">
          {/* Top Spot Header */}
          <header className="h-14 px-6 hairline-b flex items-center justify-between shrink-0 bg-oled-black/80 backdrop-blur-md">
            <h1 className="text-sm font-medium text-white">The Spot · Calm Stream</h1>
            <button
              type="button"
              onClick={onOpenCommandSearch}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-ink-secondary hover:text-white transition-colors"
            >
              <Search size={14} />
              <span>Find people</span>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.07]">
            {/* Drop a Thought Composer */}
            <div className="p-5 sm:px-7 bg-oled-black">
              <div className="flex items-start gap-3.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={peopleDirectory[currentUserId]?.avatar}
                  alt="You"
                  className="w-10 h-10 rounded-full object-cover mt-0.5 shrink-0"
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
                      {['✨ building', '🎧 listening', '☕ blr coffee', '🌙 late night'].map((mood) => (
                        <button
                          key={mood}
                          type="button"
                          onClick={() => setSelectedMood(mood)}
                          className={`px-2.5 py-1 rounded-full text-[11px] hairline-border transition-colors ${
                            selectedMood === mood
                              ? 'bg-oled-elevated text-white'
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
                        className="px-4 py-1.5 rounded-full bg-white text-black hover:bg-neutral-200 text-xs font-medium transition-all"
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Thoughts Stream List */}
            {thoughts.map((t) => {
              const author =
                peopleDirectory[t.authorId] ??
                peopleDirectory['aanya'] ??
                Object.values(peopleDirectory)[0];
              if (!author) return null;
              const isFollowing = isFollowingUser(author.id);

              return (
                <div key={t.id} className="p-5 sm:px-7 hover:bg-oled-sidebar/40 transition-colors">
                  <div className="flex items-start gap-3.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      onClick={() => onOpenUserProfile(author.id)}
                      src={author.avatar}
                      alt={author.name}
                      className="w-10 h-10 rounded-full object-cover cursor-pointer shrink-0 mt-0.5 hover:opacity-90"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span
                            onClick={() => onOpenUserProfile(author.id)}
                            className="text-xs font-semibold text-white hover:underline cursor-pointer"
                          >
                            {author.name}
                          </span>
                          <span className="text-xs text-ink-secondary">{author.handle}</span>
                          <span className="px-2 py-0.5 rounded-full bg-oled-surface hairline-border text-[10px] text-neutral-300">
                            {t.mood}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-ink-muted shrink-0">
                          {t.timeLabel}
                        </span>
                      </div>

                      <p className="text-[13.5px] text-ink-primary leading-relaxed">{t.text}</p>

                      {t.photo && (
                        <div className="pt-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={t.photo}
                            alt="Thought attachment"
                            className="rounded-2xl max-h-72 w-auto object-cover hairline-border"
                          />
                        </div>
                      )}

                      <div className="pt-2 flex items-center gap-6 text-xs text-ink-secondary">
                        <button
                          type="button"
                          onClick={() => onToggleLikeThought(t.id)}
                          className={`flex items-center gap-1.5 transition-colors ${
                            t.likedByMe ? 'text-accent-coral font-medium' : 'hover:text-white'
                          }`}
                        >
                          <Heart
                            size={14}
                            fill={t.likedByMe ? '#E86C4F' : 'none'}
                            className={t.likedByMe ? 'text-accent-coral' : ''}
                          />
                          <span className="font-mono text-[11px]">{t.likes}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onBridgeThoughtToDM(t.id)}
                          className="flex items-center gap-1.5 hover:text-white transition-colors"
                          title="Reply in 1-on-1 private Direct Messages"
                        >
                          <Send size={14} />
                          <span>Reply in DM</span>
                        </button>

                        {author.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => onToggleFollow(author.id)}
                            className={`ml-auto text-[11px] ${
                              isFollowing
                                ? 'text-ink-secondary hover:text-white'
                                : 'text-accent-coral font-medium hover:underline'
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
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STAGE 3: MY PERSONAL ROOM (KNOCK WAITING ROOM & LIVE STAGE)        */}
      {/* =================================================================== */}
      {activeTab === 'room' && (
        <div className="flex-1 flex flex-col h-full bg-oled-black p-6 justify-between relative overflow-y-auto">
          {/* Top Room Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-lg text-white">Arjun&apos;s Room</h2>
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
            </div>
          </div>

          {/* Floating Glassmorphic Knock Notification */}
          {roomKnockActive && (
            <div className="my-4 mx-auto max-w-md w-full p-4 rounded-2xl bg-oled-elevated/95 backdrop-blur-xl hairline-border shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                  className="w-10 h-10 rounded-full object-cover"
                  alt="Rohan"
                />
                <div>
                  <p className="text-xs font-medium text-white">Rohan wants to join your room</p>
                  <p className="text-[11px] text-ink-secondary">Knocking via your room link</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onAdmitKnock}
                  className="px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-colors"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 my-auto py-4 max-w-5xl w-full mx-auto">
            {roomTiles.map((tile) => (
              <div
                key={tile.id}
                className={`aspect-video rounded-[24px] bg-oled-surface hairline-border flex flex-col items-center justify-center relative p-6 ${
                  tile.isSpeaking ? 'voice-active-ring' : ''
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tile.avatar}
                  className="w-20 h-20 rounded-full object-cover"
                  alt={tile.name}
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
                cameraOn ? 'bg-white text-black' : 'bg-oled-elevated text-white hover:bg-neutral-800'
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
      )}
    </section>
  );
}
