# Holoraa

> One simple, safe place to talk, share, and hang out with the people who matter.

[![Go Report Card](https://goreportcard.com/badge/github.com/Cholan-kinnera/holoraa)](https://github.com/Cholan-kinnera/holoraa)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.4.3-black)](https://nextjs.org/)
[![Go Toolchain](https://img.shields.io/badge/Go-1.27.3-00ADD8?logo=go)](https://go.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql)](https://www.postgresql.org/)

Holoraa (spelled with two a's) is a minimal, private communication platform built from first principles. It delivers fast, familiar messaging, spontaneous thoughts sharing, drop-in voice lounges, and permanent personal rooms—without ads, tracking pixels, or algorithmic feed manipulation designed to harvest human attention.

---

## Table of Contents

- [Vision & Values](#vision--values)
- [How Holoraa Works (Core Experiences)](#how-holoraa-works-core-experiences)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Security & Privacy Principles](#security--privacy-principles)
- [Repository Layout](#repository-layout)
- [Local Development Setup](#local-development-setup)
- [Testing & Quality Gates](#testing--quality-gates)
- [Roadmap & Milestones](#roadmap--milestones)
- [Contributing & Governance](#contributing--governance)

---

## Vision & Values

Modern social platforms force users into an artificial choice between chaotic workplace tools and attention-extracting algorithmic feeds. Holoraa was built from day one on a quiet third path—designed around human presence and real relationships.

- **Simple by default:** Clean, focused interfaces that prioritize readability, calm surfaces, and effortless navigation.
- **Safe by design:** Explicit permissions, fail-closed access rules, and authenticated boundaries on every route and socket.
- **Private by default:** Zero tracking telemetry, no behavioral profiling, and strict session isolation.
- **Respectful of attention:** Pure chronological feeds, natural completion points, and zero synthetic engagement mechanics.
- **Non-Goals:**
  - 🚫 No advertisements.
  - 🚫 No harvesting or selling of user data.
  - 🚫 No algorithmic ranking or feed manipulation.
  - 🚫 No streaks, public follower counts, or vanity gamification.

---

## How Holoraa Works (Core Experiences)

Holoraa combines four primary real-time spaces into a unified 4-column OLED workspace:

### 1. Direct & Group Messages (`dms`)
- **Fast, familiar conversation:** Clean conversational threads with consecutive message grouping by author.
- **Rich media & audio:** Inline 35mm photo roll previews and custom waveform audio players for asynchronous voice notes.
- **Top status tray:** Instagram-style status note circles with activity indicators (`Fred again.. 🎧`, `iced matcha`, `in room 🎙️`).
- **Interactive invites:** One-click drop-in room invitation cards directly inside chat bubbles.

### 2. The Spot (`spot`)
- **Calm thoughts stream:** A quiet stream for spontaneous thoughts, music recommendations, and photography.
- **No algorithmic ranking:** Posts are displayed strictly in the order they were shared by people in your orbit.
- **Vibe tagging:** Filter moments by moods (`🌙 late night`, `🎞️ analog film`, `☕ blr coffee`, `✨ building`).
- **One-tap DM bridge:** Transition from a shared thought directly into a private conversation via `Reply in DM →`.

### 3. Spaces & Casual Voice Lounges (`spaces`)
- **Interest & community channels:** Organized topics for close circles (e.g., `#general`, `#inspo-drop`, `#music-rotation`).
- **Drop-in voice lounges:** Warm, low-latency audio spaces that you can join and leave silently without friction or awkward goodbyes.

### 4. Personal Rooms (`room`)
- **Permanent personal rooms:** Your dedicated place on the web (e.g., `holoraa.app/arjun`).
- **Knock-to-enter consent:** Friends knock when they want to hang out; you choose when to open the door.
- **Waiting room lobby:** Seamless admission or dismissal of visitors with live lobby notifications.
- **Ghost Mode & Lock:** Total privacy controls to lock your room or browse with incognito presence.

### 5. Holories (Concept)
- **Time journal:** An intimate, collective short story of moments spent together with close friends.
- **Zero vanity metrics:** No public rankings, no streak counters, and no algorithmic competition.

### 6. Sub-Millisecond Mutual Search (`⌘K`)
- **Instant discovery:** High-performance Command Palette (`⌘K`) powered by in-memory prefix matching and mutual-friend graph analysis (sub-0.2ms resolution).

---

## Architecture & Tech Stack

Holoraa v2 is structured as a Go modular monolith paired with a modern Next.js client, strictly adhering to ADR 0007.

| Layer | Technology | Rationale & Status |
|---|---|---|
| **Backend** | Go (Modular Monolith) | Single Go module under `backend/`, Chi router, `internal/` packages. No ORM. |
| **Backend Toolchain** | Go 1.27.3 | Extracted locally to `~/toolchains/go1.27.3`. Verified via official SHA-256. |
| **API Contract** | OpenAPI 3.1.1 + JSON Schema | Single source of truth in `contracts/`. Pinned generators (`oapi-codegen`, `openapi-typescript`). |
| **Database** | PostgreSQL 17 | Provisonal Docker container on `127.0.0.1:5433`. |
| **Migrations** | goose | Forward-only SQL migrations under `backend/db/migrations/`. Zero drift. |
| **Database Queries** | sqlc | Compile-time generated, committed, and drift-checked Go queries under `backend/db/queries/`. |
| **Frontend** | Next.js 16.4.3 (Turbopack) | React 19, TypeScript 5.9, App Router, SSR + Client Components. |
| **Styling & Theme** | Dark-first Modular CSS | OLED True Pitch Black (`#000000`), Terracotta Coral (`#E86C4F`), Emerald Green (`#30D158`). |
| **Motion & Polish** | GSAP 3.15 + Lenis 1.3 | Fluid momentum scrolling and GPU-accelerated spatial timeline animations. |
| **Realtime** | `github.com/coder/websocket` | Standard-compliant, lightweight WebSocket layer (M6). |

---

## Security & Privacy Principles

- **Zero Inline Styles (Strict CSP):** Nonce-only `Content-Security-Policy`. Inline `style="..."` attributes are strictly prohibited and enforced by automated tests.
- **Dual-Cookie Architecture:**
  - `__Host-holoraa_session`: HttpOnly, Secure, SameSite=Strict for authenticated session token storage.
  - `holoraa_user`: Non-sensitive client-readable cookie for offline UI shell hydration.
- **RFC 9457 Problem Details:** All HTTP API errors return structured RFC 9457 payloads (`type`, `title`, `status`, `detail`, `instance`).
- **Trusted Proxy Filtering:** CIDR-based remote IP extraction (ADR 0011) to prevent header spoofing across reverse proxies.
- **Redacted Logging:** `log/slog` structured JSON logs automatically sanitize and suppress authorization tokens, cookies, passwords, and sensitive bodies.

---

## Repository Layout

```
.
├── backend/                  # Go modular monolith
│   ├── cmd/api/              # Application entry point (main.go)
│   ├── internal/             # Private application packages
│   │   ├── app/              # HTTP routing & middleware assembly
│   │   ├── auth/             # Authentication & session token engine
│   │   ├── config/           # Validated environment configuration
│   │   ├── health/           # Liveness & readiness probes
│   │   ├── httpapi/          # Chi router & route handlers
│   │   ├── problem/          # RFC 9457 Problem Details errors
│   │   ├── profile/          # Profile management
│   │   ├── store/            # Storage interfaces & sqlc dbstore
│   │   └── version/          # Build version metadata
│   ├── db/
│   │   ├── migrations/       # goose forward-only SQL migration files
│   │   └── queries/          # sqlc SQL query definitions
│   └── go.mod
├── web/                      # Next.js 16 + TypeScript web application
│   ├── src/
│   │   ├── app/              # App router pages (page.tsx, layout.tsx, globals.css)
│   │   ├── components/       # UI components & workspace shell
│   │   │   ├── landing/      # Landing page sections (Hero3DStage, TheContrast, Holories)
│   │   │   ├── workspace/    # 4-column authenticated app (IconRail, MainStage, ContextDrawer, RightOrbitRail)
│   │   │   ├── modals/       # Command Palette (⌘K), Settings, Profile drawer
│   │   │   └── ui/           # Shared atomic primitives (Avatar, Icons, FollowButton)
│   │   └── lib/              # DSA search graph algorithms, auth flows, Lenis motion
│   └── package.json
├── contracts/                # API contract specifications (Single Source of Truth)
│   ├── openapi.yaml          # OpenAPI 3.1.1 HTTP contract definition
│   └── events/               # JSON Schema realtime event specifications
├── docs/                     # Architectural decisions & product specifications
│   ├── adr/                  # Architecture Decision Records (ADRs 0001–0011)
│   ├── architecture/         # API, Auth, Data model, and Threat model specs
│   ├── product/              # PRD, Vision & Mission, Roadmap
│   └── MILESTONE_GATES.md    # Strict completion criteria for M0 through M8
├── Makefile                  # Build, test, migration, and verification targets
└── AGENTS.md                 # Rulebook and behavioral guidelines for contributors
```

---

## Local Development Setup

### Prerequisites
1. **Docker & Docker Compose:** For running local PostgreSQL 17.
2. **Node.js 24+ & npm:** For the web client.
3. **Go 1.27.3:** Extracted to `~/toolchains/go1.27.3/go/bin/go` (as defined in `AGENTS.md`).

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Cholan-kinnera/holoraa.git
   cd holoraa
   ```

2. **Initialize Local Environment:**
   ```bash
   make dev-env      # Generates a local development .env with secure random credentials
   ```

3. **Start Database & Run Migrations:**
   ```bash
   make db-up        # Starts postgres container (holoraa-v2-postgres on port 5433)
   make migrate-up   # Runs goose migrations (00001_baseline.sql, 00002_identities_and_users.sql)
   ```

4. **Run the Go Backend API Server (Terminal 1):**
   ```bash
   set -a && . ./.env && set +a
   ./bin/api serve   # Starts backend on http://127.0.0.1:8080
   ```

5. **Run the Next.js Frontend Server (Terminal 2):**
   ```bash
   cd web
   HOLORAA_API_URL=http://127.0.0.1:8080 npm run dev
   # App will be accessible at http://localhost:3000
   ```

6. **Verify API Health:**
   ```bash
   curl -i http://127.0.0.1:8080/v1/health   # Returns 200 OK (liveness)
   curl -i http://127.0.0.1:8080/v1/ready    # Returns 200 OK (database readiness)
   ```

---

## Testing & Quality Gates

Every milestone is enforced through automated quality gates. Changes must pass all gates in clean clone environments.

### Backend Verification
```bash
make check GO=/home/ck/toolchains/go1.27.3/go/bin/go
```
- `gofmt -l .` (formatting check)
- `go vet ./...` (vet analysis)
- `go test -race -count=1 ./...` (race detector across all internal packages)
- Binary build & version verification (`./bin/api -version`)

### Frontend Verification
```bash
cd web
npm run typecheck    # TypeScript 5.9 strict type checking (0 errors)
npm run lint         # ESLint 9 checks (0 warnings)
npm test             # Vitest test suite (12 suites, 107 tests passing)
npm run build        # Production Next.js Turbopack build
```

---

## Roadmap & Milestones

The project tracks execution against approved milestone gates in [`docs/MILESTONE_GATES.md`](docs/MILESTONE_GATES.md):

- [x] **M0: Repository Skeleton** — Go module, entry point, Makefile, git safety.
- [x] **M1: Configuration & Logging** — Validated env config, `log/slog` structured JSON logs, zero secret leakage.
- [x] **M2: Health, Readiness, PostgreSQL & goose** — `/v1/health`, `/v1/ready`, goose forward-only migrations.
- [x] **M3: sqlc Integration & D11 Trusted Proxy** — Type-safe queries, CIDR proxy filtering.
- [x] **Frontend Refinement (Phases 1–6)** — Responsive 4-column OLED workspace, messages stream, The Spot, personal rooms, 0.2ms mutual search trie, Lenis smooth scrolling, strict CSP.
- [x] **F1 Milestone 1: Workspace Scrolling** — Scoped Lenis lifecycle to landing page only, eliminated wheel capture in workspace, added `min-h-0` flex nesting, `overscroll-contain`, and reading-position-preserving intelligent conversation auto-scroll across all 4 columns.
- [ ] **F1 Milestone 2: Authentication Foundation** — Refined passwordless OTP UX, responsive form layout, enhanced loading and error states without changing the backend API contract.
- [ ] **F1 Milestone 3: Personal Rooms Stage** — Polished participant audio tiles, active speaker green glow, knock banner, and floating call dock.
- [ ] **M4: Contracts Generator Spike (D9)** — Pin OpenAPI 3.1.1 and JSON Schema validators, Makefile generator drift checks.
- [ ] **M5: Web Integration & Validation** — Connect frontend client to backend endpoints via generated schema client.
- [ ] **M6: Realtime WebSocket Pipeline** — WebSocket event hub with `github.com/coder/websocket`.
- [ ] **M7: Local Infrastructure & Compose** — Production-aligned local orchestration.
- [ ] **M8: Production Readiness & Deployment** — Final load testing, security review, and deployment verification.

---

## Contributing & Governance

- **Rulebook:** All development must strictly adhere to the policies in [`AGENTS.md`](AGENTS.md).
- **Git Safety:** Direct pushes to `main` and force-pushes are strictly prohibited. All work occurs on designated feature branches and requires explicit owner approval.
- **Reporting Security Issues:** Refer to [`SECURITY.md`](SECURITY.md) for vulnerability disclosure guidelines.

---

## Brand & Identity

The name is spelled **Holoraa** (with two a's at the end).
