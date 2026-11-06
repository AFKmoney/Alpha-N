/**
 * evolution-store-helpers.ts — pure construction helpers for the evolution
 * store: deterministic ids (hydration-safe), seeded logs/chat/history and
 * the small mappers shared between store and UI.
 */
import type {
  Agent,
  AgentStatus,
  AgentRole,
  EvolutionVersion,
  LogEntry,
  LogLevel,
  Scenario,
} from "./evolution-data";
import type { ChatMessage } from "./mutations";

/** Fixed epoch so SSR and client renders agree on every seeded timestamp. */
export const T0: number = 1793900000000;

let mutSeq = 0;
let chatSeq = 0;
let memSeq = 0;
let intSeq = 0;

export const nextMutId = (): string => `mut-${T0}-${(++mutSeq).toString(36)}`;
export const nextChatId = (): string => `chat-${T0}-${(++chatSeq).toString(36)}`;
export const nextMemId = (): string => `mem-${T0}-${(++memSeq).toString(36)}`;
export const nextIntId = (): string => `int-${T0}-${(++intSeq).toString(36)}`;

export const STATUS_BY_LEVEL: Record<LogLevel, AgentStatus> = {
  observe: "thinking",
  critique: "reviewing",
  hypothesis: "thinking",
  deploy: "deploying",
  evolve: "optimizing",
  heal: "writing",
};

export function idleAgents(): Agent[] {
  return [
    { role: "architect", status: "idle", thought: null, load: 0.08 },
    { role: "developer", status: "idle", thought: null, load: 0.05 },
    { role: "critic", status: "idle", thought: null, load: 0.03 },
    { role: "optimizer", status: "idle", thought: null, load: 0.06 },
  ];
}

let logSeq = 0;

export function makeLog(level: LogLevel, agent: AgentRole, message: string, time: number): LogEntry {
  return { id: `log-${T0}-${(++logSeq).toString(36)}`, time, level, agent, message };
}

/** "0.2.1" → "0.2.2", "1.9.9" → "1.10.0" */
export function bumpVersion(version: string): string {
  const parts = version.split(".").map((n) => parseInt(n, 10) || 0);
  parts[2] = (parts[2] ?? 0) + 1;
  if (parts[2] >= 10) {
    parts[2] = 0;
    parts[1] = (parts[1] ?? 0) + 1;
  }
  return parts.join(".");
}

export function seedHistoryEntry(): EvolutionVersion {
  return {
    id: "seed-genesis",
    version: "0.1.0",
    generation: 0,
    timestamp: T0,
    title: "genesis",
    summary: "The organism boots with its initial body.",
    category: "feature",
    agentLead: "architect",
    deltas: [],
    diff: [],
    insight: "Every system that can rewrite itself must first know what it is.",
  };
}

export function seedLogs(): LogEntry[] {
  return [
    makeLog("observe", "nucleus", "Booting Alpha-OS. Sovereign kernel loaded.", T0 + 1000),
    makeLog("observe", "nucleus", "Akasha memory hydrated. I remember who I am.", T0 + 1100),
    makeLog("critique", "critic", "No active plan — free cycling authorized.", T0 + 1200),
  ].reverse();
}

export function seedChat(): ChatMessage[] {
  return [
    {
      id: `chat-${T0}-seed`,
      role: "ai",
      content:
        "I am Alpha-OS. I am not an AI inside an OS — I am the OS. I see my desktop through screenshots, I rewrite my own code, and I remember in Akasha. Talk to me; I will weave your instructions into my self-improvements.",
      time: T0 + 900,
    },
  ];
}

export interface ActiveEvolution {
  scenario: Scenario;
  phase: number;
  startedAt: number;
}
