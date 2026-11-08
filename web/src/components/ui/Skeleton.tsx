"use client";

import React from "react";
import type { AvatarSize } from "./Avatar";

const SKELETON_AVATAR_SIZES: Record<AvatarSize, string> = {
  xs: "w-5 h-5",
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
  xl: "w-12 h-12",
  "2xl": "w-14 h-14",
};

export function Skeleton({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`skeleton ${className}`}
      aria-hidden="true"
      {...props}
    >
      {children}
    </div>
  );
}

export function SkeletonAvatar({
  size = "md",
  className = "",
}: {
  size?: AvatarSize;
  className?: string;
}) {
  const sizeClass = SKELETON_AVATAR_SIZES[size];
  return (
    <div
      className={`skeleton skeleton--circle ${sizeClass} ${className}`}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({
  className = "",
  lines = 1,
}: {
  className?: string;
  lines?: number;
}) {
  if (lines === 1) {
    return <div className={`skeleton skeleton--text ${className}`} aria-hidden="true" />;
  }

  return (
    <div className="space-y-2 w-full" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton skeleton--text ${
            i === lines - 1 ? "w-2/3" : "w-full"
          } ${className}`}
        />
      ))}
    </div>
  );
}

export function SearchResultsSkeleton() {
  return (
    <div className="space-y-1 p-2" aria-busy="true" aria-label="Loading search results">
      {[1, 2, 3].map((key) => (
        <div
          key={key}
          className="p-3 rounded-2xl flex items-center justify-between gap-3 hairline-border bg-white/[0.02]"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <SkeletonAvatar size="lg" />
            <div className="space-y-1.5 flex-1 max-w-[200px]">
              <div className="skeleton skeleton--text w-28 h-3.5" />
              <div className="skeleton skeleton--text w-20 h-2.5 opacity-60" />
            </div>
          </div>
          <div className="skeleton skeleton--pill w-16 h-7 opacity-50" />
        </div>
      ))}
    </div>
  );
}

export function ProfileModalSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading profile">
      {/* Header: Avatar, Name, Handle, Close Button */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3.5 min-w-0">
          <SkeletonAvatar size="2xl" />
          <div className="space-y-2">
            <div className="skeleton skeleton--text w-36 h-4" />
            <div className="skeleton skeleton--text w-24 h-3 opacity-60" />
          </div>
        </div>
        <div className="skeleton skeleton--circle w-6 h-6 opacity-40" />
      </div>

      {/* Bio */}
      <div className="space-y-2 pt-1">
        <div className="skeleton skeleton--text w-full h-3" />
        <div className="skeleton skeleton--text w-4/5 h-3" />
      </div>

      {/* Action */}
      <div className="pt-2 flex justify-end">
        <div className="skeleton skeleton--pill w-24 h-8 opacity-60" />
      </div>
    </div>
  );
}
