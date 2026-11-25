"use client";

import { useEffect, useState, type ReactNode } from "react";

import { signOutAction } from "@/app/app/actions";
import { Search } from "@/components/ui/Icons";
import { SearchOverlay } from "@/components/workspace/SearchOverlay";
import { UserProfileModal } from "@/components/workspace/UserProfileModal";
import type { User, UserSummary } from "@/lib/auth/flows";
import type { Conversation } from "@/lib/messaging/flows";

import { ConversationList } from "./ConversationList";
import { ProfileMenu } from "./ProfileMenu";
import { ShellFrame } from "./ShellFrame";
import { MessagingProvider } from "@/lib/messaging/MessagingProvider";

/**
 * The signed-in application shell. Shows conversations in the sidebar and
 * provides user discovery search and profile viewing.
 */
export function AppShell({
  user,
  initialConversations,
  children,
}: {
  user: User;
  /** Server-fetched list; undefined means the client fetches it on mount. */
  initialConversations?: Conversation[];
  children: ReactNode;
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);

  // Global keyboard shortcut: Cmd+K / Ctrl+K opens search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <MessagingProvider user={user} initialConversations={initialConversations}>
      <ShellFrame
        sidebar={
          <>
            <div className="shell__search-container">
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                className="shell__search-btn"
                aria-label="Find people on Holoraa"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Search size={14} />
                  <span>Find people...</span>
                </div>
                <kbd className="shell__search-kbd">⌘K</kbd>
              </button>
            </div>
            <ConversationList onStartSearch={() => setIsSearchOpen(true)} />
          </>
        }
        account={<ProfileMenu user={user} signOut={signOutAction} />}
      >
        {children}
      </ShellFrame>

      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectUser={(u) => setSelectedUser(u)}
      />

      <UserProfileModal
        user={selectedUser}
        isOpen={selectedUser !== null}
        onClose={() => setSelectedUser(null)}
        isCurrentUser={selectedUser?.username === user.username}
      />
    </MessagingProvider>
  );
}
