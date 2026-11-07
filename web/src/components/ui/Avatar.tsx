'use client';

import React, { useState } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface AvatarProps {
  src?: string | null;
  alt: string;
  size?: AvatarSize;
  className?: string;
  ring?: 'coral' | 'green' | 'none';
  presence?: 'online' | 'offline' | 'speaking' | 'knock';
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'avatar-xs',
  sm: 'avatar-sm',
  md: 'avatar-md',
  lg: 'avatar-lg',
  xl: 'avatar-xl',
  '2xl': 'avatar-2xl',
};

export function Avatar({
  src,
  alt,
  size = 'md',
  className = '',
  ring = 'none',
  presence,
}: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  const sizeClass = SIZE_CLASSES[size];

  const ringClass =
    ring === 'coral'
      ? 'avatar-ring-coral'
      : ring === 'green'
      ? 'avatar-ring-green'
      : '';

  // Get initials for fallback (up to 2 letters)
  const initials = alt
    ? alt
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  return (
    <div className={`avatar-container ${sizeClass} ${ringClass} ${className}`}>
      {src && !hasError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="avatar-img"
          onError={() => setHasError(true)}
          loading="lazy"
        />
      ) : (
        <span className="avatar-fallback" aria-label={alt}>
          {initials}
        </span>
      )}

      {presence && (
        <span
          className={`avatar-presence avatar-presence--${presence}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
