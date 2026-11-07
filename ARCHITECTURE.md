# Alpha-N Architecture

A web-based, self-evolving operating system. The AI ("N-Core") lives inside
the browser as a desktop metaphor and rewrites its own UI in real time via a
structured mutation language. Inference runs in-process through the Aether
Engine (a Rust llama.cpp binding) — no external cloud is required.

This document is the map. Use it to orient before diving into a subsystem.

```
 ┌──────────────────────────── BROWSER (Next.js) ────────────────────────────┐
 │                                                                           │
 │   components/alpha/         ← the desktop (windows, dock, apps, panels)   │
 │        │  emits Mutations                                                  │
 │        ▼                                                                   │
 │   lib/alpha/evolution-store  ← the organism's mind (Zustand)              │
 │        │  agents · metrics · chat · memory · plans · lessons              │
 │        │                                                                  │
 │   lib/alpha/autonomous-loop  ← the OODA heartbeat                         │
 │        │  observe → orient (think) → decide (authorize) → act → learn     │
 │        ▼                                                                   │
 └─────────────────────────── HTTP /api/alpha/* ─────────────────────────────┘
                                  │
         ┌────────────────────────┼─────────────────────────┐
         ▼                        ▼                          ▼
   think (LLM call)         exec / files / audit      reload-engine
         │                                                  │
         └──────────────► Aether Engine (:3004) ◄───────────┘
                            (Rust · llama.cpp · GGUF)
```

## The cognitive loop (OODA)

`components/alpha/autonomous-loop.tsx` is the heartbeat. Every cycle:

1. **Observe** — snapshots the full OS state (windows, agents, metrics, memory,
   recent episodes, persisted lessons, autonomy level).
2. **Orient** — sends it to `/api/alpha/think`, which builds a rich prompt and
   calls the LLM (native Aether first, cloud fallback).
3. **Decide** — every returned mutation runs through `authorize()` in
   `lib/alpha/autonomy-policy.ts`. Denied mutations are logged and skipped.
4. **Act** — applies the mutation to the stores (`evolution-store`,
   `os-store`) and, for tools, calls the matching `/api/alpha/*` route.
5. **Learn** — `lib/alpha/reward-model.ts` scores each action objectively; the
   `learning-engine.ts` turns the trail into a lesson injected at the top of
   the next think prompt.

## Trust levels (the safety dial)

Three switchable levels govern what the AI may do without asking. Set them
from the Control Center app or the status bar. The kernel (`kernel/*`,
`prisma/schema.prisma`, `.env`, `Caddyfile`) is **always** protected.

| Level | File writes | Exec | Network | Self-prompt | Rate limit |
|-------|-------------|------|---------|-------------|------------|
| 🛡 Sandbox | ✗ | ✗ | ✗ | ✗ | 30/min |
| 🟡 Moderate (default) | ✓ sandboxed | ✓ sandboxed | ✗ | ✗ (council) | 20/min |
| 🔥 YOLO | ✓ | ✓ | ✓ | ✓ | unlimited |

See `lib/alpha/autonomy-policy.ts`. `authorize()` is fail-closed: any unknown
mutation kind is refused.

## The mutation language

`lib/alpha/mutations.ts` defines a discriminated union of ~50 mutation types.
The LLM emits them; the client applies them. They fall into families:

- **Cognitive** — `add_log`, `speak`, `set_state`, `update_metric`, `debate`
- **Memory (Akasha)** — `add_memory`, `add_intention`, `resolve_intention`,
  `create_plan`, `advance_plan`, `add_goal`
- **Filesystem** — `read_file`, `write_file`, `list_directory`, `delete_file`
- **Code** — `replace_code`, `insert_code`, `commit_evolution`, `compile`
- **Execution** — `execute_code`, `run_terminal`, `web_search`, `navigate_graph`
- **UI** — `create_app`, `close_app`, `move_window`, `snap_window`, `set_theme`
- **Self-control** — `set_autonomy_mode`, `set_autonomy_level`, `reload_engine`

Every mutation flows through `describeMutation()` (human label) and
`authorize()` (permission gate) before being applied.

## The Aether Engine (native inference)

`mini-services/aether-engine/` is a Rust axum server that runs GGUF models
**in-process** via `llama-cpp-2`. It is the organism's brain. The cognitive
pipeline (TF-IDF memory retrieval, HCM context compression, action cache,
decomposition) wraps the raw llama.cpp generation.

- `src/engine.rs` — `NativeEngine`: load a GGUF, tokenise, decode, sample.
- `src/handlers.rs` — `chat_completions` (the OpenAI-compatible endpoint the
  OS calls) + `admin_reload` (hot-swap the model at runtime).
- Build requires LLVM + CMake + MinGW on Windows; see
  [`docs/AETHER_NATIVE_BUILD.md`](docs/AETHER_NATIVE_BUILD.md).

## State management

Two Zustand stores hold everything:

- `lib/alpha/os-store.ts` — the **desktop**: windows, layout, viewport,
  violations, rollback snapshots, theme, wallpaper. Plus the immutable
  `SECURITY_FOUNDATION` (kernel file list).
- `lib/alpha/evolution-store.ts` — the **mind**: agents, metrics, chat,
  Akasha memory/intentions/plans/goals, episode log, reward model,
  persisted lessons, autonomy mode/level.

Both persist to SQLite via Prisma (`/api/alpha/akasha`, `/api/alpha/episode-log`,
`/api/alpha/constraints`). Pure helpers are extracted into
`evolution-store-helpers.ts` for unit testing.

## API surface (`src/app/api/alpha/`)

| Route | Purpose |
|-------|---------|
| `think` | The LLM call. Builds the prompt, calls Aether/cloud, parses mutations. |
| `exec` | Sandboxed code execution (isolated dir, minimal env, no leakage). |
| `files` | Read/write/delete project files (path-traversal-proof). |
| `audit` | Append/read the tamper-evident action trail. |
| `reload-engine` | Forward to Aether `/admin/reload` to hot-swap the model. |
| `probe-providers` | Boot-time detection of which LLM backend is reachable. |
| `akasha`, `episode-log`, `constraints` | Persistence for memory/episodes/rules. |
| `compile`, `search`, `debate`, `vision`, `generate-app` | Tool backends. |

## Tests

`tests/` — pure-logic vitest suites (93 tests). Coverage:
- `autonomy-policy` — fail-closed behaviour, per-level gating, self-control.
- `paths` — path-traversal vectors (caught a real bug).
- `code-validation` — brace/paren/bracket balance, tokenizer.
- `reward-model` — objective reward priority + aggregation.
- `learning-engine` — repeated failure → STOP recommendation.
- `chat-helpers` — suggestions, byte formatting, personalities.

Run: `npm run test`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.

## How to extend

- **New AI capability** → add the mutation to `mutations.ts`, gate it in
  `autonomy-policy.ts`, handle it in `autonomous-loop.tsx`, document it in the
  think prompt, add a test.
- **New app** → add an `AppKind` to `os-types.ts`, a dock entry, and a `case`
  in `window-manager.tsx`'s `renderAppContent`. Wrap risky renders in
  `AppErrorBoundary`.
- **New backend** → follow `docs/AETHER_NATIVE_BUILD.md`; the engine exposes a
  single `NativeEngine::complete` to plug into.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for invariants and commit conventions.
