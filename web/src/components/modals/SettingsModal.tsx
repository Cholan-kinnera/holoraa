'use client';

import React, { useEffect, useState } from 'react';
import { Shield, X } from '../ui/Icons';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotice: (msg: string) => void;
}

export function SettingsModal({ isOpen, onClose, onNotice }: SettingsModalProps) {
  const [readReceipts, setReadReceipts] = useState(true);
  const [activeStatus, setActiveStatus] = useState(true);
  const [quietHours, setQuietHours] = useState(false);
  const [ghostMode, setGhostMode] = useState(false);
  const [incognitoKnocking, setIncognitoKnocking] = useState(false);

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

  const handleDownloadArchive = () => {
    const data = {
      app: 'Holoraa',
      version: 'v2',
      exportedAt: new Date().toISOString(),
      user: {
        id: 'arjun',
        handle: '@arjun',
        name: 'Arjun Mehta',
      },
      settings: {
        readReceipts,
        activeStatus,
        quietHours,
        ghostMode,
        incognitoKnocking,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holoraa-archive-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotice('Personal archive downloaded');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-[28px] bg-oled-surface hairline-border p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-accent-coral" />
            <h3 id="settings-modal-title" className="font-display font-semibold text-base text-white">
              Privacy & Preferences
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings dialog"
            className="p-1 text-ink-secondary hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          <label className="flex items-center justify-between py-2 hairline-b cursor-pointer">
            <div>
              <p className="font-medium text-white">Read receipts</p>
              <p className="text-ink-secondary mt-0.5">Let friends know when you have seen their message</p>
            </div>
            <input
              type="checkbox"
              checked={readReceipts}
              onChange={(e) => {
                setReadReceipts(e.target.checked);
                onNotice('Read receipts updated');
              }}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-2 hairline-b cursor-pointer">
            <div>
              <p className="font-medium text-white">Active status</p>
              <p className="text-ink-secondary mt-0.5">Show when you are online or in a room</p>
            </div>
            <input
              type="checkbox"
              checked={activeStatus}
              onChange={(e) => {
                setActiveStatus(e.target.checked);
                onNotice('Active status updated');
              }}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-2 hairline-b cursor-pointer">
            <div>
              <p className="font-medium text-white">Ghost mode</p>
              <p className="text-ink-secondary mt-0.5">Hide your presence completely except from mutuals</p>
            </div>
            <input
              type="checkbox"
              checked={ghostMode}
              onChange={(e) => {
                setGhostMode(e.target.checked);
                onNotice(e.target.checked ? 'Ghost mode enabled' : 'Ghost mode disabled');
              }}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-2 hairline-b cursor-pointer">
            <div>
              <p className="font-medium text-white">Incognito knocking</p>
              <p className="text-ink-secondary mt-0.5">Only room hosts see your identity when knocking</p>
            </div>
            <input
              type="checkbox"
              checked={incognitoKnocking}
              onChange={(e) => {
                setIncognitoKnocking(e.target.checked);
                onNotice(e.target.checked ? 'Incognito knocking enabled' : 'Incognito knocking disabled');
              }}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-2 hairline-b cursor-pointer">
            <div>
              <p className="font-medium text-white">Quiet hours</p>
              <p className="text-ink-secondary mt-0.5">Pause notifications after 11:00 PM</p>
            </div>
            <input
              type="checkbox"
              checked={quietHours}
              onChange={(e) => {
                setQuietHours(e.target.checked);
                onNotice('Quiet hours updated');
              }}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </label>
        </div>

        <div className="pt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={handleDownloadArchive}
            className="text-xs text-ink-secondary hover:text-white underline transition-colors"
          >
            Download personal archive
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-white/10 text-white text-xs font-medium border border-white/15 hover:bg-white/15 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
