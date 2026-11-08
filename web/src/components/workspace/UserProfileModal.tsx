"use client";

import React, { useEffect, useRef, useState } from "react";
import { followUserAction, getPublicProfileAction, unfollowUserAction } from "@/app/app/actions";
import type { PublicProfile, UserSummary } from "@/lib/auth/flows";
import { Avatar } from "../ui/Avatar";
import { FollowButton } from "../ui/FollowButton";
import { X } from "../ui/Icons";
import { ProfileModalSkeleton } from "../ui/Skeleton";

export interface UserProfileModalProps {
  user: UserSummary | PublicProfile | null;
  username?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleFollow?: (username: string, nextState: boolean) => Promise<void> | void;
  isCurrentUser?: boolean;
}

export function UserProfileModal(props: UserProfileModalProps) {
  if (!props.isOpen) return null;
  const key = props.user?.username ?? props.username ?? "profile";
  return <UserProfileModalContent key={key} {...props} />;
}

function UserProfileModalContent({
  user: initialUser,
  username,
  onClose,
  onToggleFollow,
  isCurrentUser = false,
}: UserProfileModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<UserSummary | PublicProfile | null>(initialUser ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Follow state tracking with optimistic updates
  const [isFollowing, setIsFollowing] = useState<boolean>(() => {
    if (initialUser && "isFollowing" in initialUser) {
      return Boolean(initialUser.isFollowing);
    }
    return false;
  });
  const [isPending, setIsPending] = useState(false);

  // Fetch full profile if opened with a username without full initial user
  const targetUsername = username ?? initialUser?.username;
  useEffect(() => {
    const uname = targetUsername;
    if (!uname || initialUser) return;

    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await getPublicProfileAction(uname!);
        if (!isMounted) return;
        if (res.ok) {
          setProfile(res.profile);
        } else {
          setErrorMessage(res.message);
        }
      } catch {
        if (isMounted) setErrorMessage("Failed to load profile.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [targetUsername, initialUser]);

  // Outside click and Escape key dismissal
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (
        modalRef.current &&
        (e.target === null || !(e.target instanceof Node) || !modalRef.current.contains(e.target))
      ) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function handleFollowToggle() {
    if (!targetUsername || isPending) return;

    const previousFollowing = isFollowing;
    const nextState = !previousFollowing;

    // Optimistic UI update
    setIsFollowing(nextState);
    setIsPending(true);
    setErrorMessage(null);

    try {
      if (onToggleFollow) {
        await onToggleFollow(targetUsername, nextState);
      } else {
        const res = nextState
          ? await followUserAction(targetUsername)
          : await unfollowUserAction(targetUsername);
        if (!res.ok) {
          // Revert optimistic update on failure
          setIsFollowing(previousFollowing);
          setErrorMessage(res.message);
        }
      }
    } catch {
      setIsFollowing(previousFollowing);
      setErrorMessage("Action failed. Try again.");
    } finally {
      setIsPending(false);
    }
  }

  const name = profile?.displayName ?? profile?.username ?? targetUsername ?? "User";
  const handle = profile?.username ?? targetUsername ?? "";
  const bio = profile?.bio ?? null;
  const avatarUrl = profile?.avatarUrl ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-name"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-[28px] bg-oled-sidebar hairline-border p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200"
      >
        {isLoading && !profile ? (
          <ProfileModalSkeleton />
        ) : (
          <>
            {/* Header: Avatar, Name, Handle, Close Button */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5 min-w-0">
                <Avatar src={avatarUrl} alt={name} size="2xl" />
                <div className="min-w-0">
                  <h3 id="profile-modal-name" className="font-semibold text-base text-white truncate">
                    {name}
                  </h3>
                  {handle && <p className="text-xs text-ink-secondary truncate">@{handle}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-ink-secondary hover:text-white"
                aria-label="Close profile modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Bio */}
            {bio ? (
              <p className="text-xs text-neutral-200 leading-relaxed break-words">{bio}</p>
            ) : (
              <p className="text-xs text-ink-muted italic">No bio written yet.</p>
            )}

            {/* Error Notice */}
            {errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            {/* Actions: Follow / Unfollow */}
            {!isCurrentUser && (
              <div className="pt-2 flex justify-end">
                <FollowButton
                  isFollowing={isFollowing}
                  onToggle={handleFollowToggle}
                  disabled={isPending || isLoading}
                  size="md"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
