'use client';

import React from 'react';
import { Avatar } from '@/components/ui/Avatar';

export function MemoryCanvas() {
  return (
    <div className="memory-canvas" aria-label="Shared memory journal preview">
      {/* Chapter Metadata Header */}
      <div className="memory-canvas-header">
        <div className="memory-chapter-meta">
          <span className="memory-chapter-tag">
            <span className="memory-chapter-dot" />
            Chapter 03 · Coastal Stretch
          </span>
          <p className="memory-chapter-title">Monsoon in Pondicherry</p>
          <p className="memory-chapter-sub">Shared among four close friends · July</p>
        </div>
        <div className="memory-canvas-members" aria-label="Participants in this memory">
          <Avatar
            src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80"
            alt="Arjun"
            size="sm"
          />
          <Avatar
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
            alt="Aanya"
            size="sm"
          />
          <Avatar
            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
            alt="Rohan"
            size="sm"
          />
          <Avatar
            src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80"
            alt="Kabir"
            size="sm"
          />
        </div>
      </div>

      {/* Collage Elements */}
      <div className="memory-canvas-collage">
        {/* Analog Photo Snapshot */}
        <div className="memory-photo-card">
          <div className="memory-photo-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=80"
              alt="Analog sea view"
              width={400}
              height={260}
              className="memory-photo-img"
              loading="lazy"
            />
          </div>
          <div className="memory-photo-footer">
            <p className="memory-photo-caption">
              “35mm roll from the pier. Coffee at 7 AM before the heat set in.”
            </p>
            <div className="memory-photo-author">
              <Avatar
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"
                alt="Aanya"
                size="xs"
              />
              <span>Aanya Sharma</span>
            </div>
          </div>
        </div>

        {/* Right Stack: Ambient Audio + Memory Note */}
        <div className="memory-canvas-side-stack">
          {/* Ambient Listening Snippet */}
          <div className="memory-audio-card">
            <div className="memory-audio-icon-wrap" aria-hidden="true">
              <svg className="memory-audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            </div>
            <div className="memory-audio-info">
              <span className="memory-audio-meta">Shared audio lounge · 42 mins</span>
              <p className="memory-audio-title">Rooftop sunset tape · Fred again..</p>
              <div className="memory-audio-listeners">
                <span className="memory-audio-badge">3 listening together</span>
              </div>
            </div>
          </div>

          {/* Conversation Excerpt / Thought */}
          <div className="memory-quote-card">
            <div className="memory-quote-bubble">
              <p className="memory-quote-text">
                “Anyone up for a late-night synth jam in the lounge at 11? Dropping stems now.”
              </p>
              <div className="memory-quote-author">
                <Avatar
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=80&auto=format&fit=crop&q=80"
                  alt="Kabir"
                  size="xs"
                />
                <span>Kabir Menon · 11:20 PM</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grounding statement */}
      <div className="memory-canvas-grounding">
        <span className="memory-grounding-icon">✦</span>
        <span>A shared stretch of time. Zero vanity metrics, no streaks, no public rankings.</span>
      </div>
    </div>
  );
}
