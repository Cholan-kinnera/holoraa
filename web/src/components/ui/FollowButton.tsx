'use client';

import React from 'react';

interface FollowButtonProps {
  isFollowing: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export function FollowButton({
  isFollowing,
  onToggle,
  size = 'md',
  disabled = false,
  className = '',
}: FollowButtonProps) {
  const sizeClass = size === 'sm' ? 'btn-follow--sm' : 'btn-follow--md';
  const stateClass = isFollowing ? 'btn-follow--following' : 'btn-follow--active';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onToggle();
        }
      }}
      disabled={disabled}
      aria-pressed={isFollowing}
      className={`btn-follow ${sizeClass} ${stateClass} ${className}`}
    >
      <span>{isFollowing ? 'Following' : 'Follow'}</span>
    </button>
  );
}
