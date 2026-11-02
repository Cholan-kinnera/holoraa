'use client';

import React from 'react';
import { ArrowUpRight, Search } from '../ui/Icons';

interface FloatingNavbarProps {
  onOpenSearch: () => void;
  onEnterApp: (tab?: string) => void;
}

export function FloatingNavbar({ onOpenSearch, onEnterApp }: FloatingNavbarProps) {
  return (
    <nav className="fixed top-0 inset-x-0 z-40 h-16 px-6 sm:px-12 flex items-center justify-between bg-black/65 backdrop-blur-xl hairline-b">
      <div
        className="flex items-center gap-2.5 cursor-pointer"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <div className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm tracking-tighter">
          h
        </div>
        <span className="font-semibold text-base tracking-tight text-white">holoraa</span>
      </div>

      <div className="hidden md:flex items-center gap-8 text-xs text-ink-secondary font-medium">
        <a href="#section-chat" className="hover:text-white transition-colors">
          Messages
        </a>
        <a href="#section-spot" className="hover:text-white transition-colors">
          The Spot
        </a>
        <a href="#section-spaces" className="hover:text-white transition-colors">
          Spaces
        </a>
        <a href="#section-room" className="hover:text-white transition-colors">
          Personal Room
        </a>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-oled-surface hover:bg-oled-elevated hairline-border text-xs text-ink-secondary hover:text-white transition-all"
        >
          <Search size={14} />
          <span>Find people</span>
          <span className="font-mono text-[10px] text-ink-muted ml-1">⌘K</span>
        </button>
        <button
          type="button"
          onClick={() => onEnterApp('dms')}
          className="px-4 py-2 rounded-full bg-white text-black hover:bg-neutral-200 text-xs font-medium tracking-tight transition-all flex items-center gap-1.5 shadow-sm"
        >
          <span>Open Holoraa</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
    </nav>
  );
}
