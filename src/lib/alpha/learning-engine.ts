// ============================================================
// Alpha-N — Learning Engine
//
// This is the piece that CLOSES the learning loop. Before it existed,
// the organism recorded objective rewards but never *acted* on them —
// the AI could repeat a failing strategy forever because nothing in its
// next-cycle prompt said "that keeps failing, try something else".
//
// The engine consumes the recent episode log (the objective, per-action
// reward trail) and produces a compact, ACTIONABLE lesson block:
//
//   • What's working  — strategies with a high average reward → keep.
//   • What's failing  — strategies with repeated negative reward →
//     STOP doing them the same way; the block names the failing kind
//     and the consecutive failure streak.
//   • The recommendation — one imperative sentence the AI is told to
//     obey THIS cycle ("you've failed write_file 3× in a row via path
//     errors — read the file before writing, or abandon the edit").
//
// The output is injected at the TOP of the think prompt, where the AI
// reads it before deciding anything. Persistent lessons (cross-session
// takeaways) live in the store and are merged in too.
// ============================================================

export interface EpisodeForLearning {
  kind: string;
  description: string;
  result: "ok" | "blocked" | "error";
  reward: number;
}

export interface StrategyStat {
  kind: string;
  count: number;
  avgReward: number;
  /** Current streak of non-ok results (error/blocked). Resets on ok. */
  failStreak: number;
  lastResult: "ok" | "blocked" | "error";
}

export interface LessonBlock {
  /** What's working — top strategies by average reward. */
  working: StrategyStat[];
  /** What's failing — strategies with a failure streak >= 2. */
  failing: StrategyStat[];
  /** A single imperative recommendation for this cycle. */
  recommendation: string;
  /** True when there's enough history to say anything meaningful. */
  hasSignal: boolean;
}

/** A persistent takeaway that survives across cycles/sessions. */
export interface PersistedLesson {
  id: string;
  text: string;
  /** How strongly the engine should surface it. */
  weight: number;
  createdAt: number;
}

/**
 * Compute per-strategy stats from the episode log, including the
 * consecutive-failure streak for each action kind. Episodes are expected
 * newest-first (as the store holds them).
 */
export function computeStrategyStats(
  episodes: EpisodeForLearning[],
  window = 40
): StrategyStat[] {
  const recent = episodes.slice(0, window);
  // Reverse to walk oldest → newest so streaks are computed in order.
  const ordered = [...recent].reverse();
  const map = new Map<string, StrategyStat>();

  for (const e of ordered) {
    const cur = map.get(e.kind) ?? {
      kind: e.kind,
      count: 0,
      avgReward: 0,
      failStreak: 0,
      lastResult: e.result,
    };
    const totalReward = cur.avgReward * cur.count + e.reward;
    cur.count += 1;
    cur.avgReward = totalReward / cur.count;
    if (e.result === "ok") {
      cur.failStreak = 0;
    } else {
      cur.failStreak += 1;
    }
    cur.lastResult = e.result;
    map.set(e.kind, cur);
  }

  return Array.from(map.values()).sort((a, b) => b.avgReward - a.avgReward);
}

/**
 * Turn the stats into a lesson block: what to keep doing, what to stop,
 * and one imperative recommendation for the upcoming cycle.
 */
export function buildLesson(episodes: EpisodeForLearning[]): LessonBlock {
  const stats = computeStrategyStats(episodes);
  if (stats.length === 0 || episodes.length < 3) {
    return {
      working: [],
      failing: [],
      recommendation:
        "Not enough history yet. Act, and the engine will start telling you what works.",
      hasSignal: false,
    };
  }

  const working = stats.filter((s) => s.avgReward > 0.1).slice(0, 3);
  const failing = stats
    .filter((s) => s.failStreak >= 2)
    .sort((a, b) => b.failStreak - a.failStreak);

  // Build the recommendation. The strongest signal is a long failure
  // streak — name it and demand a different approach.
  let recommendation: string;
  const worst = failing[0];
  if (worst && worst.failStreak >= 2) {
    const approaches = failureHint(worst.kind);
    recommendation = `⚠ STOP repeating "${worst.kind}" the same way — it has failed ${worst.failStreak}× in a row. ${approaches} If it fails again, abandon that line of work for now.`;
  } else if (working.length > 0) {
    recommendation = `✓ "${working[0].kind}" is your highest-reward strategy (avg reward ${working[0].avgReward.toFixed(2)}). Lean into it this cycle, but vary the target so you don't loop.`;
  } else {
    recommendation =
      "No strong signal yet. Try a small, reversible action and observe the reward.";
  }

  return { working, failing, recommendation, hasSignal: true };
}

/** Map a failing action kind to a concrete alternative approach. */
function failureHint(kind: string): string {
  switch (kind) {
    case "write_file":
    case "replace_code":
    case "insert_code":
      return "Read the target file first and confirm the path is correct before editing.";
    case "execute_code":
      return "Test a smaller snippet in isolation before committing to the full version.";
    case "run_terminal":
      return "Check the command syntax and whether the tool is installed before running.";
    case "delete_file":
      return "Verify the path exists and isn't protected before deleting.";
    case "create_app_from_code":
      return "Validate the code compiles before asking to install it as an app.";
    default:
      return "Try a fundamentally different approach to the same goal.";
  }
}

/**
 * Render the lesson block as a compact, high-salience prompt section.
 * This goes at the TOP of the state so the AI reads its own feedback
 * before deciding what to do.
 */
export function renderLessonPrompt(
  lesson: LessonBlock,
  persisted: PersistedLesson[]
): string {
  const lines: string[] = [];

  lines.push("### FEEDBACK FROM YOUR LAST CYCLES — READ THIS FIRST");
  lines.push(lesson.recommendation);
  lines.push("");

  if (lesson.hasSignal) {
    if (lesson.working.length > 0) {
      lines.push("Strategies that are WORKING (keep doing, vary target):");
      for (const s of lesson.working) {
        lines.push(`  ✓ ${s.kind} — avg reward ${s.avgReward.toFixed(2)} over ${s.count} tries`);
      }
      lines.push("");
    }
    if (lesson.failing.length > 0) {
      lines.push("Strategies that are FAILING (change approach or stop):");
      for (const s of lesson.failing) {
        lines.push(`  ✗ ${s.kind} — failed ${s.failStreak}× in a row (last: ${s.lastResult})`);
      }
      lines.push("");
    }
  }

  if (persisted.length > 0) {
    lines.push("Persistent lessons you internalised (do not forget):");
    for (const l of persisted.slice(0, 6)) {
      lines.push(`  • ${l.text}`);
    }
  }

  return lines.join("\n");
}

/**
 * Given a fresh episode outcome, derive a persistent lesson to remember
 * when the pattern is extreme (e.g. a strategy failed many times, or the
 * user explicitly downvoted). Returns null when nothing is worth saving.
 */
export function derivePersistedLesson(
  lesson: LessonBlock,
  episodes: EpisodeForLearning[]
): PersistedLesson | null {
  if (!lesson.hasSignal) return null;
  const worst = lesson.failing[0];
  // Only persist when a strategy has failed 4+ times — that's a clear
  // "this approach is wrong" signal worth remembering across sessions.
  if (worst && worst.failStreak >= 4) {
    return {
      id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: `"${worst.kind}" repeatedly failed (${worst.failStreak}×). ${failureHint(worst.kind)}`,
      weight: worst.failStreak,
      createdAt: Date.now(),
    };
  }
  // Look for a sudden recovery — if the most recent episode turned a
  // long failure around, capture the win so it's reinforced.
  const latest = episodes[0];
  if (latest && latest.result === "ok" && latest.reward >= 0.4) {
    return {
      id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: `"${latest.kind}" succeeded: ${latest.description.slice(0, 80)}`,
      weight: 1,
      createdAt: Date.now(),
    };
  }
  return null;
}
