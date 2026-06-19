// ============================================================
// Alpha-N — Objective Reward Model
//
// The original reward signal was coherence_delta, but coherence was set by
// the AI itself via update_metric — so the organism graded its own
// homework. This module computes an OBJECTIVE reward from verifiable
// signals emitted during a cycle:
//
//   • Did the action's tool call succeed? (exec exit 0, file write ok,
//     compile passed)
//   • Was it blocked by security or the autonomy policy?
//   • Did it trigger a rollback?
//   • Did the user 👍 / 👎 it (the strongest signal)?
//
// The reward is a number in [-1, +1] that the AI sees in its state, so it
// can learn which action TYPES actually help vs. which reliably fail. The
// per-kind rolling average feeds a "what works" table.
// ============================================================

export interface RewardSignals {
  /** Tool call outcome the AI can't fake. */
  toolOk?: boolean; // exec exit 0, file write succeeded, compile passed
  toolError?: boolean;
  /** Blocked by security kernel or autonomy policy. */
  blocked?: boolean;
  /** Triggered an automatic rollback. */
  rolledBack?: boolean;
  /** User explicit feedback (overrides everything else). */
  userVote?: "up" | "down";
}

/** Compute an objective reward from verifiable signals, in [-1, +1]. */
export function computeReward(signals: RewardSignals): number {
  // User vote is the strongest, most reliable signal — trust it absolutely.
  if (signals.userVote === "up") return 1;
  if (signals.userVote === "down") return -1;

  // A rollback means the cycle was deemed harmful — strong negative.
  if (signals.rolledBack) return -0.8;

  // Blocked by policy/security is neutral-negative: the action was refused,
  // so it neither helped nor hurt the system, but it wasted a cycle.
  if (signals.blocked) return -0.2;

  // A tool error (compile failed, exec crashed, write rejected) is a real
  // negative — the AI produced broken work.
  if (signals.toolError) return -0.5;

  // A successful tool call is a mild positive — it did something that ran.
  if (signals.toolOk) return 0.4;

  // Cognitive-only actions (logs, plans, speak) are neutral by default —
  // they carry information but their value is judged by downstream effects.
  return 0;
}

/** Per-kind rolling-average reward, so the AI can see what works. */
export interface KindStats {
  kind: string;
  count: number;
  avgReward: number;
}

/**
 * Aggregate raw reward entries into per-kind rolling stats. Used to build
 * the "reward model" table the AI reads each cycle.
 */
export function aggregateKindStats(
  entries: { kind: string; reward: number }[],
  limit = 100
): KindStats[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const e of entries.slice(0, limit)) {
    const b = buckets.get(e.kind) ?? { sum: 0, count: 0 };
    b.sum += e.reward;
    b.count += 1;
    buckets.set(e.kind, b);
  }
  return Array.from(buckets.entries())
    .map(([kind, b]) => ({
      kind,
      count: b.count,
      avgReward: b.count > 0 ? b.sum / b.count : 0,
    }))
    .sort((a, z) => z.avgReward - a.avgReward);
}

/**
 * Classify a reward into a human-readable helpfulness verdict the AI
 * (and the UI) can display.
 */
export function helpfulness(reward: number): "harmful" | "neutral" | "helpful" {
  if (reward <= -0.3) return "harmful";
  if (reward >= 0.3) return "helpful";
  return "neutral";
}
