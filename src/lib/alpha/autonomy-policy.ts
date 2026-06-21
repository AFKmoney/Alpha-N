// ============================================================
// Alpha-N — Autonomy Policy Engine
//
// Three switchable trust levels governing what the AI may do without
// asking. Activated from the desktop (Control Center) at runtime.
//
//   sandbox  — read-only + safe observations. No FS writes, no exec,
//              no self-prompt mutation. The AI can think, log, search,
//              plan, and speak — nothing destructive.
//   moderate — default. FS writes + exec allowed but sandboxed (no env
//              leakage, no network egress from spawned code). Self-prompt
//              changes require council approval. Destructive ops
//              (delete_file, run_terminal) are logged + rate-limited.
//   yolo     — full autonomy. Everything the AI emits runs, including
//              unsandboxed exec, self-prompt rewrites, and destructive
//              ops. Kernel files stay protected regardless (sacred).
//
// The kernel SECURITY_FOUNDATION is enforced separately and is NEVER
// bypassable — even yolo cannot rewrite kernel/*. The policy here only
// governs the AI's reach into its own non-kernel surface.
// ============================================================

export type AutonomyLevel = "sandbox" | "moderate" | "yolo";

export interface AutonomyPolicy {
  level: AutonomyLevel;
  /** Human-readable label for the UI. */
  label: string;
  /** One-line description of what the AI may do. */
  description: string;
  /** Accent colour used in the control-center chip (oklch). */
  accent: string;
  /** Per-capability toggles derived from the level. */
  capabilities: AutonomyCapabilities;
}

export interface AutonomyCapabilities {
  /** May the AI rewrite non-kernel source files? */
  fileWrite: boolean;
  /** May the AI delete files / directories? */
  fileDelete: boolean;
  /** May the AI run shell commands via the terminal? */
  runTerminal: boolean;
  /** May the AI execute generated code? (always sandboxed when true) */
  executeCode: boolean;
  /** May spawned code reach the network? (yolo only) */
  execNetwork: boolean;
  /** May the AI rewrite its own system prompt? */
  selfPrompt: boolean;
  /** Must council debate approve before consequential mutations? */
  councilGate: boolean;
  /** Should every consequential action be logged to the audit trail? */
  auditLog: boolean;
  /** Rate limit: max consequential actions per minute (0 = unlimited). */
  actionsPerMinute: number;
}

export const AUTONOMY_POLICIES: Record<AutonomyLevel, AutonomyPolicy> = {
  sandbox: {
    level: "sandbox",
    label: "Bac à sable",
    description:
      "Lecture seule + observation. Aucune écriture, aucun exec. L'IA réfléchit, planifie et discute — rien de destructeur.",
    accent: "oklch(0.82 0.17 195)",
    capabilities: {
      fileWrite: false,
      fileDelete: false,
      runTerminal: false,
      executeCode: false,
      execNetwork: false,
      selfPrompt: false,
      councilGate: true,
      auditLog: true,
      actionsPerMinute: 30,
    },
  },
  moderate: {
    level: "moderate",
    label: "Modéré",
    description:
      "Écritures + exec sandboxé (sans fuite d'env, sans réseau sortant). Le council doit valider les changements de system prompt. Opérations destructrices journalisées.",
    accent: "oklch(0.82 0.16 85)",
    capabilities: {
      fileWrite: true,
      fileDelete: true,
      runTerminal: true,
      executeCode: true,
      execNetwork: false,
      selfPrompt: false,
      councilGate: true,
      auditLog: true,
      actionsPerMinute: 20,
    },
  },
  yolo: {
    level: "yolo",
    label: "YOLO",
    description:
      "Autonomie totale. Exec non sandboxé, réseau autorisé, self-prompt libre. Le kernel reste sacré quoi qu'il arrive. À utiliser avec conscience.",
    accent: "oklch(0.7 0.22 20)",
    capabilities: {
      fileWrite: true,
      fileDelete: true,
      runTerminal: true,
      executeCode: true,
      execNetwork: true,
      selfPrompt: true,
      councilGate: false,
      auditLog: true,
      actionsPerMinute: 0,
    },
  },
};

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "moderate";

export function getPolicy(level: AutonomyLevel): AutonomyPolicy {
  return AUTONOMY_POLICIES[level] ?? AUTONOMY_POLICIES.moderate;
}

/**
 * Mutation kinds that this policy engine considers "consequential" —
 * i.e. they touch the filesystem, spawn processes, or alter the AI's
 * own cognition. Used for gating, rate limiting, and audit logging.
 */
export const CONSEQUENTIAL_MUTATION_KINDS = new Set([
  "write_file",
  "delete_file",
  "create_sector",
  "create_vector",
  "run_terminal",
  "execute_code",
  "set_system_prompt",
  "create_app_from_code",
  "replace_code",
  "insert_code",
  "commit_evolution",
]);

export function isConsequential(mutationType: string): boolean {
  return CONSEQUENTIAL_MUTATION_KINDS.has(mutationType);
}

/**
 * Decide whether a mutation type is permitted under the given policy.
 * Returns { allowed, reason } — reason is null when allowed, a short
 * human-readable explanation otherwise (surfaced to the AI as a log).
 */
export function authorize(
  mutationType: string,
  policy: AutonomyPolicy,
  /**
   * Optional context for mutations whose authorisation depends on their
   * arguments. Currently only `set_autonomy_level` uses it (`{ target }` =
   * the level the AI wants to switch TO). All other mutations ignore it.
   */
  args?: { target?: string }
): { allowed: boolean; reason: string | null } {
  const caps = policy.capabilities;
  const deny = (reason: string) => ({ allowed: false, reason });
  const allow = () => ({ allowed: true, reason: null });

  switch (mutationType) {
    case "write_file":
    case "create_sector":
    case "create_vector":
    case "create_app_from_code":
    case "replace_code":
    case "insert_code":
    case "commit_evolution":
      return caps.fileWrite ? allow() : deny(`Policy [${policy.level}]: file writes disabled`);

    case "delete_file":
      return caps.fileDelete ? allow() : deny(`Policy [${policy.level}]: file deletion disabled`);

    case "run_terminal":
      return caps.runTerminal ? allow() : deny(`Policy [${policy.level}]: terminal disabled`);

    case "execute_code":
      return caps.executeCode ? allow() : deny(`Policy [${policy.level}]: code execution disabled`);

    case "set_system_prompt":
      return caps.selfPrompt
        ? allow()
        : deny(`Policy [${policy.level}]: self-prompt rewrite disabled (needs council or yolo)`);

    // These are always safe (read-only / cognitive) under any policy.
    case "read_file":
    case "list_directory":
    case "navigate_graph":
    case "web_search":
    case "add_memory":
    case "add_intention":
    case "resolve_intention":
    case "create_plan":
    case "advance_plan":
    case "abandon_plan":
    case "add_goal":
    case "debate":
    case "compile":
    case "set_state":
    case "set_agent":
    case "set_active_agent":
    case "add_log":
    case "update_metric":
    case "speak":
    case "rollback":
    case "create_app":
    case "close_app":
    case "focus_app":
    case "move_window":
    case "snap_window":
    case "set_theme":
    case "set_wallpaper":
    case "create_wallpaper":
    case "minimize_all":
    case "set_always_on_top":
    case "switch_desktop":
    case "pin_to_taskbar":
    case "unpin_from_taskbar":
    case "pin_to_desktop":
    case "set_generation":
    case "set_version":
      return allow();

    // ---- Self-control ----
    // The AI may freely DE-ESCALATE (active→standby, yolo→moderate) and
    // set its mode. ESCALATING the trust LEVEL is the dangerous one: we
    // refuse a self-driven jump to yolo unless yolo is already active,
    // so the AI can never grant itself new powers it didn't already have.
    case "set_autonomy_mode":
      return allow();
    case "set_autonomy_level": {
      // target is the level the AI wants to switch TO. We only block an
      // escalation INTO yolo when the current policy isn't already yolo.
      const target = (args?.target ?? "sandbox") as AutonomyLevel;
      if (target === "yolo" && policy.level !== "yolo") {
        return deny(
          `Policy [${policy.level}]: the AI cannot self-escalate to yolo — only the user can grant that.`
        );
      }
      return allow();
    }
    // Hot-reloading the engine is consequential but not destructive — it
    // lets the AI swap its own brain (e.g. load a freshly-downloaded model).
    // Allowed under any level where file writes are permitted; otherwise
    // blocked so the AI can't thrash the engine in sandbox mode.
    case "reload_engine":
      return caps.fileWrite
        ? allow()
        : deny(`Policy [${policy.level}]: engine reload needs write capability`);

    default:
      // Unknown mutation kind — refuse by default (fail closed).
      return deny(`Policy: unknown mutation type "${mutationType}" — refused (fail-closed)`);
  }
}
