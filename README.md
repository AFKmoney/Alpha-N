# Alpha-OS — Recursive Self-Improving OS

A self-evolving operating system that runs in the browser. The AI (**N-Core**) sees its
own desktop through vision, rewrites its own source code, remembers across sessions in
**Akasha** (persistent memory), and executes real commands in a **Linux PTY terminal**.

## What's inside

| Layer | Location | Notes |
| --- | --- | --- |
| Desktop shell | `src/app/page.tsx` + `src/components/alpha/` | Window manager (tile/float, 4 desktops), dock, start menu, command palette, system search, notifications, status bar |
| OS apps | `src/components/alpha/apps/` | 22 apps: terminal, code editor, browser (proxied iframe), files, monitor, council, evolution log, security, memory network, vault, wallpaper, **AI App Store**, calculator, notes, clipboard, ambient sounds, stats, clock, weather, generative music, options, loom |
| State | `src/lib/alpha/` | `os-store` (windows/desktops), `evolution-store` (agents, metrics, chat), Akasha hydration, learning engine, reward model, mutations |
| API routes | `src/app/api/alpha/` | 18 routes: akasha, think, debate, aether, exec (sandboxed run), compile, generate-app, files, search, vision, personality, wallpaper, proxy, models… |
| Terminal service | `mini-services/terminal/` | socket.io + node-pty real bash on **:3003** |
| Aether Engine | `mini-services/aether-engine/` | Rust semantic-memory LLM proxy on **:3004** (axum, 10-stage pipeline, 27 routes) |
| Database | `prisma/` | SQLite — Akasha memories, plans, goals, events, generated apps |

## Quick start

```bash
bun install
bun run db:push        # create the SQLite schema
bun run dev            # desktop on http://localhost:3000

# optional mini-services (real bash terminal + semantic memory):
cd mini-services/terminal && bun install && bun run dev   # :3003
cd mini-services/aether-engine && cargo run --release     # :3004 (needs Rust)
```

The OS runs fully without the mini-services — the terminal shows a clear
offline state and the memory network falls back to local mode.

## Production

```bash
bun run build
bun run start
```

## The AI loop

1. **Observe** — N-Core reads its own state: windows, metrics, evolution log.
2. **Think** — the council (Architect, Developer, Critic, Optimizer) debates a plan
   (`/api/alpha/think`, `/api/alpha/debate`).
3. **Act** — sandboxed code execution (`/api/alpha/exec`), compile checks, app
   generation (AI App Store), or terminal commands via the PTY.
4. **Evolve** — successful mutations are recorded, distilled into Akasha, and
   feed the reward model that steers the next cycle.

Everything the AI changes is reversible: snapshots, rollbacks and the
Security Foundation app keep the system within its constitution.
