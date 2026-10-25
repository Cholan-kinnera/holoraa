# Brand Identity & Design Tokens — Holoraa

- **Purpose:** Brand guidelines, typography, colour tokens, and voice.
- **Owner:** TODO(owner): Brand & Product Design Lead
- **Status:** Draft for owner review (v2 reconciliation). Not yet approved.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** The tokens are defined in the legacy web app (`apps/web/src/app/globals.css`) and are carried into v2 when the web app is built (milestone M5). The v2 web app does not exist yet.

---

## 🔤 Brand Name & Spelling

- **Official spelling:** **Holoraa** (exactly two 'a's at the end).
- **Prohibited spellings:** Holora, Holoraaa, HoloRaa, holoraa (unless in a domain or CLI context).
- **Pronunciation:** *Hoh-loh-rah*

---

## 🎨 Colour Palette & CSS Variables

Holoraa is dark mode first, with deep navy tones for comfortable, low-fatigue use:

| Token | Dark value | Light value | Purpose |
|---|---|---|---|
| `--bg-primary` | `#0b0f19` (deep navy) | `#f8fafc` (off white) | App background |
| `--bg-surface` | `#111827` (charcoal slate) | `#ffffff` (white) | Sidebars, panels, cards |
| `--bg-elevated` | `#1f2937` (dark slate) | `#f1f5f9` (soft grey) | Hover and active states |
| `--text-primary` | `#f9fafb` | `#0f172a` | Body text and headings |
| `--text-secondary` | `#9ca3af` | `#475569` | Subtext, timestamps, hints |
| `--border-subtle` | `#1f2937` | `#e2e8f0` | Dividers and borders |
| `--accent-gradient` | `linear-gradient(135deg, #14b8a6 0%, #3b82f6 50%, #8b5cf6 100%)` | same | The signature accent gradient |

> **Single variable principle:** The accent gradient is defined in one CSS variable, `--accent-gradient`. Changing that variable changes every highlight in the app without touching components.

---

## 📐 Shape & Geometry

- **Curvature:** Generous rounding: containers, buttons, and avatars or pills.
- **Depth:** Subtle 1px borders (`var(--border-subtle)`) with soft glow shadows (`rgba(59, 130, 246, 0.25)`).

---

## 🔠 Typography

- **System stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Weights:** Regular (400) for message text, Medium (500) for controls and labels, Semi-bold (600) for channel names and section headings.

---

## 🎙️ Voice & Tone

1. **Calm and unobtrusive:** The interface is a clear window onto conversations, not something that demands attention.
2. **Clear and direct:** Error messages say what happened, without jargon or playful obscurity.
3. **Respectful:** System messages never shout, guilt, or pressure people into staying longer.
