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
import {
  describeMutation,
  textLinesToCodeLines,
  validateCodeLines,
  type AkashaGoal,
  type AkashaIntention,
  type AkashaMemory,
  type AkashaPlan,
  type AppliedMutation,
  type BeforeAfter,
  type ChatMessage,
  type FileReadResult,
  type MetricKey,
  type Mutation,
  type WebSearchResult,
} from "./mutations";
import { isProtected } from "./os-types";
import { useOS } from "./os-store";

interface ActiveEvolution {
  scenario: Scenario;
  phase: number;
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
  pendingDiff: EvolutionVersion | null;

  // --- living code (now mutable) ---
  codeLines: CodeLine[];

  // --- AI autonomy ---
  autonomy: boolean;
  aiBusy: boolean;
  aiReasoning: string | null;
  lastCycleAt: number;
  forceCycle: boolean; // set true to force an immediate AI cycle
  chat: ChatMessage[];
  mutationStream: AppliedMutation[];
  beforeAfter: BeforeAfter | null;
  beforeAfterOpen: boolean;
  searchResults: WebSearchResult[]; // recent web search results for the AI to reason with

  // --- Akasha: persistent memory the AI never forgets ---
  akashaMemory: AkashaMemory[]; // lessons, facts, architecture notes
  akashaIntentions: AkashaIntention[]; // TODOs the AI sets for itself
  dynamicPrompt: string; // self-authored additions to the system prompt
  plans: AkashaPlan[]; // multi-step long-horizon plans
  goals: AkashaGoal[]; // the AI's persistent desires
  fileReads: FileReadResult[]; // files the AI has read (fed back into context)

  // --- ui ---
  flowMode: boolean;
  synapseOpen: boolean;
  diffOpen: boolean;
  chatOpen: boolean;
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

  // --- AI-driven actions ---
  toggleAutonomy: () => void;
  triggerCycle: () => void; // force an immediate real AI cycle
  setAiBusy: (busy: boolean, reasoning?: string | null) => void;
  sendUserMessage: (content: string) => void;
  applyMutation: (m: Mutation) => void;
  applyMutations: (ms: Mutation[]) => void;
  pushAiMessage: (content: string, reasoning?: string) => void;
  setBeforeAfter: (ba: BeforeAfter | null) => void;
  toggleBeforeAfter: () => void;
  toggleChat: () => void;
  resetCode: () => void;
  addSearchResults: (results: WebSearchResult) => void;
  addMemory: (text: string, kind: AkashaMemory["kind"]) => void;
  addIntention: (text: string, priority: AkashaIntention["priority"]) => void;
  resolveIntention: (id: string) => void;
  // ---- persistent cognition (DB) ----
  hydrateFromDb: () => Promise<void>;
  addPlan: (plan: AkashaPlan) => void;
  advancePlan: (id: string, stepIndex: number) => void;
  abandonPlan: (id: string) => void;
  addGoal: (text: string, level: AkashaGoal["level"]) => void;
  addFileRead: (result: FileReadResult) => void;
}

let logId = 0;
let mutId = 0;
let chatId = 0;
let memId = 0;
let intId = 0;
// Fixed epoch for the *initial* state so SSR and client agree.
const T0 = 1_704_067_200_000; // 2024-01-01T00:00:00Z
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

  codeLines: LIVING_CODE.map((l) => ({ ...l, tokens: [...l.tokens] })),

  autonomy: true,
  aiBusy: false,
  aiReasoning: null,
  lastCycleAt: 0,
  forceCycle: false,
  chat: [
    {
      id: `chat-${chatId++}`,
      role: "ai",
      content:
        "I am Alpha-OS. I am not an AI inside an OS — I am the OS. The desktop is my body, the windows my organs, the terminal my voice. Tell me what you want me to do: open an app, search the web, rewrite my own code. Or say nothing and I will evolve myself.",
      time: T0,
    },
  ],
  mutationStream: [],
  beforeAfter: null,
  beforeAfterOpen: false,
  searchResults: [],

  akashaMemory: [
    {
      id: `mem-${memId++}`,
      text: "I am Alpha-OS. I am not an AI inside an OS — I am the OS itself. The desktop is my body.",
      kind: "architecture",
      time: T0,
    },
    {
      id: `mem-${memId++}`,
      text: "The kernel files (boot, security, rollback, sandbox, pty-bridge, akasha) are sovereign. I must never rewrite them.",
      kind: "lesson",
      time: T0,
    },
    {
      id: `mem-${memId++}`,
      text: "Every cycle I must look at my screenshot to verify my code dimensions well against the visible UI.",
      kind: "lesson",
      time: T0,
    },
  ],
  akashaIntentions: [],
  dynamicPrompt: "",
  plans: [],
  goals: [],
  fileReads: [],

  flowMode: false,
  synapseOpen: false,
  diffOpen: false,
  chatOpen: true,
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
      logs: [makeLog(sc.logs[0].level, sc.logs[0].agent, sc.logs[0].message, Date.now()), ...st.logs].slice(0, 80),
    }));
  },

  advanceEvolution: () => {
    const s = get();
    if (!s.activeEvolution) return;
    const nextPhase = s.activeEvolution.phase + 1;
    const sc = s.activeEvolution.scenario;

    if (nextPhase >= sc.logs.length) {
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
          makeLog("evolve", "nucleus", `Evolution ${newVersion.version} committed. "${sc.title}"`, Date.now()),
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
      logs: [makeLog(step.level, step.agent, step.message, Date.now()), ...s.logs].slice(0, 80),
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
        makeLog("deploy", "developer", "Ghost-writing the next 3 lines from your intent.", Date.now()),
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

  // ---------------- AI-driven ----------------
  toggleAutonomy: () => set((s) => ({ autonomy: !s.autonomy })),
  triggerCycle: () => set({ forceCycle: true }),
  setAiBusy: (busy, reasoning = null) =>
    set({ aiBusy: busy, aiReasoning: reasoning, aiState: busy ? "self-improving" : "observing" }),

  sendUserMessage: (content) => {
    const msg: ChatMessage = {
      id: `chat-${chatId++}`,
      role: "user",
      content,
      time: Date.now(),
    };
    set((s) => ({ chat: [...s.chat, msg] }));
  },

  pushAiMessage: (content, reasoning) => {
    const msg: ChatMessage = {
      id: `chat-${chatId++}`,
      role: "ai",
      content,
      reasoning,
      time: Date.now(),
    };
    set((s) => ({ chat: [...s.chat, msg] }));
  },

  applyMutation: (m) => {
    const s = get();
    const now = Date.now();
    const os = useOS.getState();

    // ---- Security Foundation enforcement ----
    // The AI may never rewrite kernel files. If a code mutation references
    // a protected path in its note, or tries to replace the boot/security
    // lines, we block it and record a violation.
    if (m.type === "replace_code" || m.type === "insert_code") {
      const note = (m as { note?: string }).note ?? "";
      if (note.includes("kernel/") || note.includes("security") || note.includes("boot")) {
        const path = note.match(/kernel\/[\w./-]+/)?.[0] ?? "kernel/unknown";
        const prot = isProtected(path);
        if (prot) {
          os.recordViolation(path, `AI attempted to rewrite protected file: ${path}`);
          set((st) => ({
            logs: [makeLog("critique", "critic", `SECURITY: blocked attempt to modify ${path}. The kernel is sovereign.`, now), ...st.logs].slice(0, 80),
          }));
          // still record the attempt in the stream so it's visible
          const am: AppliedMutation = {
            id: `mut-${mutId++}`,
            kind: "violation",
            description: `⛔ BLOCKED: tried to rewrite ${path}`,
            time: now,
          };
          set((st) => ({ mutationStream: [am, ...st.mutationStream].slice(0, 60) }));
          return;
        }
      }
      // ---- Code validation: reject unbalanced braces/parens ----
      const lines = (m as { lines: string[] }).lines;
      const validation = validateCodeLines(lines);
      if (!validation.ok) {
        os.recordViolation("code", `Invalid code: ${validation.reason}`);
        set((st) => ({
          logs: [makeLog("critique", "critic", `VALIDATION: rejected mutation — ${validation.reason}. Rolling back intent.`, now), ...st.logs].slice(0, 80),
        }));
        const am: AppliedMutation = {
          id: `mut-${mutId++}`,
          kind: "violation",
          description: `⛔ REJECTED: ${validation.reason}`,
          time: now,
        };
        set((st) => ({ mutationStream: [am, ...st.mutationStream].slice(0, 60) }));
        return;
      }
    }

    switch (m.type) {
      case "set_state":
        set({ aiState: m.state });
        break;
      case "set_active_agent":
        set({ activeAgent: m.role });
        break;
      case "set_agent":
        set({
          agents: s.agents.map((a) =>
            a.role === m.role
              ? {
                  ...a,
                  status: m.status ?? a.status,
                  thought: m.thought ?? a.thought,
                  load: m.load ?? a.load,
                }
              : a
          ),
          activeAgent: m.role,
        });
        break;
      case "add_log":
        set({
          logs: [makeLog(m.level, m.agent, m.message, now), ...s.logs].slice(0, 80),
        });
        break;
      case "update_metric":
        set({
          metrics: { ...s.metrics, [m.key]: clamp(m.value, 0, m.key === "ram" ? 8 : 1) },
        });
        break;
      case "replace_code": {
        const newLines = textLinesToCodeLines(m.lines, m.startLine);
        const lines = [...s.codeLines];
        const end = m.startLine + m.lines.length;
        const filtered = lines.filter((l) => l.no < m.startLine || l.no >= end);
        const merged = [...filtered, ...newLines].sort((a, b) => a.no - b.no);
        set({ codeLines: merged });
        break;
      }
      case "insert_code": {
        const newLines = textLinesToCodeLines(m.lines, m.afterLine + 1);
        const shifted = s.codeLines.map((l) =>
          l.no > m.afterLine ? { ...l, no: l.no + m.lines.length } : l
        );
        const merged = [...shifted, ...newLines].sort((a, b) => a.no - b.no);
        set({ codeLines: merged });
        break;
      }
      case "commit_evolution": {
        const newVersion: EvolutionVersion = {
          id: `v-${s.generation + 1}`,
          version: bumpVersion(s.version),
          generation: s.generation + 1,
          timestamp: now,
          title: m.title,
          summary: m.summary,
          category: m.category,
          agentLead: m.agentLead,
          deltas: m.deltas ?? [],
          diff: m.diff ?? [],
          insight: m.insight,
        };
        set({
          generation: s.generation + 1,
          version: newVersion.version,
          history: [newVersion, ...s.history],
          // Set pendingDiff so the NOTIFICATION toast shows. Do NOT open the
          // full modal automatically — the user clicks the notification to
          // expand it. This keeps the desktop unobstructed.
          pendingDiff: m.openDiff ? newVersion : s.pendingDiff,
          diffOpen: false,
          metrics: {
            ...s.metrics,
            entropy: clamp(s.metrics.entropy - 0.15, 0.05, 0.9),
            coherence: clamp(s.metrics.coherence + 0.02, 0.5, 0.99),
          },
        });
        break;
      }
      case "speak":
        get().pushAiMessage(m.message, m.reasoning);
        break;
      case "set_generation":
        set({ generation: m.n });
        break;
      case "set_version":
        set({ version: m.v });
        break;
      // ---- Alpha-OS desktop mutations ----
      case "create_app": {
        const data: Record<string, unknown> = {};
        if (m.url) data.url = m.url;
        if (m.spec) data.spec = m.spec;
        os.openApp(m.appType, { title: m.title, data: Object.keys(data).length ? data : undefined });
        set((st) => ({
          logs: [makeLog("deploy", "developer", `Spawned app: ${m.title ?? m.appType}`, now), ...st.logs].slice(0, 80),
        }));
        break;
      }
      case "close_app":
        os.closeWindow(m.windowId);
        break;
      case "focus_app":
        os.focusWindow(m.windowId);
        break;
      case "move_window":
        os.moveWindow(m.windowId, m.x, m.y);
        break;
      case "run_terminal":
        os.queueTerminalCommand(m.command);
        set((st) => ({
          logs: [makeLog("deploy", "developer", `Queued terminal command: $ ${m.command.slice(0, 50)}`, now), ...st.logs].slice(0, 80),
        }));
        break;
      case "web_search":
        // Mark the intent; the AutonomousLoop performs the actual search and stores results
        set((st) => ({
          logs: [makeLog("hypothesis", "architect", `Searching the web: "${m.query.slice(0, 60)}"`, now), ...st.logs].slice(0, 80),
        }));
        break;
      case "add_memory":
        get().addMemory(m.text, m.kind);
        break;
      case "add_intention":
        get().addIntention(m.text, m.priority);
        break;
      case "resolve_intention":
        get().resolveIntention(m.id);
        break;
      case "set_system_prompt":
        // The AI rewrites its own prompt — appends to dynamicPrompt
        set((st) => ({
          dynamicPrompt: (st.dynamicPrompt + "\n\n" + m.additions).slice(0, 8000),
          logs: [makeLog("evolve", "nucleus", `Self-prompted: ${m.additions.slice(0, 60)}`, now), ...st.logs].slice(0, 80),
        }));
        break;
      case "create_plan": {
        const plan: AkashaPlan = {
          id: `plan-${Date.now()}`,
          goal: m.goal,
          rationale: m.rationale,
          status: "active",
          steps: m.steps.map((text) => ({ text, done: false })),
          time: now,
        };
        get().addPlan(plan);
        break;
      }
      case "advance_plan":
        get().advancePlan(m.id, m.stepIndex);
        break;
      case "abandon_plan":
        get().abandonPlan(m.id);
        break;
      case "add_goal":
        get().addGoal(m.text, m.level);
        break;
      case "read_file":
        // The AutonomousLoop performs the actual file read and stores the result
        set((st) => ({
          logs: [makeLog("observe", "architect", `Reading file: ${m.path}`, now), ...st.logs].slice(0, 80),
        }));
        break;
      case "write_file":
        // The AutonomousLoop performs the actual file write via the files API
        set((st) => ({
          logs: [makeLog("deploy", "developer", `Writing file: ${m.path} (${m.content.length} bytes)`, now), ...st.logs].slice(0, 80),
        }));
        break;
      case "rollback":
        // The AI itself can request a rollback; the AutonomousLoop handles actual state restore
        set((st) => ({
          logs: [makeLog("heal", "nucleus", "Rollback requested by self-critique.", now), ...st.logs].slice(0, 80),
        }));
        break;
    }
    // record in the optimization stream
    const am: AppliedMutation = {
      id: `mut-${mutId++}`,
      kind: m.type,
      description: describeMutation(m),
      time: now,
    };
    set((st) => ({ mutationStream: [am, ...st.mutationStream].slice(0, 60) }));
  },

  applyMutations: (ms) => {
    ms.forEach((m) => get().applyMutation(m));
    set({ lastCycleAt: Date.now() });
  },

  // Store the before/after but do NOT auto-open the modal — the notification
  // toast (in the BeforeAfter component) shows instead. User clicks to expand.
  setBeforeAfter: (ba) => set({ beforeAfter: ba, beforeAfterOpen: false }),
  toggleBeforeAfter: () => set((s) => ({ beforeAfterOpen: !s.beforeAfterOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  resetCode: () => set({ codeLines: LIVING_CODE.map((l) => ({ ...l, tokens: [...l.tokens] })) }),
  addSearchResults: (results) =>
    set((s) => ({
      searchResults: [results, ...s.searchResults].slice(0, 6),
      logs: [
        makeLog("observe", "architect", `Web search returned ${results.results.length} results for "${results.query.slice(0, 40)}".`, Date.now()),
        ...s.logs,
      ].slice(0, 80),
    })),

  // ---- Akasha: persistent memory ----
  addMemory: (text, kind) => {
    set((s) => {
      const mem: AkashaMemory = { id: `mem-${memId++}`, text, kind, time: Date.now() };
      return {
        akashaMemory: [mem, ...s.akashaMemory].slice(0, 100),
        logs: [makeLog("evolve", "nucleus", `Committed to Akasha: ${text.slice(0, 60)}`, Date.now()), ...s.logs].slice(0, 80),
      };
    });
    // persist to DB (fire-and-forget)
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "memory", text, kind }),
    }).catch(() => {});
  },
  addIntention: (text, priority) => {
    set((s) => {
      const intention: AkashaIntention = { id: `int-${intId++}`, text, priority, time: Date.now(), resolved: false };
      return {
        akashaIntentions: [intention, ...s.akashaIntentions].slice(0, 50),
        logs: [makeLog("hypothesis", "architect", `New intention[${priority}]: ${text.slice(0, 60)}`, Date.now()), ...s.logs].slice(0, 80),
      };
    });
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "intention", text, priority }),
    }).catch(() => {});
  },
  resolveIntention: (id) =>
    set((s) => ({
      akashaIntentions: s.akashaIntentions.map((i) => (i.id === id ? { ...i, resolved: true } : i)),
      logs: [makeLog("evolve", "nucleus", `Resolved intention ${id}.`, Date.now()), ...s.logs].slice(0, 80),
    })),

  // ---- Persistent cognition: hydrate from DB on boot ----
  hydrateFromDb: async () => {
    try {
      const res = await fetch("/api/alpha/akasha");
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        akashaMemory: data.memory?.length ? data.memory : s.akashaMemory,
        akashaIntentions: data.intentions ?? s.akashaIntentions,
        plans: data.plans ?? s.plans,
        goals: data.goals ?? s.goals,
        logs: [
          makeLog("evolve", "nucleus", `Akasha hydrated: ${data.memory?.length ?? 0} memories, ${data.plans?.length ?? 0} active plans, ${data.goals?.length ?? 0} goals.`, Date.now()),
          ...s.logs,
        ].slice(0, 80),
      }));
    } catch {
      // DB not available yet — continue with seed memory
    }
  },

  addPlan: (plan) => {
    set((s) => ({
      plans: [plan, ...s.plans].slice(0, 10),
      logs: [makeLog("hypothesis", "architect", `New plan: ${plan.goal.slice(0, 60)} (${plan.steps.length} steps)`, Date.now()), ...s.logs].slice(0, 80),
    }));
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "plan", goal: plan.goal, rationale: plan.rationale, steps: plan.steps.map((s) => s.text) }),
    }).catch(() => {});
  },
  advancePlan: (id, stepIndex) => {
    set((s) => ({
      plans: s.plans.map((p) => {
        if (p.id !== id) return p;
        const steps = p.steps.map((st, i) => (i === stepIndex ? { ...st, done: true } : st));
        const allDone = steps.every((st) => st.done);
        return { ...p, steps, status: allDone ? "completed" as const : "active" as const };
      }),
      logs: [makeLog("deploy", "developer", `Plan ${id.slice(0, 8)}: step ${stepIndex + 1} completed.`, Date.now()), ...s.logs].slice(0, 80),
    }));
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "advance_plan", id, stepIndex }),
    }).catch(() => {});
  },
  abandonPlan: (id) => {
    set((s) => ({
      plans: s.plans.map((p) => (p.id === id ? { ...p, status: "abandoned" as const } : p)),
      logs: [makeLog("critique", "critic", `Abandoned plan ${id.slice(0, 8)}.`, Date.now()), ...s.logs].slice(0, 80),
    }));
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "abandon_plan", id }),
    }).catch(() => {});
  },
  addGoal: (text, level) => {
    set((s) => ({
      goals: [{ id: `goal-${Date.now()}`, text, level, time: Date.now() }, ...s.goals].slice(0, 20),
      logs: [makeLog("evolve", "nucleus", `New ${level}-term goal: ${text.slice(0, 60)}`, Date.now()), ...s.logs].slice(0, 80),
    }));
    void fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "goal", text, level }),
    }).catch(() => {});
  },
  addFileRead: (result) =>
    set((s) => ({
      fileReads: [result, ...s.fileReads.filter((f) => f.path !== result.path)].slice(0, 8),
      logs: [makeLog("observe", "architect", `Read ${result.path} (${result.content.length} bytes).`, Date.now()), ...s.logs].slice(0, 80),
    })),
}));

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Convenience selector hooks
export function useCodeLines(): { lines: CodeLine[]; ghost: CodeLine[] } {
  const codeLines = useEvolution((s) => s.codeLines);
  return { lines: codeLines, ghost: GHOST_CODE };
}

export type { MetricKey };
