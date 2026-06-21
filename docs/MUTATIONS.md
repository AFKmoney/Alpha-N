# Mutation Reference

The AI communicates with the OS exclusively through **mutations** — a
discriminated union defined in [`src/lib/alpha/mutations.ts`](../src/lib/alpha/mutations.ts).
The LLM emits a JSON array of them each cycle; the autonomous loop applies
each one after authorising it.

This file is the canonical list. If you add or change a mutation, update:
1. the `Mutation` union in `mutations.ts`,
2. the `authorize()` switch in `autonomy-policy.ts`,
3. the dispatch in `autonomous-loop.tsx`,
4. the mutation documentation block in `think/route.ts`,
5. this table,
6. a test in `tests/`.

## Policy columns

- **Allowed in** — which autonomy levels permit it (`S`=sandbox, `M`=moderate,
  `Y`=yolo). `all` = every level.
- **Consequential** — counts toward the per-minute rate limit and is audited.

## Cognitive (always allowed, not rate-limited)

| Mutation | Args | Effect |
|----------|------|--------|
| `set_state` | `state: AiState` | Sets the AI's displayed state (observing, self-improving…). |
| `set_active_agent` | `role: AgentRole \| null` | Focuses a council agent. |
| `set_agent` | `role, status?, thought?, load?` | Updates an agent's status/thought/load. |
| `add_log` | `level, agent, message` | Appends to the stream of consciousness. |
| `update_metric` | `key, delta` | Adjusts a metric (cosmetic; reward is computed objectively). |
| `speak` | `message` | Broadcasts a spoken message. |
| `debate` | `proposal, opinions[]` | Runs a council debate. |
| `compile` | `check` | Triggers a real tsc/eslint check. |
| `rollback` | `snapshotId, reason` | Restores a prior OS snapshot. |

## Memory — Akasha (always allowed)

| Mutation | Args | Effect |
|----------|------|--------|
| `add_memory` | `kind, text` | Stores a long-term memory. |
| `add_intention` | `text, priority` | Records an active intention. |
| `resolve_intention` | `id` | Marks an intention resolved. |
| `create_plan` | `goal, rationale, steps[]` | Creates an active plan. |
| `advance_plan` | `id, stepIndex` | Marks a plan step done. |
| `abandon_plan` | `id` | Drops a plan. |
| `add_goal` | `text, level` | Adds a goal. |

## Filesystem

| Mutation | Args | Allowed in | Consequential |
|----------|------|------------|---------------|
| `read_file` | `path` | all | no |
| `list_directory` | `path` | all | no |
| `navigate_graph` | `path` | all | no |
| `write_file` | `path, content` | M, Y | yes |
| `delete_file` | `path` | M, Y | yes |
| `create_sector` | `path` (= mkdir) | M, Y | yes |
| `create_vector` | `path` (= touch) | M, Y | yes |

All paths are project-relative and run through `resolveSafe()` (path-traversal
proof). Kernel paths are always refused.

## Code & evolution

| Mutation | Args | Allowed in | Consequential |
|----------|------|------------|---------------|
| `replace_code` | `lines[], note?` | M, Y | yes |
| `insert_code` | `lines[], note?` | M, Y | yes |
| `commit_evolution` | `description, lines[]` | M, Y | yes |
| `create_app_from_code` | `name, code, description?, category?` | M, Y | yes |

Code mutations are validated (`validateCodeLines`) for brace balance before
application; invalid code is rejected and rolled back.

## Execution & tools

| Mutation | Args | Allowed in | Consequential |
|----------|------|------------|---------------|
| `execute_code` | `code, language` | M, Y | yes |
| `run_terminal` | `command` | M, Y | yes |
| `web_search` | `query` | all | no |

`execute_code` runs in an isolated directory outside the project, with a
minimal environment (no `process.env` leakage). Network egress is gated to
YOLO mode.

## UI

| Mutation | Args | Allowed in |
|----------|------|------------|
| `create_app` | `kind` | all |
| `close_app` | `windowId` | all |
| `focus_app` | `windowId` | all |
| `move_window` | `windowId, x, y` | all |
| `snap_window` | `windowId, snap` | all |
| `set_theme` | `theme: "dark" \| "light"` | all |
| `set_wallpaper` | `presetId` | all |
| `create_wallpaper` | `name, description, colors[]` | all |
| `minimize_all` | — | all |
| `set_always_on_top` | `windowId, onTop` | all |
| `switch_desktop` | `desktop` | all |
| `pin_to_taskbar` / `unpin_from_taskbar` | `kind` | all |
| `pin_to_desktop` | `kind` | all |
| `set_generation` / `set_version` | value | all |

## Self-control

| Mutation | Args | Allowed in | Consequential |
|----------|------|------------|---------------|
| `set_autonomy_mode` | `mode: "standby" \| "active"` | all | yes |
| `set_autonomy_level` | `level: "sandbox" \| "moderate" \| "yolo"` | all* | yes |
| `reload_engine` | `model?` | M, Y | yes |

\* `set_autonomy_level` is **always checked for escalation**: the AI may
de-escalate freely, but a jump **to yolo** is denied unless the current level
is already yolo. The AI can never grant itself powers it didn't already have —
only the user (or an existing yolo session) can escalate.

`reload_engine` hot-swaps the GGUF model at runtime via the Aether's
`/admin/reload` endpoint. Lets the AI swap its own brain.
