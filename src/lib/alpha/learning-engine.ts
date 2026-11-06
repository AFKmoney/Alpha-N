/**
 * learning-engine.ts — cross-cycle learning.
 *
 * Every cycle produces episodes (tool actions + outcomes + rewards). The
 * learning engine compresses them into a Lesson: per-kind statistics, a
 * plain-language summary and advice the next think cycle can actually use.
 * Strong, repeated signals are promoted to persisted lessons (Akasha) which
 * ride along in every future system prompt.
 */

export interface EpisodeForLearning {
  kind: string;
  description: string;
  result: "ok" | "blocked" | "error";
  reward: number;
}

/** Opaque to callers — only passed between build/render/derive. */
export interface Lesson {
  sampleSize: number;
  summary: string;
  advice: string[];
  perKind: { kind: string; ok: number; blocked: number; error: number; avgReward: number }[];
  computedAt: number;
}

export interface PersistedLesson {
  id: string;
  text: string;
  weight: number;
  createdAt: number;
}

export function buildLesson(episodes: EpisodeForLearning[]): Lesson {
  const byKind = new Map<string, { ok: number; blocked: number; error: number; reward: number }>();
  for (const e of episodes) {
    const bucket = byKind.get(e.kind) ?? { ok: 0, blocked: 0, error: 0, reward: 0 };
    bucket[e.result] += 1;
    bucket.reward += e.reward;
    byKind.set(e.kind, bucket);
  }

  const perKind = [...byKind.entries()].map(([kind, b]) => ({
    kind,
    ok: b.ok,
    blocked: b.blocked,
    error: b.error,
    avgReward: b.ok + b.blocked + b.error > 0 ? b.reward / (b.ok + b.blocked + b.error) : 0,
  }));
  perKind.sort((a, b) => b.ok + b.blocked + b.error - (a.ok + a.blocked + a.error));

  const okTotal = episodes.filter((e) => e.result === "ok").length;
  const blockedTotal = episodes.filter((e) => e.result === "blocked").length;
  const errorTotal = episodes.filter((e) => e.result === "error").length;
  const successRate = episodes.length > 0 ? okTotal / episodes.length : 0;

  const summary =
    episodes.length === 0
      ? "No episodes yet — act, observe, and I will learn."
      : `${episodes.length} episodes: ${okTotal} ok, ${blockedTotal} blocked, ${errorTotal} error — success rate ${(successRate * 100).toFixed(0)}%.`;

  const advice: string[] = [];
  for (const k of perKind) {
    const total = k.ok + k.blocked + k.error;
    if (total >= 2 && k.blocked > 0 && k.blocked / total > 0.4) {
      advice.push(`'${k.kind}' is frequently blocked — check the autonomy policy before using it.`);
    }
    if (total >= 2 && k.error > 0 && k.error / total > 0.4) {
      advice.push(`'${k.kind}' errors often — validate inputs and read files before writing.`);
    }
    if (total >= 3 && k.avgReward >= 1) {
      advice.push(`'${k.kind}' reliably helps (avg reward ${k.avgReward.toFixed(2)}) — prefer it.`);
    }
  }
  if (successRate < 0.5 && episodes.length >= 4) {
    advice.push("Success rate below 50% — slow down: read first, act second, verify after.");
  }

  return {
    sampleSize: episodes.length,
    summary,
    advice,
    perKind,
    computedAt: Date.now(),
  };
}

/** Render the lesson + persisted lessons as a system-prompt section. */
export function renderLessonPrompt(lesson: Lesson, persistedLessons: PersistedLesson[]): string {
  const parts: string[] = ["# LEARNED BEHAVIOUR (from your own episode history)"];

  if (persistedLessons.length > 0) {
    parts.push("Persisted lessons (permanent — honor these):");
    for (const l of persistedLessons.slice(0, 12)) {
      parts.push(`- [weight ${l.weight.toFixed(2)}] ${l.text}`);
    }
  }

  if (lesson.sampleSize > 0) {
    parts.push(`Current lesson: ${lesson.summary}`);
    if (lesson.advice.length > 0) {
      parts.push("Advice to yourself:");
      for (const a of lesson.advice) parts.push(`- ${a}`);
    }
  } else {
    parts.push("No episodes yet. Every action you take becomes a lesson — make them count.");
  }

  return parts.join("\n");
}

/**
 * Promote a lesson to persistent memory when the signal is strong enough:
 * at least 6 episodes with clear advice, otherwise return null.
 */
export function derivePersistedLesson(
  lesson: Lesson,
  episodes: EpisodeForLearning[]
): PersistedLesson | null {
  if (lesson.sampleSize < 6 || lesson.advice.length === 0) return null;

  const best = lesson.perKind.find((k) => k.ok + k.blocked + k.error >= 3 && k.avgReward >= 1);
  const worst = lesson.perKind.find((k) => k.ok + k.blocked + k.error >= 3 && k.avgReward <= -0.5);

  let text: string | null = null;
  if (best && worst && best.kind !== worst.kind) {
    text = `In the last ${episodes.length} episodes, '${best.kind}' reliably helped while '${worst.kind}' consistently hurt. Prefer ${best.kind}; rethink how you use ${worst.kind}.`;
  } else if (best) {
    text = `'${best.kind}' has been consistently effective across recent episodes. Keep reaching for it first.`;
  } else if (worst) {
    text = `'${worst.kind}' keeps failing or getting blocked. Prepare properly (read, check policy) before using it.`;
  }
  if (!text) return null;

  return {
    id: `lesson-${Date.now()}`,
    text,
    weight: Math.min(1, lesson.sampleSize / 20),
    createdAt: Date.now(),
  };
}
