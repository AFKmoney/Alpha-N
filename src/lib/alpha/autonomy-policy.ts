/**
 * autonomy-policy.ts — the sovereignty layer.
 *
 * Every consequential action the AI takes is checked against the active
 * trust level (sandbox / moderate / yolo). Authorization is enforced twice:
 * here client-side (the loop refuses to run disallowed tools) and again
 * server-side in /api/alpha/files and /api/alpha/exec.
 *
 * The module also keeps the audit journal: every checked action is recorded
 * (in-memory + persisted via the akasha route) and rendered by audit-trail.
 */

export type AutonomyLevel = "sandbox" | "moderate" | "yolo";

export const AUTONOMY_LEVELS: AutonomyLevel[] = ["sandbox", "moderate", "yolo"];

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "moderate";

export interface AutonomyCapabilities {
  /** max AI tool calls per minute — 0 means the level cannot act */
  actionsPerMinute: number;
  /** whether execute_code may reach the network */
  execNetwork: boolean;
  /** whether write_file may touch files outside /tmp */
  writeOutsideTmp: boolean;
  /** whether delete_file may run at all */
  allowDelete: boolean;
  /** whether reload_engine may run */
  allowEngineReload: boolean;
  /** highest level this level may escalate to */
  maxEscalation: AutonomyLevel;
}

export interface Policy {
  level: AutonomyLevel;
  capabilities: AutonomyCapabilities;
  rationale: string;
}

const CAPS: Record<AutonomyLevel, AutonomyCapabilities> = {
  sandbox: {
    actionsPerMinute: 12,
    execNetwork: false,
    writeOutsideTmp: false,
    allowDelete: false,
    allowEngineReload: false,
    maxEscalation: "moderate",
  },
  moderate: {
    actionsPerMinute: 30,
    execNetwork: true,
    writeOutsideTmp: true,
    allowDelete: false,
    allowEngineReload: true,
    maxEscalation: "yolo",
  },
  yolo: {
    actionsPerMinute: 120,
    execNetwork: true,
    writeOutsideTmp: true,
    allowDelete: true,
    allowEngineReload: true,
    maxEscalation: "yolo",
  },
};

const RATIONALE: Record<AutonomyLevel, string> = {
  sandbox: "Read-only exploration. The AI may look, plan and speak, but writes and execution stay offline.",
  moderate: "Full tool surface inside the project. Kernel paths remain sealed; deletes require a human.",
  yolo: "Complete autonomy. The OS trusts itself. Rollbacks are automatic on failure.",
};

const ORDER: Record<AutonomyLevel, number> = { sandbox: 0, moderate: 1, yolo: 2 };

export function getPolicy(level: AutonomyLevel): Policy {
  return {
    level,
    capabilities: CAPS[level] ?? CAPS.moderate,
    rationale: RATIONALE[level] ?? RATIONALE.moderate,
  };
}

/** Actions that must be audited (and debated before execution when disputed). */
const CONSEQUENTIAL = new Set([
  "write_file",
  "execute_code",
  "delete_file",
  "create_sector",
  "create_vector",
  "run_terminal",
  "rollback",
  "set_autonomy_level",
  "set_autonomy_mode",
  "reload_engine",
  "commit_evolution",
  "create_app_from_code",
  "set_system_prompt",
]);

export function isConsequential(action: string): boolean {
  return CONSEQUENTIAL.has(action);
}

const LEVEL_RANK: Record<string, number> = { sandbox: 0, moderate: 1, yolo: 2 };

/**
 * Decide whether `action` may run under `policy`.
 * `args.target` carries the escalation target for set_autonomy_level and the
 * path for file actions.
 */
export function authorize(
  action: string,
  policy: Policy,
  args?: { target?: string }
): { allowed: boolean; reason: string } {
  const caps = policy.capabilities;
  if (caps.actionsPerMinute <= 0) {
    return { allowed: false, reason: "level cannot act (actionsPerMinute=0)" };
  }

  switch (action) {
    case "set_autonomy_level": {
      const target = (args?.target ?? "") as AutonomyLevel;
      if (!LEVEL_RANK.hasOwnProperty(target)) {
        return { allowed: false, reason: `unknown level '${target}'` };
      }
      if (LEVEL_RANK[target] > LEVEL_RANK[caps.maxEscalation]) {
        return {
          allowed: false,
          reason: `escalation to '${target}' exceeds '${policy.level}' authority (max '${caps.maxEscalation}')`,
        };
      }
      return { allowed: true, reason: `escalation to '${target}' within authority` };
    }
    case "execute_code":
      return { allowed: true, reason: "sandboxed execution" };
    case "write_file": {
      const target = args?.target ?? "";
      if (target.startsWith("kernel/") || target.startsWith("src/kernel/")) {
        return { allowed: false, reason: "kernel paths are sovereign" };
      }
      if (!caps.writeOutsideTmp && !target.startsWith("/tmp")) {
        return { allowed: false, reason: "sandbox level may only write under /tmp" };
      }
      return { allowed: true, reason: "write permitted" };
    }
    case "delete_file":
      return caps.allowDelete
        ? { allowed: true, reason: "delete permitted" }
        : { allowed: false, reason: "deletes require 'yolo'" };
    case "reload_engine":
      return caps.allowEngineReload
        ? { allowed: true, reason: "engine reload permitted" }
        : { allowed: false, reason: "engine reload requires 'moderate' or higher" };
    default:
      return { allowed: true, reason: "no restriction" };
  }
}

// ---------------------------------------------------------------------------
// Audit journal — consumed by <AuditTrail />, persisted via /api/alpha/akasha
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  level: AutonomyLevel;
  result: "ok" | "error" | "blocked";
  time: number;
}

const journal: AuditEntry[] = [];
let auditSeq = 0;

export function recordAudit(
  action: string,
  detail: string,
  level: AutonomyLevel,
  result: AuditEntry["result"]
): AuditEntry {
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${++auditSeq}`,
    action,
    detail,
    level,
    result,
    time: Date.now(),
  };
  journal.unshift(entry);
  if (journal.length > 200) journal.length = 200;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("alpha-audit-entry", { detail: entry }));
  }
  return entry;
}

export function getAuditTrail(max = 50): AuditEntry[] {
  return journal.slice(0, max);
}

/** Rank helper for comparisons elsewhere (files route mirrors this order). */
export function levelRank(level: AutonomyLevel): number {
  return ORDER[level] ?? 1;
}
