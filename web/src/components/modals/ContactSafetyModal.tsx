'use client';

import React, { useEffect } from 'react';
import { BellOff, Flag, Slash } from '../ui/Icons';

interface ContactSafetyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotice: (msg: string) => void;
  contactName?: string;
}

export function ContactSafetyModal({
  isOpen,
  onClose,
  onNotice,
  contactName = 'this chat',
}: ContactSafetyModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-safety-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xs rounded-[26px] bg-oled-elevated hairline-border p-2 shadow-2xl text-xs space-y-1 animate-in fade-in zoom-in-95 duration-200">
        <h4 id="contact-safety-title" className="sr-only">
          Conversation Options for {contactName}
        </h4>
        <button
          type="button"
          onClick={() => {
            onClose();
            onNotice(`Notifications muted for ${contactName}`);
          }}
          className="w-full px-4 py-3 rounded-2xl text-left text-white hover:bg-white/5 flex items-center justify-between transition-colors"
        >
          <span>Mute notifications</span>
          <BellOff size={16} className="text-ink-secondary" />
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            onNotice(`Blocked and conversation hidden`);
          }}
          className="w-full px-4 py-3 rounded-2xl text-left text-rose-400 hover:bg-rose-500/10 flex items-center justify-between transition-colors"
        >
          <span>Block person</span>
          <Slash size={16} />
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            onNotice('Report received — thank you for keeping Holoraa safe');
          }}
          className="w-full px-4 py-3 rounded-2xl text-left text-rose-400 hover:bg-rose-500/10 flex items-center justify-between transition-colors"
        >
          <span>Report conversation</span>
          <Flag size={16} />
        </button>

        <div className="my-1 hairline-t" />

        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 rounded-2xl text-center text-ink-secondary hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
