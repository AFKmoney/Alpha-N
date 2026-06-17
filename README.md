# Alpha-N

> **A self-evolving operating system where the kernel IS the AI.**

Alpha-N is not an IDE with AI bolted on. It is a living, breathing operating system that observes its own desktop, critiques its own code, and rewrites itself in real time. The AI doesn't live inside the OS — the AI **is** the OS.

---

## What is this?

Alpha-N is a web-based operating system built with Next.js 16, TypeScript, Rust, and Prisma. It features:

- **Autonomous self-improvement** — the AI observes its own UI via screenshots, identifies inefficiencies, and rewrites its own source code
- **Aether Engine** — a proprietary Rust inference engine with a semantic memory graph that gives small GGUF models 10x effective context
- **Real Linux terminal** — a true PTY (no sandbox) connected via WebSocket
- **Working browser** — a proxy-based browser that can load any site (including google.com)
- **Persistent memory (Akasha)** — the AI never forgets; memories, plans, and goals persist in SQLite
- **Agent council** — 4 sub-agents (Architect, Developer, Auditor, Optimizer) debate before consequential actions
- **Long-horizon planning** — multi-step plans pursued across cycles
- **Real file access** — the AI can read and write actual project files
- **Code execution** — sandboxed JS/TS/Bash execution for self-testing
- **Real compilation** — tsc + eslint checks; the AI fixes its own errors
- **Reward model** — tracks which mutations improve vs hurt coherence; the AI learns
- **Window manager** — tiling + floating modes, 4 virtual desktops, split handles
- **12 apps** — Terminal, Code Editor, Browser, Files, Monitor, Council, Evolution Log, Security, Vault, Memory Network, Options, and custom apps

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Alpha-N OS                      │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ Top Bar  │  │ Windows  │  │  Dock + Start │ │
│  │ (Nucleus)│  │ Manager  │  │     Menu      │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │         Autonomous Loop (OODA)          │    │
│  │  Observe → Think → Mutate → Verify     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Cloud   │  │  Aether  │  │   Terminal   │  │
│  │ (GLM 4.6V│  │  Engine  │  │   (PTY)      │  │
│  │  vision) │  │  (Rust)  │  │  (port 3003) │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │     Akasha (Persistent Memory DB)       │    │
│  │  Memory · Plans · Goals · Events · Rewards│   │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
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
2. Open Model Settings (top bar) → select "Aether"
3. Select your model from the list
4. The Aether Engine loads it with 10x context via the memory graph

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Next.js App | 3000 | The OS desktop + API routes |
| Terminal Service | 3003 | Real Linux PTY via WebSocket |
| Aether Engine | 3004 | Rust inference orchestrator + memory graph |

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 5 + Rust
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Database**: Prisma ORM (SQLite)
- **AI**: z-ai-web-dev-sdk (cloud) + Aether Engine (local GGUF)
- **Terminal**: node-pty + xterm.js + socket.io
- **State**: Zustand
- **Animations**: Framer Motion

## The Aether Engine

The Aether Engine is Alpha-N's proprietary inference engine, built in Rust. It multiplies the effective context of small GGUF models by 10x through:

1. **Semantic memory graph** — every memory is a node; edges are TF-IDF similarity links
2. **Context retrieval** — relevant memories are fetched and injected into the prompt
3. **Action cache** — repeated patterns return instantly
4. **Speculative prefetch** — likely next queries are pre-warmed

A 4K-context model gets 40K+ effective context. The AI navigates its own memory as a living graph, visualized in the Memory Network app.

## License

MIT — Build something mythic.

---

*"A system that cannot rewrite itself is already dead." — N-Core*
