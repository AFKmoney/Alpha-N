// Tests for the objective reward model — ensures the AI is graded on
// verifiable outcomes, not its own self-reported coherence.
import { describe, it, expect } from "vitest";
import {
  computeReward,
  aggregateKindStats,
  helpfulness,
  type RewardSignals,
} from "@/lib/alpha/reward-model";

describe("reward-model — computeReward", () => {
  it("returns +1 for a user upvote (strongest signal)", () => {
    expect(computeReward({ userVote: "up" })).toBe(1);
  });

  it("returns -1 for a user downvote", () => {
    expect(computeReward({ userVote: "down" })).toBe(-1);
  });

  it("returns a strong negative for a rollback", () => {
    expect(computeReward({ rolledBack: true })).toBe(-0.8);
  });

  it("returns a mild negative for a policy/security block", () => {
    expect(computeReward({ blocked: true })).toBe(-0.2);
  });

  it("returns a real negative for a tool error", () => {
    expect(computeReward({ toolError: true })).toBe(-0.5);
  });

  it("returns a mild positive for a successful tool call", () => {
    expect(computeReward({ toolOk: true })).toBe(0.4);
  });

  it("returns neutral (0) for cognitive-only actions", () => {
    expect(computeReward({})).toBe(0);
  });

  it("prioritises user vote over other signals", () => {
    // Even if the action rolled back AND errored, a user upvote wins.
    expect(computeReward({ userVote: "up", rolledBack: true, toolError: true })).toBe(1);
    expect(computeReward({ userVote: "down", toolOk: true })).toBe(-1);
  });

  it("prioritises rollback over tool success", () => {
    expect(computeReward({ rolledBack: true, toolOk: true })).toBe(-0.8);
  });

  it("clamps all rewards to [-1, 1]", () => {
    const signals: RewardSignals[] = [
      { userVote: "up" },
      { userVote: "down" },
      { rolledBack: true },
      { toolOk: true },
      { toolError: true },
      { blocked: true },
      {},
    ];
    for (const s of signals) {
      const r = computeReward(s);
      expect(r).toBeGreaterThanOrEqual(-1);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe("reward-model — helpfulness classification", () => {
  it("classifies strongly positive rewards as helpful", () => {
    expect(helpfulness(0.4)).toBe("helpful");
    expect(helpfulness(1)).toBe("helpful");
  });

  it("classifies strongly negative rewards as harmful", () => {
    expect(helpfulness(-0.3)).toBe("harmful");
    expect(helpfulness(-1)).toBe("harmful");
  });

  it("classifies middling rewards as neutral", () => {
    expect(helpfulness(0)).toBe("neutral");
    expect(helpfulness(0.2)).toBe("neutral");
    expect(helpfulness(-0.2)).toBe("neutral");
  });
});

describe("reward-model — aggregateKindStats", () => {
  it("groups entries by kind and averages their reward", () => {
    const entries = [
      { kind: "write_file", reward: 0.4 },
      { kind: "write_file", reward: -0.5 },
      { kind: "execute_code", reward: 0.4 },
      { kind: "write_file", reward: 0.4 },
    ];
    const stats = aggregateKindStats(entries);
    const writeFile = stats.find((s) => s.kind === "write_file")!;
    expect(writeFile.count).toBe(3);
    expect(writeFile.avgReward).toBeCloseTo(0.1, 5);
  });

  it("sorts by descending average reward (best kind first)", () => {
    const entries = [
      { kind: "bad", reward: -0.8 },
      { kind: "good", reward: 0.4 },
      { kind: "good", reward: 0.4 },
    ];
    const stats = aggregateKindStats(entries);
    expect(stats[0].kind).toBe("good");
    expect(stats[stats.length - 1].kind).toBe("bad");
  });

  it("respects the limit parameter", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      kind: `kind${i}`,
      reward: 0.5,
    }));
    const stats = aggregateKindStats(entries, 10);
    // Only the first 10 entries (limit) should be considered.
    const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
    expect(totalCount).toBe(10);
  });

  it("handles empty input", () => {
    expect(aggregateKindStats([])).toEqual([]);
  });
});
