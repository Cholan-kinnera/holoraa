'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  INITIAL_CHATS,
  INITIAL_PEOPLE_DIRECTORY,
  INITIAL_SOCIAL_GRAPH,
  INITIAL_SPACES,
  INITIAL_THOUGHTS,
  type ChatMessage,
  type ConversationThread,
  type SpaceData,
} from '../lib/data/mock-data';
import type { DirectoryUser, ThoughtRecord } from '../lib/dsa/search-graph';
import { rankThoughts } from '../lib/dsa/search-graph';
import { FloatingNavbar } from './landing/FloatingNavbar';
import { Hero3DStage } from './landing/Hero3DStage';
import { LiveSearchPlayground } from './landing/LiveSearchPlayground';
import { StoryBentoGrid } from './landing/StoryBentoGrid';
import { CommandPaletteModal } from './modals/CommandPaletteModal';
import { ContactSafetyModal } from './modals/ContactSafetyModal';
import { ProfileDrawerModal } from './modals/ProfileDrawerModal';
import { SettingsModal } from './modals/SettingsModal';
import { ContextDrawer } from './workspace/ContextDrawer';
import { IconRail, type WorkspaceTab } from './workspace/IconRail';
import { MainStage } from './workspace/MainStage';
import { RightOrbitRail } from './workspace/RightOrbitRail';

export function HoloraaApp() {
  // Current view mode: landing page vs interactive 4-column web app
  const [currentView, setCurrentView] = useState<'landing' | 'app'>('landing');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dms');

  // Application data states
  const [chats, setChats] = useState<Record<string, ConversationThread>>(INITIAL_CHATS);
  const [activeChatKey, setActiveChatKey] = useState<string>('aanya');
  const [thoughts, setThoughts] = useState<ThoughtRecord[]>(INITIAL_THOUGHTS);
  const [people, setPeople] = useState<Record<string, DirectoryUser>>(INITIAL_PEOPLE_DIRECTORY);
  const [socialGraph, setSocialGraph] = useState<Record<string, Set<string>>>(INITIAL_SOCIAL_GRAPH);
  const [spaces] = useState<Record<string, SpaceData>>(INITIAL_SPACES);
  const [currentSpaceKey, setCurrentSpaceKey] = useState<string>('design');
  const [selfNote, setSelfNote] = useState<string>('✨ building');

  // Reply Draft State
  const [replyDraft, setReplyDraft] = useState<{ author: string; text: string } | null>(null);

  // Filters & Toggles
  const [spotFilter, setSpotFilter] = useState<'foryou' | 'following' | 'media'>('foryou');
  const [spotSearchQuery, setSpotSearchQuery] = useState<string>('');
  const [inVoiceLounge, setInVoiceLounge] = useState<boolean>(false);

  // Room state
  const [roomKnockActive, setRoomKnockActive] = useState<boolean>(true);
  const [roomLocked, setRoomLocked] = useState<boolean>(false);
  const [roomTiles, setRoomTiles] = useState<Array<{ id: string; name: string; avatar: string; isSpeaking: boolean }>>([
    {
      id: 'arjun',
      name: 'Arjun Mehta (Host)',
      avatar: INITIAL_PEOPLE_DIRECTORY['arjun']?.avatar ?? '',
      isSpeaking: false,
    },
    {
      id: 'rohan',
      name: 'Rohan Verma',
      avatar: INITIAL_PEOPLE_DIRECTORY['rohan']?.avatar ?? '',
      isSpeaking: true,
    },
    {
      id: 'kabir',
      name: 'Kabir Menon',
      avatar: INITIAL_PEOPLE_DIRECTORY['kabir']?.avatar ?? '',
      isSpeaking: false,
    },
  ]);

  // Modals state
  const [userProfileModalId, setUserProfileModalId] = useState<string | null>(null);
  const [isCommandSearchOpen, setIsCommandSearchOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isContactSafetyOpen, setIsContactSafetyOpen] = useState<boolean>(false);

  // Floating pill notice
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const currentUser = people['arjun'] ?? INITIAL_PEOPLE_DIRECTORY['arjun']!;
  const currentChat = chats[activeChatKey] ?? chats['aanya'] ?? Object.values(chats)[0]!;

  // Derived: Current following count
  const myFollowing = socialGraph['arjun'] ?? new Set<string>();
  const followingCount = myFollowing.size;

  // Derived: Ranked thoughts for The Spot
  const rankedThoughts = useMemo(() => {
    let pool = rankThoughts(thoughts, 'arjun', socialGraph, spotFilter);
    if (spotSearchQuery.trim()) {
      const q = spotSearchQuery.toLowerCase();
      pool = pool.filter((t) => {
        const author = people[t.authorId];
        return (
          t.text.toLowerCase().includes(q) ||
          t.mood.toLowerCase().includes(q) ||
          (author && (author.name.toLowerCase().includes(q) || author.handle.toLowerCase().includes(q)))
        );
      });
    }
    return pool;
  }, [thoughts, socialGraph, spotFilter, spotSearchQuery, people]);

  // Navigation handlers
  const handleEnterApp = useCallback((initialTab: string = 'dms') => {
    const validTabs: WorkspaceTab[] = ['dms', 'spot', 'spaces', 'room'];
    const tab: WorkspaceTab = validTabs.includes(initialTab as WorkspaceTab)
      ? (initialTab as WorkspaceTab)
      : 'dms';
    setActiveTab(tab);
    setCurrentView('app');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleReturnToLanding = useCallback(() => {
    setCurrentView('landing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Follow / Unfollow toggle
  const handleToggleFollow = useCallback(
    (targetUserId: string) => {
      setSocialGraph((prev) => {
        const next = { ...prev };
        const myFollows = new Set(next['arjun'] ?? []);
        const targetUser = people[targetUserId];
        const targetName = targetUser ? targetUser.name.split(' ')[0] : 'user';

        if (myFollows.has(targetUserId)) {
          myFollows.delete(targetUserId);
          showNotice(`Unfollowed ${targetName}`);
        } else {
          myFollows.add(targetUserId);
          showNotice(`Now following ${targetName}`);
        }
        next['arjun'] = myFollows;
        return next;
      });
    },
    [people, showNotice]
  );

  // Like Thought toggle
  const handleToggleLikeThought = useCallback(
    (thoughtId: string) => {
      setThoughts((prev) =>
        prev.map((t) => {
          if (t.id === thoughtId) {
            const nextLiked = !t.likedByMe;
            return {
              ...t,
              likedByMe: nextLiked,
              likes: nextLiked ? t.likes + 1 : Math.max(0, t.likes - 1),
            };
          }
          return t;
        })
      );
    },
    []
  );

  // Create Thought
  const handlePublishThought = useCallback(
    (text: string, mood: string, photoUrl: string | null, syncToNote: boolean) => {
      const newThought: ThoughtRecord = {
        id: `th_${Date.now()}`,
        authorId: 'arjun',
        mood: mood || '✨ building',
        timeLabel: 'just now',
        hoursAgo: 0,
        text,
        photo: photoUrl,
        likes: 0,
        likedByMe: false,
        replies: 0,
      };
      setThoughts((prev) => [newThought, ...prev]);

      if (syncToNote) {
        setSelfNote(mood || '✨ building');
        setPeople((prev) => {
          const arjun = prev['arjun'];
          if (!arjun) return prev;
          return {
            ...prev,
            arjun: { ...arjun, note: mood || '✨ building' },
          };
        });
      }

      showNotice('Thought dropped to The Spot');
    },
    [showNotice]
  );

  // Send Message in active chat
  const handleSendMessage = useCallback(
    (text: string, photo?: string | null) => {
      const newMsg: ChatMessage = {
        id: `m_${Date.now()}`,
        author: 'You',
        self: true,
        text,
        photo: photo ?? null,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        replyTo: replyDraft ? { author: replyDraft.author, text: replyDraft.text } : null,
        reactions: [],
      };

      setChats((prev) => {
        const current = prev[activeChatKey];
        if (!current) return prev;
        return {
          ...prev,
          [activeChatKey]: {
            ...current,
            messages: [...current.messages, newMsg],
          },
        };
      });
      setReplyDraft(null);
    },
    [activeChatKey, replyDraft]
  );

  // React to Message
  const handleReactMessage = useCallback((msgId: string, emoji: string) => {
    setChats((prev) => {
      const next = { ...prev };
      for (const [key, thread] of Object.entries(next)) {
        const msgIdx = thread.messages.findIndex((m) => m.id === msgId);
        if (msgIdx !== -1) {
          const msg = thread.messages[msgIdx]!;
          const hasEmoji = msg.reactions.includes(emoji);
          const updatedReactions = hasEmoji
            ? msg.reactions.filter((e) => e !== emoji)
            : [...msg.reactions, emoji];
          const updatedMessages = [...thread.messages];
          updatedMessages[msgIdx] = { ...msg, reactions: updatedReactions };
          next[key] = { ...thread, messages: updatedMessages };
          break;
        }
      }
      return next;
    });
  }, []);

  // Bridge Thought into private 1-on-1 DM
  const handleBridgeThoughtToDM = useCallback(
    (thoughtId: string) => {
      const thought = thoughts.find((t) => t.id === thoughtId);
      if (!thought) return;
      const authorId = thought.authorId;
      if (authorId === 'arjun') {
        showNotice('This is your own thought');
        return;
      }

      setActiveChatKey(authorId);
      setActiveTab('dms');
      setCurrentView('app');
      setReplyDraft({
        author: people[authorId]?.name ?? 'Author',
        text: `Thought: "${thought.text.slice(0, 60)}..."`,
      });
      showNotice(`Opened direct message with ${people[authorId]?.name ?? 'author'}`);
    },
    [thoughts, people, showNotice]
  );

  // Open Direct Chat from Search or Profile
  const handleOpenDirectChat = useCallback(
    (userId: string) => {
      if (userId === 'arjun') {
        showNotice('This is your own profile');
        return;
      }
      setActiveChatKey(userId);
      setActiveTab('dms');
      setCurrentView('app');
      setUserProfileModalId(null);
      setIsCommandSearchOpen(false);
    },
    [showNotice]
  );

  // Update self note
  const handleUpdateSelfNote = useCallback(() => {
    const updated = prompt('Update your 24h note (e.g. "reading dune", "🎧 fred again")', selfNote);
    if (updated !== null && updated.trim()) {
      setSelfNote(updated.trim());
      setPeople((prev) => {
        const arjun = prev['arjun'];
        if (!arjun) return prev;
        return {
          ...prev,
          arjun: { ...arjun, note: updated.trim() },
        };
      });
      showNotice('Note updated for 24 hours');
    }
  }, [selfNote, showNotice]);

  // Copy space invite link
  const handleCopyInvite = useCallback(() => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(`https://holoraa.app/join/${currentSpaceKey}`);
    }
    showNotice('Invite link copied to clipboard');
  }, [currentSpaceKey, showNotice]);

  return (
    <div className="min-h-screen bg-oled-black text-ink-primary font-sans antialiased selection:bg-accent-coral/20 selection:text-white">
      {/* =================================================================== */}
      {/* VIEW A: LANDING PAGE                                               */}
      {/* =================================================================== */}
      {currentView === 'landing' ? (
        <div className="flex flex-col min-h-screen animate-in fade-in duration-300">
          <FloatingNavbar
            onEnterApp={handleEnterApp}
            onOpenSearch={() => setIsCommandSearchOpen(true)}
          />

          <main id="main" className="flex-1">
            <Hero3DStage onEnterApp={handleEnterApp} />

            <LiveSearchPlayground
              peopleDirectory={people}
              socialGraph={socialGraph}
              currentUserId="arjun"
              onSelectUser={(userId) => setUserProfileModalId(userId)}
              onToggleFollow={handleToggleFollow}
            />

            <StoryBentoGrid onEnterApp={handleEnterApp} />
          </main>

          <footer className="py-12 border-t hairline-border bg-oled-black text-center text-xs text-ink-muted">
            <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-white tracking-wider">holoraa</span>
                <span>·</span>
                <span>One quiet place for the people who matter.</span>
              </div>
              <div className="flex items-center gap-6 text-ink-secondary">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="hover:text-white transition-colors"
                >
                  Privacy
                </button>
                <a href="/status" className="hover:text-white transition-colors">
                  System Status
                </a>
                <a href="/prototype.html" className="hover:text-white transition-colors">
                  Original Prototype
                </a>
              </div>
            </div>
          </footer>
        </div>
      ) : (
        /* =================================================================== */
        /* VIEW B: 4-COLUMN WORKSPACE                                          */
        /* =================================================================== */
        <div className="flex h-screen w-screen overflow-hidden bg-oled-black animate-in fade-in duration-300">
          {/* Column 1: Icon Rail */}
          <IconRail
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onReturnToLanding={handleReturnToLanding}
            onOpenSearch={() => setIsCommandSearchOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenProfile={() => setUserProfileModalId('arjun')}
            currentUserId="arjun"
            hasUnread={true}
            hasKnock={roomKnockActive}
            avatarUrl={currentUser.avatar}
          />

          {/* Column 2: Context Drawer */}
          <ContextDrawer
            activeTab={activeTab}
            chats={chats}
            activeChatKey={activeChatKey}
            onSelectChat={setActiveChatKey}
            selfNote={selfNote}
            onUpdateSelfNote={handleUpdateSelfNote}
            spotFilter={spotFilter}
            onSelectSpotFilter={setSpotFilter}
            spotSearchQuery={spotSearchQuery}
            onSpotSearch={setSpotSearchQuery}
            followingCount={followingCount}
            spaces={spaces}
            currentSpaceKey={currentSpaceKey}
            onSelectSpace={setCurrentSpaceKey}
            inVoiceLounge={inVoiceLounge}
            onToggleVoiceLounge={() => {
              setInVoiceLounge((prev) => !prev);
              showNotice(!inVoiceLounge ? 'Joined Late Night Lounge' : 'Left voice lounge');
            }}
            onOpenRoom={() => setActiveTab('room')}
            onOpenCommandSearch={() => setIsCommandSearchOpen(true)}
            onCopyInvite={handleCopyInvite}
          />

          {/* Column 3: Main Stage */}
          <MainStage
            activeTab={activeTab}
            currentChat={currentChat}
            activeChatKey={activeChatKey}
            onSendMessage={handleSendMessage}
            onReactMessage={handleReactMessage}
            replyDraft={replyDraft}
            onStartReply={(author, text) => setReplyDraft({ author, text })}
            onClearReply={() => setReplyDraft(null)}
            onOpenUserProfile={(id) => setUserProfileModalId(id)}
            onOpenContactOptions={() => setIsContactSafetyOpen(true)}
            thoughts={rankedThoughts}
            peopleDirectory={people}
            currentUserId="arjun"
            onPublishThought={handlePublishThought}
            onToggleLikeThought={handleToggleLikeThought}
            onBridgeThoughtToDM={handleBridgeThoughtToDM}
            onToggleFollow={handleToggleFollow}
            isFollowingUser={(id) => myFollowing.has(id)}
            onOpenCommandSearch={() => setIsCommandSearchOpen(true)}
            roomKnockActive={roomKnockActive}
            onAdmitKnock={() => {
              setRoomKnockActive(false);
              setRoomTiles((prev) => [
                ...prev,
                {
                  id: 'meera',
                  name: 'Meera Nair',
                  avatar: INITIAL_PEOPLE_DIRECTORY['meera']?.avatar ?? '',
                  isSpeaking: false,
                },
              ]);
              showNotice('Admitted Meera to room');
            }}
            onDismissKnock={() => {
              setRoomKnockActive(false);
              showNotice('Dismissed room knock');
            }}
            roomTiles={roomTiles}
            roomLocked={roomLocked}
            onToggleRoomLock={() => {
              setRoomLocked((prev) => {
                const next = !prev;
                showNotice(next ? 'Room locked (knock required)' : 'Room unlocked');
                return next;
              });
            }}
            onLeaveRoom={handleReturnToLanding}
            onShowNotice={showNotice}
          />

          {/* Column 4: Right Orbit Rail */}
          <RightOrbitRail
            currentUser={currentUser}
            peopleDirectory={people}
            socialGraph={socialGraph}
            currentUserId="arjun"
            onOpenProfile={(id) => setUserProfileModalId(id)}
            onOpenRoom={() => setActiveTab('room')}
            onToggleFollow={handleToggleFollow}
            selfNote={selfNote}
          />
        </div>
      )}

      {/* =================================================================== */}
      {/* MODALS                                                              */}
      {/* =================================================================== */}
      <CommandPaletteModal
        isOpen={isCommandSearchOpen}
        onClose={() => setIsCommandSearchOpen(false)}
        peopleDirectory={people}
        socialGraph={socialGraph}
        currentUserId="arjun"
        onSelectUser={handleOpenDirectChat}
        onToggleFollow={handleToggleFollow}
      />

      <ProfileDrawerModal
        userId={userProfileModalId}
        onClose={() => setUserProfileModalId(null)}
        peopleDirectory={people}
        socialGraph={socialGraph}
        currentUserId="arjun"
        onToggleFollow={handleToggleFollow}
        onOpenDirectChat={handleOpenDirectChat}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onNotice={showNotice}
      />

      <ContactSafetyModal
        isOpen={isContactSafetyOpen}
        onClose={() => setIsContactSafetyOpen(false)}
        onNotice={showNotice}
        contactName={currentChat.name}
      />

      {/* Floating Pill Toast */}
      {noticeMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-oled-elevated hairline-border text-xs text-white shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {noticeMessage}
        </div>
      )}
    </div>
  );
}
