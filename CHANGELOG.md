# Changelog

## [0.4.0] — 2026-11-07 — The Reconciliation

Merged the best of the two divergent lineages: this branch (the rebuilt,
polished desktop) and the legacy `main-backup-1010` branch (63 commits of
hardening, docs and CI). The desktop keeps its Tailwind v4 accent system,
AI App Store and resilient terminal, and gains the legacy engineering
surface: CI, unit tests, architecture docs and ~20 components that had
been lost in the rebuild.

### 🔴 Repo hygiene

- **Untracked sandbox artifacts** — `.env`, `tool-results/`, `recovered/`,
  `upload/` tarball, `TODO.MD`, runtime build scripts and one-off recovery
  tooling no longer ship with the repo. `.gitignore` hardened so they
  cannot come back.
- **`package-lock.json` regenerated** from the final dependency set
  (vitest added) — `npm ci` and the CI pipeline are reproducible again.

### 🧪 Engineering surface (ported from the legacy branch)

- **CI** (`.github/workflows/ci.yml`): typecheck + unit tests + lint, then
  a production build job on every push/PR to main.
- **101 unit tests** (vitest): autonomy policy (fail-closed, sandbox
  read-only, no self-escalation to yolo), code validation (brace balance,
  tokenizer classification), learning engine, reward model, chat helpers,
  paths (traversal + absolute-path rejection incl. Windows drives).
- **Docs**: `ARCHITECTURE.md`, `docs/` (Aether native build, mutations),
  `CONTRIBUTING.md`, agent context files.
- **Cross-platform build scripts**: `ensure-dirs.mjs` (postinstall — fresh
  clones boot cleanly), `postbuild.mjs` (replaces the Linux-only `cp -r`).

### ✨ Components & features (ported and wired)

- **Control Center** (`control`), **OS File Graph** (`filegraph`, live
  project scan), **App Repository** (`repository`) — registered in the
  dock, window manager and desktop shortcut seeds.
- **Desktop shortcuts** — draggable pinned icons with context menu
  (open / pin to taskbar / remove), seeded with 7 apps.
- Autonomy mode selector, agent panel, synapse map, evolution tree,
  neural diff, nucleus, optimization stream, error boundary, theme sync,
  micro-agents, audit log (+ `/api/alpha/audit`), probe-providers and
  reload-engine API routes.
- **Objective reward model + learning engine** restored to the tested
  legacy implementations (`RewardSignals`, `computeStrategyStats`,
  per-kind failure streaks, imperative recommendations).
- **Autonomy policy** restored to the fail-closed legacy engine with the
  richer `AUTONOMY_POLICIES` metadata (labels, descriptions, accents) and
  the kernel-path sovereignty guard kept from the rebuild.

### 🦀 Aether Engine

- `Cargo.lock` + `.cargo/config.toml` ported for reproducible Rust builds
  (compilation itself still to verify on a machine with cargo).

## [0.3.0] — 2026-06-19 — The Hardening

A full-day refonte focused on security, code quality, cross-platform
support, and making the self-evolving loop trustworthy. The OS now earns
its "autonomous" claim with real guardrails instead of relying on the
model to behave.

### 🔴 Security (critical)

- **Removed 273 MB of committed Rust build artifacts** (`aether-engine/target/`,
  1009 files) that had been force-added despite `.gitignore`. Repo is back
  to a sane size.
- **Uncommitted `.env`** — it was checked into a public repo. Removed from
  git, `.gitignore` hardened, `.env.example` template added.
- **Cross-platform path resolution** (`paths.ts`) — `PROJECT_ROOT` is now
  derived from `ALPHA_PROJECT_ROOT` / `cwd()` instead of the hardcoded
  `/home/z/my-project`. Works on Windows, macOS, and Linux.
- **Path traversal guard hardened** — `resolveSafe()` now rejects absolute
  paths outright (the old code stripped leading slashes, which let
  `/etc/shadow` resolve as a project-relative path — a real vector caught
  by the new test suite). Symlink-aware via `fs.realpath` re-check.
- **Sandboxed exec** (`/api/alpha/exec`) rewritten:
  - Runs in an isolated per-run dir **outside** the project root.
  - Receives a minimal env (`PATH`, `HOME`, `NODE_ENV`, …) — never the full
    `process.env`, so API keys / `DATABASE_URL` can't leak.
  - Network egress gated to YOLO mode + explicit opt-in.
  - Hard 15s timeout, 1MB output cap, run dir wiped after each call.
- **Autonomy policy engine** (`autonomy-policy.ts`) — three switchable trust
  levels (**Bac à sable / Modéré / YOLO**) with per-capability gating. Every
  mutation runs through `authorize()` before being applied; unknown types
  fail closed.
- **Audit trail** (`audit-log.ts` + `/api/alpha/audit`) — every consequential
  AI action is recorded to `SystemEvent` and exposed for inspection.

### 🟠 Quality

- **Fixed all 15 real TypeScript errors** previously masked by
  `ignoreBuildErrors: true` (the build silently shipped broken code):
  `generatedAppRaw` undefined ref, `reviewing` misused as `LogLevel`,
  `EpisodeEntry.timestamp` mapping, `OSSnapshot` export conflict,
  `rollback` return type, `createVision` missing `model`, `DragEvent`
  typing, React self-reference type cycle.
- **`ignoreBuildErrors` removed** — type errors now block the build. The
  production build passes cleanly for the first time on an honest check.
- **ESLint re-enabled** — high-signal rules (`no-unused-vars`,
  `no-unreachable`, `prefer-const`, `no-debugger`, `no-fallthrough`) back
  on as warnings; noisy rules stay off. Build artifacts and mini-services
  excluded from linting.
- **Test suite added** (vitest, 52 tests):
  - `autonomy-policy.test.ts` — fail-closed behaviour, per-level gating
  - `paths.test.ts` — traversal vectors (caught the absolute-path bug)
  - `code-validation.test.ts` — brace/paren/bracket balance, tokenizer
  - `reward-model.test.ts` — reward priority, clamping, aggregation
- **Cross-platform build** — the bash-only `cp -r` postbuild step is now a
  Node script (`scripts/postbuild.mjs`).

### 🟡 Interface

- **Autonomy mode selector** in the Control Center — segmented control with
  a live capability readout, rate-limit hint, and a YOLO warning.
- **Global error boundary per window** — a crashing app window now shows a
  retry fallback instead of blanking the entire desktop.
- **WindowManager performance** — subscribed via individual Zustand
  selectors + `useMemo`/`useCallback`; dragging one window no longer
  re-renders every other window.

### 🟣 Autonomy loop

- **Objective reward model** (`reward-model.ts`) — the AI is now graded on
  verifiable outcomes (tool exit code, file write result, policy block,
  rollback, user 👍/👎) instead of self-reporting coherence via
  `update_metric`. Closes the "grading its own homework" loophole.
- Per-mutation outcome tracking wired into the autonomous loop.
- Rollback decision computed once and shared between reward + restore.

### ⚫ Platform / tooling

- **CI** (`.github/workflows/ci.yml`) — typecheck + tests + lint + build on
  every push/PR to main.
- `package.json` scripts: `typecheck`, `test`, `test:watch` added; `build`
  and `start` made cross-platform (no more `bun`/`tee` hard dependency).
- `tsconfig.json` excludes `mini-services`, `examples`, `tests` (they're
  separate concerns; `node-pty` is a service-only dep).

### Migration notes

If you have a local checkout from before this release:

```bash
git pull
npm install
npx prisma generate
npm run typecheck   # should be clean now
npm run test
npm run dev
```

The `.env` file format is unchanged (DATABASE_URL still optional). If you
relied on the hardcoded `/home/z/my-project` path, set
`ALPHA_PROJECT_ROOT` in `.env` to your repo path.

---

## [0.2.0] — AGI-like system: episodic memory, metrics, constraints, micro-agents

(Prior release — see git history.)
