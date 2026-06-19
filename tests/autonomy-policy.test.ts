// Tests for the autonomy policy engine — the central guard rail that decides
// what the AI may do under each trust level. Fail-closed behaviour and the
// kernel-protection invariant are the most important properties here.
import { describe, it, expect } from "vitest";
import {
  AUTONOMY_POLICIES,
  getPolicy,
  authorize,
  isConsequential,
  DEFAULT_AUTONOMY_LEVEL,
} from "@/lib/alpha/autonomy-policy";

describe("autonomy-policy — policy lookup", () => {
  it("returns the moderate policy by default", () => {
    expect(DEFAULT_AUTONOMY_LEVEL).toBe("moderate");
    expect(getPolicy("moderate").level).toBe("moderate");
  });

  it("falls back to moderate for an unknown level", () => {
    // @ts-expect-error — deliberately invalid level
    expect(getPolicy("nonsense").level).toBe("moderate");
  });

  it("exposes all three switchable levels", () => {
    expect(Object.keys(AUTONOMY_POLICIES).sort()).toEqual([
      "moderate",
      "sandbox",
      "yolo",
    ]);
  });
});

describe("autonomy-policy — fail closed on unknown mutations", () => {
  const levels = ["sandbox", "moderate", "yolo"] as const;
  for (const level of levels) {
    it(`denies unknown mutation type under ${level}`, () => {
      const verdict = authorize("destroy_everything", getPolicy(level));
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain("unknown");
    });
  }
});

describe("autonomy-policy — sandbox is read-only", () => {
  const policy = getPolicy("sandbox");

  it("denies every destructive/consequential capability", () => {
    expect(policy.capabilities.fileWrite).toBe(false);
    expect(policy.capabilities.fileDelete).toBe(false);
    expect(policy.capabilities.runTerminal).toBe(false);
    expect(policy.capabilities.executeCode).toBe(false);
    expect(policy.capabilities.selfPrompt).toBe(false);
    expect(policy.capabilities.execNetwork).toBe(false);
  });

  it("denies write_file, delete_file, execute_code, run_terminal, set_system_prompt", () => {
    for (const kind of [
      "write_file",
      "delete_file",
      "execute_code",
      "run_terminal",
      "set_system_prompt",
      "create_app_from_code",
      "replace_code",
    ]) {
      expect(authorize(kind, policy).allowed).toBe(false);
    }
  });

  it("still allows safe cognitive mutations (read, log, plan, search, speak)", () => {
    for (const kind of [
      "read_file",
      "list_directory",
      "web_search",
      "add_log",
      "create_plan",
      "add_memory",
      "speak",
      "debate",
      "compile",
      "navigate_graph",
    ]) {
      expect(authorize(kind, policy).allowed, `${kind} should be allowed`).toBe(true);
    }
  });
});

describe("autonomy-policy — moderate allows writes but gates self-prompt + network", () => {
  const policy = getPolicy("moderate");

  it("allows file writes and sandboxed exec", () => {
    expect(authorize("write_file", policy).allowed).toBe(true);
    expect(authorize("execute_code", policy).allowed).toBe(true);
    expect(authorize("run_terminal", policy).allowed).toBe(true);
    expect(authorize("delete_file", policy).allowed).toBe(true);
  });

  it("denies self-prompt rewrite (needs yolo)", () => {
    const v = authorize("set_system_prompt", policy);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("self-prompt");
  });

  it("does not grant network egress", () => {
    expect(policy.capabilities.execNetwork).toBe(false);
  });
});

describe("autonomy-policy — yolo grants full reach", () => {
  const policy = getPolicy("yolo");

  it("allows every consequential kind including self-prompt", () => {
    for (const kind of [
      "write_file",
      "delete_file",
      "execute_code",
      "run_terminal",
      "set_system_prompt",
      "create_app_from_code",
    ]) {
      expect(authorize(kind, policy).allowed, `${kind} should be allowed`).toBe(true);
    }
  });

  it("grants network egress", () => {
    expect(policy.capabilities.execNetwork).toBe(true);
  });
});

describe("autonomy-policy — isConsequential classification", () => {
  it("flags filesystem + exec + self-prompt mutations as consequential", () => {
    for (const kind of [
      "write_file",
      "delete_file",
      "run_terminal",
      "execute_code",
      "set_system_prompt",
      "create_app_from_code",
      "replace_code",
      "commit_evolution",
    ]) {
      expect(isConsequential(kind), `${kind}`).toBe(true);
    }
  });

  it("does not flag cognitive/read-only mutations as consequential", () => {
    for (const kind of [
      "read_file",
      "list_directory",
      "add_log",
      "speak",
      "create_plan",
      "web_search",
      "set_state",
      "update_metric",
    ]) {
      expect(isConsequential(kind), `${kind}`).toBe(false);
    }
  });
});
