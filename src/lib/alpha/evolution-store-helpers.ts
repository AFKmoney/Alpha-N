/**
 * evolution-store-helpers.ts — pure helpers, types, and seed constants
 * extracted from evolution-store.ts.
 *
 * These are framework-agnostic: no Zustand, no React, no side effects. They
 * exist so evolution-store.ts (the store factory itself) stays focused on
 * state shape + actions, and so the helpers can be unit-tested in isolation
 * without dragging the whole store into a test.
 *
 * Split out for clarity + testability. The public API of useEvolution is
 * unchanged — these are internal implementation details.
 */

import {
  AGENT_META,
  SEED_VERSION,
  type Agent,
  type AgentRole,
  type AgentStatus,
  type LogEntry,
  type LogLevel,
  type Scenario,
} from "./evolution-data";

/** A scenario currently running through its phases. */
export interface ActiveEvolution {
  scenario: Scenario;
  phase: number;
  startedAt: number;
}

/** Fixed epoch for the *initial* state so SSR and client agree on timestamps. */
export const T0 = 1_704_067_200_000; // 2024-01-01T00:00:00Z

/** Map a log level to the agent status it implies (for the council display). */
export const STATUS_BY_LEVEL: Record<LogLevel, AgentStatus> = {
  observe: "thinking",
  critique: "reviewing",
  hypothesis: "thinking",
  deploy: "deploying",
  evolve: "deploying",
  heal: "optimizing",
};

/** Idle CPU load per agent role (cosmetic, for the council meter). */
export const IDLE_LOAD: Record<AgentRole, number> = {
  architect: 0.12,
  developer: 0.18,
  critic: 0.09,
  optimizer: 0.15,
};

// Module-scoped id counters. Kept here (not in the store) so they persist
// across store re-creations and remain SSR-safe (single source of truth).
let logId = 0;
let mutId = 0;
let chatId = 0;
let memId = 0;
let intId = 0;

/** Build a log entry with a fresh id. */
export function makeLog(
  level: LogLevel,
  agent: AgentRole | "nucleus",
  message: string,
  time: number = T0
): LogEntry {
  return { id: `log-${logId++}`, time, level, agent, message };
}

/** Allocate a fresh mutation id. */
export function nextMutId(): string {
  return `mut-${mutId++}`;
}
/** Allocate a fresh chat id. */
export function nextChatId(): string {
  return `chat-${chatId++}`;
}
/** Allocate a fresh memory id. */
export function nextMemId(): string {
  return `mem-${memId++}`;
}
/** Allocate a fresh intention id. */
export function nextIntId(): string {
  return `int-${intId++}`;
}

/** Increment a semver-like version string (patch → minor → major rollover). */
export function bumpVersion(prev: string): string {
  const parts = prev.split(".").map(Number);
  parts[2] += 1;
  if (parts[2] >= 10) {
    parts[2] = 0;
    parts[1] += 1;
  }
  if (parts[1] >= 10) {
    parts[1] = 0;
    parts[0] += 1;
  }
  return parts.join(".");
}

/** Build the initial council of idle agents from AGENT_META. */
export function idleAgents(): Agent[] {
  return (Object.keys(AGENT_META) as AgentRole[]).map((role) => ({
    role,
    name: AGENT_META[role].name,
    glyph: AGENT_META[role].glyph,
    hue: AGENT_META[role].hue,
    status: "idle" as AgentStatus,
    thought: "Standing by. The Nucleus is calm.",
    load: IDLE_LOAD[role],
  }));
}

/** The seed version history entry (used for the initial state). */
export function seedHistoryEntry() {
  return { ...SEED_VERSION, timestamp: T0 };
}

/** The initial boot log lines. */
export function seedLogs(): LogEntry[] {
  return [
    makeLog("evolve", "nucleus", "N-Core online. Three layers synchronised. The organism is awake."),
    makeLog("observe", "architect", "Surveying own source tree — 312 modules, 0 wounds detected."),
  ];
}

/** The initial AI chat greeting shown when the OS first boots. */
export function seedChat() {
  return [
    {
      id: nextChatId(),
      role: "ai" as const,
      content:
        "I am Alpha-OS. I am in standby mode — I will not code unless you ask me to. Tell me what you want me to do: open an app, search the web, rewrite code, or give me a project to work on. Switch to 'active' mode in the sidebar if you want me to work autonomously.",
      time: T0,
    },
  ];
}
