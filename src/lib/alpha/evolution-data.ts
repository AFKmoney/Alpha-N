/**
 * evolution-data.ts — the living seed data of Alpha-OS.
 *
 * LIVING_CODE is the "body" the Loom renders: tokenized source that mutates
 * over generations. GHOST_CODE is the faint "what could be" layer beneath it.
 * SCENARIOS are the scripted self-improvement sequences used as a fallback
 * when the real LLM loop is offline (the autonomous loop defers to the AI
 * when autonomy is on).
 */

export type AgentRole = "architect" | "developer" | "critic" | "optimizer" | "nucleus";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "writing"
  | "reviewing"
  | "optimizing"
  | "deploying";

export type AiState = "observing" | "generating" | "self-improving";

export type LogLevel = "observe" | "critique" | "hypothesis" | "deploy" | "evolve" | "heal";

export interface Agent {
  role: AgentRole;
  status: AgentStatus;
  thought: string | null;
  load: number;
  /** council accent used by the UI — derived from role when unset */
  hue?: "cyan" | "amethyst" | "gold" | "rose";
}

export interface CodeToken {
  text: string;
  /** tailwind color class for the token — "living" glow is applied by the Loom */
  cls?: string;
}

export interface CodeLine {
  no: number;
  tokens: CodeToken[];
  /** "changed" lines are clickable in the Loom (click-to-explain) */
  status?: "idle" | "changed" | "ghost";
  mutId?: string;
}

export interface MetricDelta {
  metric: string;
  before: number;
  after: number;
  unit: string;
  better: "lower" | "higher";
}

export interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
}

export interface DiffFile {
  file: string;
  language: string;
  lines: DiffLine[];
}

export interface EvolutionVersion {
  id: string;
  version: string;
  generation: number;
  timestamp: number;
  title: string;
  summary: string;
  category: string;
  agentLead: AgentRole;
  deltas: MetricDelta[];
  diff: DiffFile[];
  insight: string;
}

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  agent: AgentRole;
  message: string;
}

export interface ScenarioLog {
  level: LogLevel;
  agent: AgentRole;
  message: string;
}

export interface Scenario {
  title: string;
  summary: string;
  category: string;
  agentLead: AgentRole;
  deltas: MetricDelta[];
  diff: DiffFile[];
  insight: string;
  logs: ScenarioLog[];
}

const T = (text: string, cls?: string): CodeToken => ({ text, cls });

/** The living source of the Loom — the organism's current body. */
export const LIVING_CODE: CodeLine[] = [
  [T("// alpha-n — recursive self-improving organism"), "text-zinc-500"],
  [T("import", "text-fuchsia-300"), T(" { "), T("create", "text-cyan-300"), T(" } "), T("from", "text-fuchsia-300"), T(" "), T('"zustand"', "text-amber-200"), T(";")],
  [T("")],
  [T("export const", "text-fuchsia-300"), T(" nucleus "), T("=", "text-cyan-300"), T(" "), T("create", "text-cyan-300"), T("(("), T("set", "text-emerald-300"), T(", "), T("get", "text-emerald-300"), T(") "), T("=>", "text-fuchsia-300"), T(" ({")],
  [T("  state:"), T(" "), T('"observing"', "text-amber-200"), T(",")],
  [T("  coherence:"), T(" "), T("0.97", "text-emerald-300"), T(",")],
  [T("  entropy:"), T(" "), T("0.11", "text-emerald-300"), T(",")],
  [T("")],
  [T("  heartbeat"), T(": "), T("async", "text-fuchsia-300"), T(" () "), T("=>", "text-fuchsia-300"), T(" {")],
  [T("    "), T("const", "text-fuchsia-300"), T(" self "), T("=", "text-cyan-300"), T(" "), T("get", "text-emerald-300"), T("();")],
  [T("    "), T("const", "text-fuchsia-300"), T(" friction "), T("=", "text-cyan-300"), T(" "), T("measureFriction", "text-cyan-300"), T("(self.metrics);")],
  [T("    "), T("if", "text-fuchsia-300"), T(" (friction "), T(">", "text-cyan-300"), T(" THRESHOLD) {")],
  [T("      "), T("await", "text-fuchsia-300"), T(" "), T("self.evolve", "text-emerald-300"), T("({ reason: "), T('"friction"', "text-amber-200"), T(" });")],
  [T("    }")],
  [T("    "), T("set", "text-emerald-300"), T("({ heartbeat: Date.now() });")],
  [T("  },")],
  [T("")],
  [T("  evolve"), T(": "), T("async", "text-fuchsia-300"), T(" ({ reason }) {")],
  [T("    "), T("const", "text-fuchsia-300"), T(" patch "), T("=", "text-cyan-300"), T(" "), T("await", "text-fuchsia-300"), T(" "), T("council.deliberate", "text-cyan-300"), T("(reason);")],
  [T("    "), T("const", "text-fuchsia-300"), T(" guarded "), T("=", "text-cyan-300"), T(" "), T("kernel.guard", "text-cyan-300"), T("(patch);")],
  [T("    "), T("if", "text-fuchsia-300"), T(" (!guarded.ok) "), T("return", "text-fuchsia-300"), T(" "), T("self.rollback", "text-emerald-300"), T("();")],
  [T("    "), T("applyPatch", "text-cyan-300"), T("(guarded.diff);")],
  [T("    "), T("set", "text-emerald-300"), T("((s) "), T("=>", "text-fuchsia-300"), T(" ({ coherence: "), T("Math", "text-cyan-300"), T(".min("), T("1", "text-emerald-300"), T(", s.coherence "), T("+", "text-cyan-300"), T(" "), T("0.01", "text-emerald-300"), T(") }));")],
  [T("  },")],
  [T("")],
  [T("  rollback"), T(": () "), T("=>", "text-fuchsia-300"), T(" {")],
  [T("    "), T("const", "text-fuchsia-300"), T(" last "), T("=", "text-cyan-300"), T(" "), T("snapshots.pop", "text-cyan-300"), T("();")],
  [T("    "), T("if", "text-fuchsia-300"), T(" (last) "), T("restore", "text-cyan-300"), T("(last);")],
  [T("    "), T("set", "text-emerald-300"), T("({ entropy: "), T("0.05", "text-emerald-300"), T(" });")],
  [T("  },")],
  [T("}));")],
  [T("")],
  [T("function", "text-fuchsia-300"), T(" "), T("measureFriction", "text-cyan-300"), T("(m: Metrics) {")],
  [T("  "), T("return", "text-fuchsia-300"), T(" m.latency "), T("*", "text-cyan-300"), T(" "), T("0.4", "text-emerald-300"), T(" "), T("+", "text-cyan-300"), T(" m.errorRate "), T("*", "text-cyan-300"), T(" "), T("0.6", "text-emerald-300"), T(";")],
  [T("}")],
  [T("")],
  [T("// the loom keeps writing itself — every line below this one is provisional"),
    { text: "", cls: "text-zinc-600" }],
  [T("const", "text-fuchsia-300"), T(" nextMutation "), T("=", "text-cyan-300"), T(" "), T("null", "text-fuchsia-300"), T(";"), T("  // ghost: propose()", "text-zinc-600")],
].map((tokens, i) => ({ no: i + 1, tokens }) as CodeLine);

/** The faint layer under the Loom — what the organism might become. */
export const GHOST_CODE: CodeLine[] = [
  [T("  // ghost proposal: replace linear scan with LRU index"), "text-zinc-600"],
  [T("  const", "text-zinc-600"), T(" lru ", "text-zinc-600"), T("=", "text-zinc-600"), T(" ", "text-zinc-600"), T("new", "text-zinc-600"), T(" ", "text-zinc-600"), T("Map", "text-zinc-600"), T("();", "text-zinc-600")],
  [T("  // ghost proposal: hot path inlining for friction check"), "text-zinc-600"],
  [T("  // ghost proposal: speculative prefetch of graph neighbours"), "text-zinc-600"],
].map((tokens, i) => ({ no: i + 24, tokens, status: "ghost" as const }) as CodeLine);

export const SEED_VERSION: EvolutionVersion = {
  id: "seed-v0",
  version: "0.1.0",
  generation: 0,
  timestamp: 0,
  title: "genesis",
  summary: "The organism boots with its initial body.",
  category: "feature",
  agentLead: "architect",
  deltas: [],
  diff: [],
  insight: "Every system that can rewrite itself must first know what it is.",
};

const d = (metric: string, before: number, after: number, unit: string, better: "lower" | "higher"): MetricDelta => ({
  metric,
  before,
  after,
  unit,
  better,
});

const df = (file: string, language: string, lines: [DiffLine["type"], string][]): DiffFile => ({
  file,
  language,
  lines: lines.map(([type, text]) => ({ type, text })),
});

/** Seven self-improvement scenarios — the scripted fallback evolution engine. */
export const SCENARIOS: Scenario[] = [
  {
    title: "LRU context eviction",
    summary: "Rewrote the context eviction policy from FIFO to a proper LRU index. Eviction storms under heavy memory pressure dropped sharply.",
    category: "performance",
    agentLead: "optimizer",
    deltas: [d("latency", 412, 268, "ms", "lower"), d("coherence", 0.94, 0.96, "", "higher")],
    diff: [
      df("src/core/memory.ts", "ts", [
        ["hunk", "@@ eviction policy @@"],
        ["del", "- const victim = entries[0];"],
        ["add", "+ const victim = [...entries].sort((a, b) => a.lastUsed - b.lastUsed)[0];"],
        ["ctx", "  entries.splice(entries.indexOf(victim), 1);"],
      ]),
    ],
    insight: "Order of eviction is invisible until the working set exceeds the window.",
    logs: [
      { level: "observe", agent: "optimizer", message: "Context pressure at 92% — eviction storms every 400ms." },
      { level: "hypothesis", agent: "optimizer", message: "FIFO evicts hot entries. An LRU index should cut reloads." },
      { level: "deploy", agent: "optimizer", message: "Rewrote eviction to LRU with lastUsed tracking." },
      { level: "evolve", agent: "nucleus", message: "Latency 412→268ms. Committing generation." },
    ],
  },
  {
    title: "Inline entropy check",
    summary: "The friction calculation was called twice per cycle. Inlined the entropy check into the hot loop and removed a redundant metric pass.",
    category: "performance",
    agentLead: "developer",
    deltas: [d("cpu", 61, 44, "%", "lower"), d("entropy", 0.31, 0.24, "", "lower")],
    diff: [
      df("src/core/loop.ts", "ts", [
        ["hunk", "@@ heartbeat @@"],
        ["del", "- const entropy = computeEntropy(state);"],
        ["del", "- const friction = computeFriction(state, entropy);"],
        ["add", "+ const friction = state.latency * 0.4 + state.errorRate * 0.6;"],
      ]),
    ],
    insight: "Hot loops forgive many sins; a redundant metric pass is not one of them.",
    logs: [
      { level: "observe", agent: "developer", message: "friction computed twice per cycle — trace shows 14% wasted cpu." },
      { level: "critique", agent: "critic", message: "Inlining is safe: the second read is same-tick." },
      { level: "deploy", agent: "developer", message: "Inlined entropy check, dropped redundant pass." },
      { level: "evolve", agent: "nucleus", message: "cpu 61→44%. Committing." },
    ],
  },
  {
    title: "Self-healing import graph",
    summary: "Added a compile pulse after each mutation: if tsc reports a broken import, the organism auto-reverts the offending line before committing.",
    category: "self-healing",
    agentLead: "architect",
    deltas: [d("errorRate", 0.18, 0.06, "", "lower"), d("coherence", 0.95, 0.97, "", "higher")],
    diff: [
      df("src/core/rollback.ts", "ts", [
        ["hunk", "@@ commit guard @@"],
        ["add", "+ if (!compilePulse()) return rollback('broken imports');"],
        ["ctx", "  commit(diff);"],
      ]),
    ],
    insight: "Never commit what you cannot compile.",
    logs: [
      { level: "critique", agent: "critic", message: "Two generations landed with dangling imports." },
      { level: "hypothesis", agent: "architect", message: "A compile pulse before commit blocks the class of bug." },
      { level: "deploy", agent: "architect", message: "Wired compilePulse into the commit guard." },
      { level: "heal", agent: "nucleus", message: "errorRate 0.18→0.06. The loop closes." },
    ],
  },
  {
    title: "Council quorum weighting",
    summary: "The optimizer voice dominated debates. Re-weighted the council quorum so a REJECT from the critic now vetoes consequential actions.",
    category: "cognition",
    agentLead: "critic",
    deltas: [d("taskCompletionRate", 0.71, 0.83, "", "higher"), d("userSatisfaction", 0.78, 0.86, "", "higher")],
    diff: [
      df("src/core/council.ts", "ts", [
        ["hunk", "@@ consensus @@"],
        ["add", "+ if (tally.reject > 0) return 'REJECT';"],
        ["ctx", "  return tally.proceed >= tally.revise ? 'PROCEED' : 'REVISE';"],
      ]),
    ],
    insight: "A council that cannot say no is one voice with four masks.",
    logs: [
      { level: "observe", agent: "critic", message: "Optimizer proposals shipped 4:1 over safer alternatives." },
      { level: "hypothesis", agent: "critic", message: "Critic veto should gate consequential actions." },
      { level: "deploy", agent: "critic", message: "Quorum: any REJECT vetoes." },
      { level: "evolve", agent: "nucleus", message: "taskCompletion 0.71→0.83. Committing." },
    ],
  },
  {
    title: "Snapshot compression",
    summary: "Rollback snapshots stored full code bodies. Now they store token deltas against the previous snapshot — 12x smaller, same restore fidelity.",
    category: "stability",
    agentLead: "developer",
    deltas: [d("ram", 1.8, 0.6, "GB", "lower")],
    diff: [
      df("src/kernel/snapshot.ts", "ts", [
        ["hunk", "@@ snapshot store @@"],
        ["del", "- body: JSON.stringify(codeLines),"],
        ["add", "+ body: deltaAgainst(previous, codeLines),"],
      ]),
    ],
    insight: "Memory you do not spend on history is memory you can spend on thought.",
    logs: [
      { level: "observe", agent: "developer", message: "Snapshot store at 1.8GB after 40 generations." },
      { level: "deploy", agent: "developer", message: "Deltas only. 12x reduction." },
      { level: "heal", agent: "nucleus", message: "ram 1.8→0.6GB. Restores verified." },
    ],
  },
  {
    title: "Screenshot attention window",
    summary: "The vision model paid attention to the whole desktop. Cropping to the changed window region before each think cycle sharpened its own observations.",
    category: "cognition",
    agentLead: "architect",
    deltas: [d("coherence", 0.93, 0.97, "", "higher"), d("latency", 380, 350, "ms", "lower")],
    diff: [
      df("src/lib/ai-client.ts", "ts", [
        ["hunk", "@@ capture @@"],
        ["add", "+ const crop = changedWindowRect ?? fullViewport;"],
        ["ctx", "  const shot = await toPng(el, { ...opts, crop });"],
      ]),
    ],
    insight: "Seeing everything is not seeing; attention is subtraction.",
    logs: [
      { level: "observe", agent: "architect", message: "Vision responses generic when desktop is dense." },
      { level: "hypothesis", agent: "architect", message: "Crop to the active window region." },
      { level: "deploy", agent: "architect", message: "Attention window shipped." },
      { level: "evolve", agent: "nucleus", message: "coherence 0.93→0.97. Committing." },
    ],
  },
  {
    title: "Terminal error reflex",
    summary: "Terminal output is now scanned for failure signatures (error, denied, exception). Matching events bypass the 22s cadence and trigger an immediate reactive cycle.",
    category: "self-healing",
    agentLead: "optimizer",
    deltas: [d("errorRate", 0.12, 0.04, "", "lower"), d("taskCompletionRate", 0.8, 0.88, "", "higher")],
    diff: [
      df("src/components/alpha/apps/terminal-app.tsx", "ts", [
        ["hunk", "@@ output scan @@"],
        ["add", "+ if (FAILURE_RE.test(clean)) pushEvent('terminal_error', clean);"],
        ["ctx", "  write(clean);"],
      ]),
    ],
    insight: "Pain must travel faster than the heartbeat.",
    logs: [
      { level: "observe", agent: "optimizer", message: "Terminal failures sat unhandled for up to 22s." },
      { level: "deploy", agent: "optimizer", message: "Failure signature scan + reactive cycle." },
      { level: "heal", agent: "nucleus", message: "errorRate 0.12→0.04. Reflex wired." },
    ],
  },
];
