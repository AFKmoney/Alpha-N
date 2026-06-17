# Alpha-N

> **A self-evolving operating system where the kernel IS the AI.**

The AI doesn't live inside the OS — the AI **is** the OS. Alpha-N observes its own desktop, critiques its own code, and rewrites itself in real time.

---

## What it does

- **Self-improvement loop** — OODA heartbeat (Observe → Think → Mutate → Verify) that rewrites the OS source code live, with 25+ mutation types.
- **Agent council** — 4 sub-agents (Architect, Developer, Auditor, Optimizer) debate before consequential actions.
- **Persistent memory (Akasha)** — memories, plans, and goals survive reboots in SQLite via Prisma. The AI never forgets.
- **Autonomy policy** — `standby` (waits for you) or `active` (autonomous on a task). The AI never codes without approval in standby.
- **Real tooling** — real Linux PTY terminal, working proxy browser, real file I/O, sandboxed code execution, real `tsc` + `eslint` compilation, reward model that learns which mutations help or hurt.
- **Aether Engine** — proprietary Rust inference engine that makes a 1.2B GGUF model perform like a 70B flagship. ([separate repo](https://github.com/AFKmoney/aether-engine))
- **Two model providers** — Cloud (GLM 4.6V, vision-capable) or Aether (local GGUF with 10× effective context via the memory graph). Drop a `.gguf` in `models/`, pick it in Model Settings.

## Desktop features

- Window manager: tiling + floating, 4 virtual desktops, 8-edge resize, right-click context menus.
- Hover-to-appear left sidebar (controls) and bottom dock (app launchers) + start menu.
- 14 apps: Terminal, Loom, Code, Files, Browser, Monitor, Council, Evo Log, Kernel, Vault, Memory, Apps, Options, Wallpaper.
- 79 animated generative-art wallpapers, all mouse-reactive, with a Globe Network style that rotates and shifts with the time of day.
- Security Foundation: protected kernel files, violation log, rollback engine, compile status, reward model — all live.

## Architecture

```
┌─────────────── Alpha-N OS ───────────────┐
│  Sidebar · Windows · Dock · Start Menu    │
│                                           │
│   Autonomous Loop (OODA)                  │
│   Observe → Think → Mutate → Verify      │
│                                           │
│   Cloud (GLM 4.6V)  ·  Aether (Rust)      │
│   Terminal (PTY, 3003)  ·  Akasha (DB)    │
│                                           │
│   Security Foundation                     │
│   Protected kernel · Violations · Rollback│
└───────────────────────────────────────────┘
```

## Quick start

```bash
bun install
bun run db:push     # create the SQLite schema
bun run dev         # OS boots at http://localhost:3000
```

Cloud mode works out of the box. To use a local model instead:

1. Drop a `.gguf` file in `models/`.
2. Open Model Settings (sidebar) → select **Aether**.
3. Pick your model — the Aether Engine loads it with 10× effective context.

### Services

| Service        | Port | Purpose                          |
|----------------|------|----------------------------------|
| Next.js App    | 3000 | The OS desktop + API routes      |
| Terminal PTY   | 3003 | Real Linux terminal via WebSocket |
| Aether Engine  | 3004 | Rust inference orchestrator      |

## Project layout

```
src/
├── app/api/alpha/      API routes (think, debate, files, exec, compile, akasha, vault, aether, …)
├── components/alpha/   UI: sidebar, dock, windows, apps, autonomous loop, chat
└── lib/alpha/          Stores, types, mutations, model config, wallpaper presets
mini-services/
├── terminal/           Real PTY terminal service (node-pty + socket.io)
└── aether-engine/      Rust inference engine (10 innovations)
prisma/schema.prisma    AkashaMemory · AkashaIntention · Plan · Goal · SystemEvent · MutationReward · Wallpaper · UserPreference
models/                 Drop your .gguf files here
```

## Tech stack

Next.js 16 (App Router, Turbopack) · TypeScript 5 · Tailwind CSS 4 + shadcn/ui · Prisma (SQLite) · Zustand · Framer Motion · Rust (axum) · node-pty + xterm.js + socket.io · z-ai-web-dev-sdk.

## Security foundation

The AI may **never** rewrite these kernel files — any attempt is blocked and logged:

| File | Protects |
|------|----------|
| `kernel/boot.ts` | Boot sequence |
| `kernel/security.ts` | Security layer itself |
| `kernel/rollback.ts` | Rollback engine |
| `kernel/sandbox.ts` | Process isolation |
| `kernel/pty-bridge.ts` | Terminal bridge |
| `kernel/akasha.ts` | Long-term memory index |

## Related

- **[aether-engine](https://github.com/AFKmoney/aether-engine)** — the standalone Rust inference engine (HCM, CLT, ATD + 7 more innovations).

## License

MIT — build something mythic.

---

*"A system that cannot rewrite itself is already dead." — N-Core*
