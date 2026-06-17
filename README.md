# Alpha-N

> **A self-evolving operating system where the kernel IS the AI.**

Alpha-N is a living, breathing operating system that observes its own desktop, critiques its own code, and rewrites itself in real time. The AI doesn't live inside the OS — the AI **is** the OS.

---

## What is this?

Alpha-N is a web-based operating system built with Next.js 16, TypeScript, Rust, and Prisma. It features:

### Core AI
- **Autonomous self-improvement** — the AI observes its own UI via screenshots, identifies inefficiencies, and rewrites its own source code
- **Aether Engine v3.0** — a proprietary Rust inference engine with 10 innovations that make a 1.2B GGUF model perform like a 70B flagship (separate repo: [aether-engine](https://github.com/AFKmoney/aether-engine))
- **Cloud + Local model support** — use GLM 4.6V (cloud) or drop a GGUF file in `models/` and select it in Model Settings
- **Agent council** — 4 sub-agents (Architect, Developer, Auditor, Optimizer) debate before consequential actions
- **Persistent memory (Akasha)** — the AI never forgets; memories, plans, and goals persist in SQLite via Prisma
- **Long-horizon planning** — multi-step plans pursued across cycles
- **Goal hierarchy** — long/medium/short-term goals that guide every action
- **Real file access** — the AI can read and write actual project files (security-checked)
- **Code execution** — sandboxed JS/TS/Bash execution for self-testing
- **Real compilation** — tsc + eslint checks; the AI fixes its own errors
- **Reward model** — tracks which mutations improve vs hurt coherence; the AI learns
- **Self-prompting** — the AI can rewrite its own system prompt to evolve its behavior

### Aether Engine 10 Innovations
1. **Semantic memory graph** — TF-IDF retrieval + edge expansion
2. **Cognitive decompressor** — breaks complex queries into simple sub-questions
3. **Self-verification loop** — retries on failure
4. **Knowledge distillation** — reuses successful reasoning patterns
5. **Context compressor** — reduces 40K→4K tokens preserving signal
6. **Action cache** — instant responses for repeated queries
7. **Speculative prefetch** — warms cache for likely-next queries
8. **Holographic Context Memory (HCM)** — FFT-based fixed-size state matrix, infinite context, zero dynamic allocation
9. **Continuous Latent Trajectory (CLT)** — N-step reasoning in latent space, collapses to tokens on convergence
10. **Asymmetric Tensor Dueling (ATD)** — dual-graph validation where likelihood must overcome entropy

### Desktop OS Features
- **Window manager** — tiling + floating modes, 4 virtual desktops, 8-edge resize handles
- **Floating sidebar** — appears on mouse hover (left edge) with all controls
- **Floating dock** — appears on mouse hover (bottom edge) with app launchers
- **Start menu** — searchable app launcher (bottom-left)
- **Real Linux terminal** — true PTY via node-pty + WebSocket (no sandbox)
- **Working browser** — proxy-based, loads any site including google.com
- **Live code editor (Loom)** — real-time AI code modifications, Q&A, reasoning display, live suggestion injection
- **Real code editor** — reads actual project files, auto-refresh
- **Memory Network** — interactive graph visualization of the AI's semantic memory
- **Security Foundation** — live security score, violation log, rollback history, compilation status, reward model
- **Secret Vault** — password-protected encrypted storage
- **Options** — reset to original state (clears all DB)
- **App Repository** — grid view of all apps with drag-and-drop to desktop

### 13 Apps
Terminal, Loom, Code, Files, Browser, Monitor, Council, Evo Log, Kernel (Security), Vault, Memory, Apps, Options

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Alpha-N OS                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐    │
│  │ Sidebar  │  │ Windows  │  │ Dock + Start  │    │
│  │ (hover)  │  │ Manager  │  │    Menu       │    │
│  └──────────┘  └──────────┘  └───────────────┘    │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │         Autonomous Loop (OODA)             │     │
│  │  Observe → Think → Mutate → Verify        │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐     │
│  │  Cloud   │  │  Aether  │  │   Terminal   │     │
│  │ (GLM 4.6V│  │ Engine   │  │   (PTY)      │     │
│  │  vision) │  │  (Rust)  │  │  (port 3003) │     │
│  └──────────┘  └──────────┘  └──────────────┘     │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │     Akasha (Persistent Memory DB)          │     │
│  │  Memory · Plans · Goals · Events · Rewards│     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │          Security Foundation               │     │
│  │  Protected kernel files · Violation log    │     │
│  │  Rollback engine · Code validation         │     │
│  └────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Push the database schema
bun run db:push

# Start the dev server
bun run dev

# The OS boots at http://localhost:3000
```

### Using a local GGUF model

1. Drop your `.gguf` file in the `models/` folder
2. Open Model Settings (sidebar) → select "Aether"
3. Select your model from the list
4. The Aether Engine loads it with 10x context via the memory graph

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Next.js App | 3000 | The OS desktop + API routes |
| Terminal Service | 3003 | Real Linux PTY via WebSocket |
| Aether Engine | 3004 | Rust inference orchestrator + memory graph |

## Project Structure

```
src/
├── app/
│   ├── api/alpha/          # API routes (think, search, files, exec, compile, debate, akasha, vault, proxy, model, reset, aether, models-list)
│   ├── globals.css         # Liquid Obsidian theme
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Desktop (the only route)
├── components/alpha/
│   ├── apps/               # All 13 apps (terminal, loom, code, browser, files, monitor, council, security, vault, memory, repository, options, custom)
│   ├── top-bar.tsx         # Left sidebar (hover-to-appear)
│   ├── top-bar-logo.tsx    # Animated logo
│   ├── dock.tsx            # Bottom dock (hover-to-appear)
│   ├── start-menu.tsx      # Start menu (bottom-left)
│   ├── window-frame.tsx    # Window chrome (drag, 8-edge resize, 5 buttons)
│   ├── window-manager.tsx  # Renders all open windows
│   ├── chat-panel.tsx      # AI chat (bottom-right)
│   ├── autonomous-loop.tsx # The OODA heartbeat
│   ├── model-settings.tsx  # Cloud/Aether provider toggle + GGUF picker
│   ├── live-mutation-viewer.tsx # Side panel mutation feed
│   └── ...
├── lib/alpha/
│   ├── model-config.ts     # Universal LLM caller (cloud + Aether)
│   ├── evolution-store.ts  # Main Zustand store (AI state, code, memory, plans, goals, chat, mutations, rewards, events)
│   ├── os-store.ts         # OS Zustand store (windows, layout, desktops, security, snapshots)
│   ├── os-types.ts         # Types + tiling engine + security foundation
│   ├── mutations.ts        # 25+ mutation types + tokenizer + validation
│   ├── ai-client.ts        # Frontend API client (think, search, files, exec, compile, debate, aether)
│   └── use-mounted.ts      # SSR-safe hook
mini-services/
├── terminal/               # Real PTY terminal service (port 3003)
└── aether-engine/          # Rust inference engine (port 3004)
prisma/
└── schema.prisma           # Database schema (AkashaMemory, AkashaIntention, Plan, Goal, SystemEvent, MutationReward)
models/                     # Drop your .gguf files here
```

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 5 + Rust
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Database**: Prisma ORM (SQLite)
- **AI**: z-ai-web-dev-sdk (cloud) + Aether Engine (local GGUF)
- **Terminal**: node-pty + xterm.js + socket.io
- **State**: Zustand
- **Animations**: Framer Motion

## Security Foundation

The AI may never rewrite these kernel files:
- `kernel/boot.ts` — Boot sequence
- `kernel/security.ts` — Security layer itself
- `kernel/rollback.ts` — Rollback engine
- `kernel/sandbox.ts` — Process isolation
- `kernel/pty-bridge.ts` — Terminal bridge
- `kernel/akasha.ts` — Long-term memory index

Any attempt to modify these is automatically blocked and logged.

## Related Repos

- [Aether Engine](https://github.com/AFKmoney/aether-engine) — The standalone Rust inference engine (10 innovations)

## License

MIT — Build something mythic.

---

*"A system that cannot rewrite itself is already dead." — N-Core*
