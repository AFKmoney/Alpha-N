# Contributing to Alpha-N

Thanks for helping the organism evolve. A few rules keep the kernel sacred
and the codebase honest.

## Before you write code

1. **`npm run typecheck`** must pass. The build blocks on type errors now
   (`ignoreBuildErrors` was removed in v2) — no shipping hidden bugs.
2. **`npm run test`** must pass. Add a test for any new pure logic
   (policy gates, path resolution, reward computation, validators).
3. **`npm run lint`** should be clean of warnings you introduced. Existing
   warnings are being paid down incrementally — don't add to the debt.

## Architecture invariants (never break these)

- **The kernel is sacred.** Files under `kernel/` and the entries in
  `SECURITY_FOUNDATION` (`os-types.ts`) are never writable by the AI or by
  a casual refactor. If you must touch them, explain why in the PR.
- **`authorize()` gates everything.** Any new mutation type must be added
  to the `authorize()` switch in `autonomy-policy.ts` with an explicit
  allow/deny per capability. Unknown types fail closed.
- **Exec stays sandboxed.** Never spread `process.env` into spawned code.
  Route through `buildSandboxEnv()` and keep network gated to YOLO.
- **Paths go through `resolveSafe()`.** Never resolve a user/AI-supplied
  path with raw `path.join` — it's a traversal vector.
- **Rewards are objective.** Don't feed the AI's self-reported coherence
  into the reward signal. Use `computeReward()` with verifiable signals.

## Adding a new autonomy capability

1. Add the boolean to `AutonomyCapabilities` in `autonomy-policy.ts`.
2. Set it per level in `AUTONOMY_POLICIES`.
3. Gate any new mutation type in `authorize()`.
4. Add a test in `tests/autonomy-policy.test.ts` for each level.
5. Surface it in the capability checklist in `autonomy-mode-selector.tsx`.

## Adding a new app

1. Add the `AppKind` to `os-types.ts`.
2. Add a `DockApp` entry (label + icon + default size).
3. Add a `case` to `renderAppContent` in `window-manager.tsx`.
4. Wrap any risky render in the existing `AppErrorBoundary`.

## Commits

Conventional-ish prefixes keep the log readable:

- `security:` hardening, guards, sandbox work
- `quality:` type fixes, lint, refactors
- `ui:` / `perf:` interface and performance
- `autonomy:` loop, reward model, policy
- `feat:` new capability
- `fix:` bug fix

Have fun. Build something mythic.
