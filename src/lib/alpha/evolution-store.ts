"use client";

import { create } from "zustand";
import {
  AGENT_META,
  GHOST_CODE,
  LIVING_CODE,
  SCENARIOS,
  SEED_VERSION,
  type Agent,
  type AgentRole,
  type AgentStatus,
  type AiState,
  type CodeLine,
  type EvolutionVersion,
  type LogEntry,
  type LogLevel,
  type Scenario,
} from "./evolution-data";

interface ActiveEvolution {
  scenario: Scenario;
  phase: number; // index into scenario.logs
  startedAt: number;
}

interface EvolutionStore {
  // --- state of the organism ---
  aiState: AiState;
  generation: number;
  version: string;
  uptimeMs: number;
  heartbeat: number;

  // --- the council ---
  agents: Agent[];
  activeAgent: AgentRole | null;

  // --- records ---
  history: EvolutionVersion[];
  logs: LogEntry[];
  activeEvolution: ActiveEvolution | null;
  pendingDiff: EvolutionVersion | null; // diff awaiting user dismissal

  // --- ui ---
  flowMode: boolean;
  synapseOpen: boolean;
  diffOpen: boolean;
  selectedHistoryId: string | null;
  hoveredLink: string | null;
  ghostVisible: boolean;

  // --- telemetry ---
  metrics: {
    cpu: number;
    ram: number;
    entropy: number;
    coherence: number;
  };

  // --- actions ---
  tick: () => void;
  startEvolution: (scenario?: Scenario) => void;
  advanceEvolution: () => void;
  dismissDiff: () => void;
  openHistoryDiff: (id: string) => void;
  toggleFlow: () => void;
  toggleSynapse: () => void;
  setHoveredLink: (id: string | null) => void;
  toggleGhost: () => void;
  triggerGenerate: () => void;
}

let logId = 0;
// Fixed epoch for the *initial* state so SSR and client agree.
// All time-based randomness is deferred to post-mount effects.
const T0 = 1_704_067_200_000; // 2024-01-01T00:00:00Z — a stable sentinel
function makeLog(
  level: LogLevel,
  agent: AgentRole | "nucleus",
  message: string,
  time: number = T0
): LogEntry {
  return { id: `log-${logId++}`, time, level, agent, message };
}

function bumpVersion(prev: string): string {
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

const IDLE_LOAD: Record<AgentRole, number> = {
  architect: 0.12,
  developer: 0.18,
  critic: 0.09,
  optimizer: 0.15,
};
function idleAgents(): Agent[] {
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

const STATUS_BY_LEVEL: Record<LogLevel, AgentStatus> = {
  observe: "thinking",
  critique: "reviewing",
  hypothesis: "thinking",
  deploy: "deploying",
  evolve: "deploying",
  heal: "optimizing",
};

export const useEvolution = create<EvolutionStore>((set, get) => ({
  aiState: "observing",
  generation: 0,
  version: SEED_VERSION.version,
  uptimeMs: 0,
  heartbeat: 0,

  agents: idleAgents(),
  activeAgent: null,

  history: [{ ...SEED_VERSION, timestamp: T0 }],
  logs: [
    makeLog("evolve", "nucleus", "N-Core online. Three layers synchronised. The organism is awake."),
    makeLog("observe", "architect", "Surveying own source tree — 312 modules, 0 wounds detected."),
  ],
  activeEvolution: null,
  pendingDiff: null,

  flowMode: false,
  synapseOpen: false,
  diffOpen: false,
  selectedHistoryId: null,
  hoveredLink: null,
  ghostVisible: true,

  metrics: { cpu: 12, ram: 1.4, entropy: 0.31, coherence: 0.88 },

  tick: () => {
    const s = get();
    set({
      uptimeMs: s.uptimeMs + 1000,
      heartbeat: s.heartbeat + 1,
      metrics: {
        cpu: clamp(s.metrics.cpu + (Math.random() - 0.5) * 4, 8, 60),
        ram: clamp(s.metrics.ram + (Math.random() - 0.5) * 0.08, 0.9, 3.2),
        entropy: clamp(s.metrics.entropy + (Math.random() - 0.5) * 0.03, 0.05, 0.9),
        coherence: clamp(s.metrics.coherence + (Math.random() - 0.5) * 0.02, 0.5, 0.99),
      },
      agents: s.agents.map((a) => ({
        ...a,
        load: a.status === "idle" ? clamp(a.load + (Math.random() - 0.5) * 0.1, 0.05, 0.4) : a.load,
      })),
    });

    // Advance an in-flight evolution.
    const active = get().activeEvolution;
    if (active) {
      const now = Date.now();
      if (now - active.startedAt > 1800) {
        get().advanceEvolution();
      }
    }
  },

  startEvolution: (scenario) => {
    const s = get();
    if (s.activeEvolution) return;
    const sc = scenario ?? SCENARIOS[s.history.length % SCENARIOS.length];
    set({
      aiState: "self-improving",
      activeEvolution: { scenario: sc, phase: 0, startedAt: Date.now() },
      agents: s.agents.map((a) =>
        a.role === sc.agentLead
          ? { ...a, status: STATUS_BY_LEVEL[sc.logs[0].level], thought: sc.logs[0].message, load: 0.9 }
          : { ...a, status: "thinking", load: clamp(a.load + 0.3, 0.1, 0.8) }
      ),
      activeAgent: sc.agentLead,
      metrics: { ...s.metrics, entropy: clamp(s.metrics.entropy + 0.15, 0.05, 0.95) },
    });
    set((st) => ({
      logs: [makeLog(sc.logs[0].level, sc.logs[0].agent, sc.logs[0].message), ...st.logs].slice(0, 80),
    }));
  },

  advanceEvolution: () => {
    const s = get();
    if (!s.activeEvolution) return;
    const nextPhase = s.activeEvolution.phase + 1;
    const sc = s.activeEvolution.scenario;

    if (nextPhase >= sc.logs.length) {
      // Commit the evolution.
      const newVersion: EvolutionVersion = {
        id: `v-${s.generation + 1}`,
        version: bumpVersion(s.version),
        generation: s.generation + 1,
        timestamp: Date.now(),
        title: sc.title,
        summary: sc.summary,
        category: sc.category,
        agentLead: sc.agentLead,
        deltas: sc.deltas,
        diff: sc.diff,
        insight: sc.insight,
      };
      set({
        aiState: "observing",
        generation: s.generation + 1,
        version: newVersion.version,
        activeEvolution: null,
        activeAgent: null,
        pendingDiff: newVersion,
        diffOpen: true,
        history: [newVersion, ...s.history],
        agents: idleAgents(),
        metrics: {
          ...s.metrics,
          entropy: clamp(s.metrics.entropy - 0.2, 0.05, 0.9),
          coherence: clamp(s.metrics.coherence + 0.03, 0.5, 0.99),
        },
        logs: [
          makeLog("evolve", "nucleus", `Evolution ${newVersion.version} committed. "${sc.title}"`),
          ...s.logs,
        ].slice(0, 80),
      });
      return;
    }

    const step = sc.logs[nextPhase];
    set({
      activeEvolution: { ...s.activeEvolution, phase: nextPhase, startedAt: Date.now() },
      agents: s.agents.map((a) =>
        a.role === step.agent || step.agent === "nucleus"
          ? {
              ...a,
              status: step.agent === "nucleus" ? a.status : STATUS_BY_LEVEL[step.level],
              thought: step.message,
              load: step.agent === "nucleus" ? a.load : 0.85,
            }
          : a.status === "idle"
            ? a
            : { ...a, load: clamp(a.load - 0.1, 0.1, 0.9) }
      ),
      activeAgent: step.agent === "nucleus" ? s.activeAgent : (step.agent as AgentRole),
      logs: [makeLog(step.level, step.agent, step.message), ...s.logs].slice(0, 80),
    });
  },

  dismissDiff: () => set({ diffOpen: false, pendingDiff: null }),
  openHistoryDiff: (id) => {
    const v = get().history.find((h) => h.id === id);
    if (v) set({ pendingDiff: v, diffOpen: true, selectedHistoryId: id });
  },
  toggleFlow: () => set((s) => ({ flowMode: !s.flowMode })),
  toggleSynapse: () => set((s) => ({ synapseOpen: !s.synapseOpen })),
  setHoveredLink: (id) => set({ hoveredLink: id }),
  toggleGhost: () => set((s) => ({ ghostVisible: !s.ghostVisible })),
  triggerGenerate: () => {
    const s = get();
    if (s.activeEvolution) return;
    set({
      aiState: "generating",
      activeAgent: "developer",
      agents: s.agents.map((a) =>
        a.role === "developer"
          ? { ...a, status: "writing", thought: "Projecting the probable continuation of your thought…", load: 0.7 }
          : a
      ),
      logs: [
        makeLog("deploy", "developer", "Ghost-writing the next 3 lines from your intent."),
        ...s.logs,
      ].slice(0, 80),
    });
    setTimeout(() => {
      set((st) => ({
        aiState: st.activeEvolution ? "self-improving" : "observing",
        activeAgent: st.activeEvolution ? st.activeAgent : null,
        agents: st.activeEvolution
          ? st.agents
          : st.agents.map((a) =>
              a.role === "developer" ? { ...a, status: "idle", load: 0.1 } : a
            ),
      }));
    }, 2600);
  },
}));

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Convenience selector hooks
export function useCodeLines(): { lines: CodeLine[]; ghost: CodeLine[] } {
  return { lines: LIVING_CODE, ghost: GHOST_CODE };
}
