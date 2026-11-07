// Tests for the learning engine — the module that CLOSES the loop by turning
// the objective reward trail into actionable feedback the AI must obey.
// These verify the core guarantee: a repeating failure produces a "stop"
// recommendation, and a repeating success produces a "lean in" one.
import { describe, it, expect } from "vitest";
import {
  computeStrategyStats,
  buildLesson,
  renderLessonPrompt,
  derivePersistedLesson,
  type EpisodeForLearning,
} from "@/lib/alpha/learning-engine";

// Helper: build an episode with sensible defaults.
function ep(
  kind: string,
  result: "ok" | "blocked" | "error",
  reward: number,
  description = ""
): EpisodeForLearning {
  return { kind, result, reward, description };
}

describe("learning-engine — computeStrategyStats", () => {
  it("returns empty for no episodes", () => {
    expect(computeStrategyStats([])).toEqual([]);
  });

  it("groups episodes by kind and averages reward", () => {
    // newest-first, as the store holds them
    const stats = computeStrategyStats([
      ep("write_file", "ok", 0.4),
      ep("write_file", "error", -0.5),
    ]);
    const wf = stats.find((s) => s.kind === "write_file")!;
    expect(wf.count).toBe(2);
    expect(wf.avgReward).toBeCloseTo(-0.05, 5);
  });

  it("tracks a failure streak that resets on success", () => {
    // Order oldest→newest is enforced internally (we reverse), so pass newest-first.
    const stats = computeStrategyStats([
      ep("run_terminal", "ok", 0.4), // newest — breaks the streak
      ep("run_terminal", "error", -0.5),
      ep("run_terminal", "error", -0.5),
      ep("run_terminal", "error", -0.5),
    ]);
    const rt = stats.find((s) => s.kind === "run_terminal")!;
    expect(rt.failStreak).toBe(0);
    expect(rt.lastResult).toBe("ok");
  });

  it("keeps the streak when failures continue", () => {
    const stats = computeStrategyStats([
      ep("execute_code", "error", -0.5), // newest
      ep("execute_code", "error", -0.5),
      ep("execute_code", "error", -0.5),
    ]);
    const ec = stats.find((s) => s.kind === "execute_code")!;
    expect(ec.failStreak).toBe(3);
    expect(ec.lastResult).toBe("error");
  });
});

describe("learning-engine — buildLesson (the recommendation)", () => {
  it("produces no strong signal with too few episodes", () => {
    const lesson = buildLesson([ep("write_file", "ok", 0.4)]);
    expect(lesson.hasSignal).toBe(false);
  });

  it("emits a STOP recommendation when a strategy fails repeatedly", () => {
    const lesson = buildLesson([
      ep("write_file", "error", -0.5), // newest
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
    ]);
    expect(lesson.hasSignal).toBe(true);
    expect(lesson.recommendation).toMatch(/STOP/i);
    expect(lesson.recommendation).toContain("write_file");
    expect(lesson.failing.length).toBeGreaterThan(0);
    expect(lesson.failing[0].failStreak).toBe(3);
  });

  it("emits a LEAN-IN recommendation when a strategy succeeds most", () => {
    const lesson = buildLesson([
      ep("add_memory", "ok", 0.4), // newest
      ep("add_memory", "ok", 0.4),
      ep("add_memory", "ok", 0.4),
    ]);
    expect(lesson.hasSignal).toBe(true);
    // add_memory is cognitive-only (reward stays 0 from computeReward, but
    // here we feed synthetic rewards). With 0.4 avg it should surface as working.
    expect(lesson.working.length).toBeGreaterThan(0);
    expect(lesson.failing.length).toBe(0);
  });

  it("includes a concrete alternative hint in the stop message", () => {
    const lesson = buildLesson([
      ep("execute_code", "error", -0.5),
      ep("execute_code", "error", -0.5),
      ep("execute_code", "error", -0.5),
    ]);
    // execute_code hint says to test a smaller snippet.
    expect(lesson.recommendation.toLowerCase()).toContain("snippet");
  });

  it("handles blocked results as failures for streak purposes", () => {
    const lesson = buildLesson([
      ep("delete_file", "blocked", -0.2),
      ep("delete_file", "blocked", -0.2),
      ep("delete_file", "blocked", -0.2),
    ]);
    expect(lesson.failing[0].failStreak).toBe(3);
  });
});

describe("learning-engine — renderLessonPrompt", () => {
  it("always includes the recommendation", () => {
    const lesson = buildLesson([
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
    ]);
    const text = renderLessonPrompt(lesson, []);
    expect(text).toContain("FEEDBACK FROM YOUR LAST CYCLES");
    expect(text).toContain("write_file");
  });

  it("appends persistent lessons when present", () => {
    const lesson = buildLesson([ep("speak", "ok", 0), ep("speak", "ok", 0), ep("speak", "ok", 0)]);
    const text = renderLessonPrompt(lesson, [
      { id: "l1", text: "Always read before writing", weight: 5, createdAt: 0 },
    ]);
    expect(text).toContain("Always read before writing");
    expect(text).toContain("Persistent lessons");
  });

  it("lists working and failing strategies separately", () => {
    const lesson = buildLesson([
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
      ep("add_memory", "ok", 0.4),
      ep("add_memory", "ok", 0.4),
    ]);
    const text = renderLessonPrompt(lesson, []);
    expect(text).toContain("WORKING");
    expect(text).toContain("FAILING");
  });
});

describe("learning-engine — derivePersistedLesson", () => {
  it("persists a lesson after 4+ consecutive failures", () => {
    const episodes: EpisodeForLearning[] = [
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
    ];
    const lesson = buildLesson(episodes);
    const derived = derivePersistedLesson(lesson, episodes);
    expect(derived).not.toBeNull();
    expect(derived!.text).toContain("write_file");
  });

  it("does NOT persist for short failure streaks (< 4)", () => {
    const episodes: EpisodeForLearning[] = [
      ep("write_file", "error", -0.5),
      ep("write_file", "error", -0.5),
    ];
    const lesson = buildLesson(episodes);
    const derived = derivePersistedLesson(lesson, episodes);
    expect(derived).toBeNull();
  });

  it("captures a strong recent success as a lesson", () => {
    const episodes: EpisodeForLearning[] = [
      ep("create_plan", "ok", 0.4, "designed rollback strategy"), // newest
      ep("create_plan", "error", -0.5),
      ep("create_plan", "error", -0.5),
    ];
    const lesson = buildLesson(episodes);
    const derived = derivePersistedLesson(lesson, episodes);
    expect(derived).not.toBeNull();
    expect(derived!.text).toContain("create_plan");
  });

  it("returns null when there is no signal", () => {
    const derived = derivePersistedLesson(
      { working: [], failing: [], recommendation: "x", hasSignal: false },
      []
    );
    expect(derived).toBeNull();
  });
});
