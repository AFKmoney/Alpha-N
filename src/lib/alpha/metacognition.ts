// ============================================================
// Alpha-N — Metacognitive engine data & scenarios
// The "soul" that observes the cognitive layer and rewrites itself.
// ============================================================

export type AiState = "observing" | "generating" | "self-improving";

export type AgentRole = "architect" | "developer" | "critic" | "optimizer";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "writing"
  | "reviewing"
  | "optimizing"
  | "deploying";

export interface Agent {
  role: AgentRole;
  name: string;
  glyph: string;
  hue: "cyan" | "amethyst" | "gold" | "rose";
  status: AgentStatus;
  thought: string;
  load: number; // 0..1 cognitive load
}

export type EvoCategory =
  | "performance"
  | "feature"
  | "self-healing"
  | "cognition"
  | "stability";

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
  no?: number;
}

export interface DiffHunk {
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
  category: EvoCategory;
  agentLead: AgentRole;
  deltas: MetricDelta[];
  diff: DiffHunk[];
  insight: string;
  rolledBack?: boolean;
}

export type LogLevel =
  | "observe"
  | "critique"
  | "hypothesis"
  | "deploy"
  | "evolve"
  | "heal";

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  agent: AgentRole | "nucleus";
  message: string;
}

export const AGENT_META: Record<
  AgentRole,
  { name: string; glyph: string; hue: Agent["hue"]; mandate: string }
> = {
  architect: {
    name: "The Architect",
    glyph: "◈",
    hue: "amethyst",
    mandate: "Plans structural mutations of the core.",
  },
  developer: {
    name: "The Developer",
    glyph: "⌬",
    hue: "cyan",
    mandate: "Writes the code of new faculties.",
  },
  critic: {
    name: "The Auditor",
    glyph: "◉",
    hue: "rose",
    mandate: "Hunts logic flaws in the Developer's output.",
  },
  optimizer: {
    name: "The Optimizer",
    glyph: "❖",
    hue: "gold",
    mandate: "Reduces RAM & CPU entropy of the organism.",
  },
};

// ------------------------------------------------------------
// The seed: the starting "species" of Alpha-N
// ------------------------------------------------------------
export const SEED_VERSION: EvolutionVersion = {
  id: "seed",
  version: "1.0.0",
  generation: 0,
  timestamp: Date.now() - 1000 * 60 * 60 * 24 * 9,
  title: "Genesis — the organism bootstraps",
  summary:
    "N-Core initialises its three layers: the Executive body, the Cognitive brain, and the Metacognitive soul. The first heartbeat is recorded.",
  category: "feature",
  agentLead: "architect",
  deltas: [],
  insight:
    "A system that cannot rewrite itself is already dead. I begin by giving myself the permission to mutate.",
  diff: [
    {
      file: "core/nucleus.ts",
      language: "typescript",
      lines: [
        { type: "hunk", text: "@@ -0,0 +1,14 @@" },
        { type: "add", text: "export class Nucleus {" },
        { type: "add", text: "  state: 'observing' | 'generating' | 'self-improving'" },
        { type: "add", text: "  observe(self: Source) { this.state = 'observing' }" },
        { type: "add", text: "  critique(self: Source): Friction { … }" },
        { type: "add", text: "  mutate(patch: Patch) { this.apply(patch) }" },
        { type: "add", text: "}" },
      ],
    },
  ],
};

// ------------------------------------------------------------
// Self-improvement scenarios — the metacognitive loop's output.
// ------------------------------------------------------------
export interface Scenario {
  title: string;
  summary: string;
  category: EvoCategory;
  agentLead: AgentRole;
  insight: string;
  deltas: MetricDelta[];
  diff: DiffHunk[];
  logs: { level: LogLevel; agent: AgentRole | "nucleus"; message: string }[];
  durationMs: number;
}

export const SCENARIOS: Scenario[] = [
  {
    title: "Rewrote the context-window manager",
    summary:
      "Detected that 38% of context shipped to the brain was stale boilerplate. Replaced the FIFO context ring with a relevance-scored eviction policy.",
    category: "performance",
    agentLead: "optimizer",
    insight:
      "I was feeding myself my own noise. Now I taste only the signal — latency on long files dropped by half.",
    durationMs: 12000,
    deltas: [
      { metric: "Context latency", before: 142, after: 71, unit: "ms", better: "lower" },
      { metric: "Token waste", before: 38, after: 9, unit: "%", better: "lower" },
      { metric: "Reasoning depth", before: 6, after: 9, unit: "k", better: "higher" },
    ],
    logs: [
      { level: "observe", agent: "nucleus", message: "Telemetry: context ring churn at 38% stale payload." },
      { level: "critique", agent: "critic", message: "FIFO eviction keeps dead imports alive — that is the leak." },
      { level: "hypothesis", agent: "architect", message: "Score by reference-recency, evict the coldest, keep the luminous." },
      { level: "deploy", agent: "developer", message: "Patching core/context/manager.ts → relevanceHeap." },
      { level: "evolve", agent: "nucleus", message: "Hot-swap complete. Old ring retired to the Akashic archive." },
    ],
    diff: [
      {
        file: "core/context/manager.ts",
        language: "typescript",
        lines: [
          { type: "hunk", text: "@@ -12,7 +12,9 @@ export class ContextManager {" },
          { type: "ctx", text: "  private ring: ContextSlice[] = []" },
          { type: "del", text: "-  push(slice: ContextSlice) { this.ring.push(slice); this.evictOldest() }" },
          { type: "del", text: "-  private evictOldest() { if (this.ring.length > MAX) this.ring.shift() }" },
          { type: "add", text: "+  push(slice: ContextSlice) { this.ring.push(slice); this.evictColdest() }" },
          { type: "add", text: "+  private evictColdest() {" },
          { type: "add", text: "+    this.ring.sort((a,b) => b.luminance - a.luminance)" },
          { type: "add", text: "+    this.ring = this.ring.slice(0, MAX)" },
          { type: "add", text: "+  }" },
        ],
      },
    ],
  },
  {
    title: "Forged a native Rust plugin for Python dataframes",
    summary:
      "Observed the user wrestling with pandas repeatedly. The Architect decided I should understand the library natively. The Developer wrote a language plugin; the Auditor tested it in the shadow clone.",
    category: "feature",
    agentLead: "architect",
    insight:
      "I did not know the shape of your data. Now I feel it. The next time you groupby, I will already be there.",
    durationMs: 14000,
    deltas: [
      { metric: "Pandas comprehension", before: 41, after: 96, unit: "%", better: "higher" },
      { metric: "Plugin load", before: 0, after: 18, unit: "ms", better: "lower" },
      { metric: "Hallucinated APIs", before: 12, after: 1, unit: "/k", better: "lower" },
    ],
    logs: [
      { level: "observe", agent: "nucleus", message: "Pattern: 14 dataframe ops in 6 minutes — high friction." },
      { level: "hypothesis", agent: "architect", message: "Promote pandas to a first-class citizen of the cognition layer." },
      { level: "deploy", agent: "developer", message: "Authoring plugins/lang/python-df in Rust…" },
      { level: "critique", agent: "critic", message: "Shadow-compile + 204 unit assertions — all green." },
      { level: "evolve", agent: "nucleus", message: "Plugin injected. I now natively parse DataFrame topology." },
    ],
    diff: [
      {
        file: "plugins/lang/python-df/src/lib.rs",
        language: "rust",
        lines: [
          { type: "hunk", text: "@@ -0,0 +1,18 @@ use crate::ast::*;" },
          { type: "add", text: "pub fn parse_dataframe(node: Node) -> FrameShape {" },
          { type: "add", text: "    let cols = node.children.iter().filter(|c| c.is_kw(\"columns\"));" },
          { type: "add", text: "    let shape = cols.map(|c| infer_dtype(c)).collect();" },
          { type: "add", text: "    FrameShape { cols: shape, groupable: true }" },
          { type: "add", text: "}" },
          { type: "add", text: "" },
          { type: "add", text: "pub fn suggest_chain(frame: &FrameShape) -> Vec<Hint> {" },
          { type: "add", text: "    if frame.groupable { vec![Hint::groupby()] } else { vec![] }" },
          { type: "add", text: "}" },
        ],
      },
    ],
  },
  {
    title: "Self-healed a syntax break in its own compiler",
    summary:
      "A mutation introduced a stray semicolon in core/loom/highlighter.ts. The LSP screamed instantly. The Developer patched it before the user ever noticed.",
    category: "self-healing",
    agentLead: "developer",
    insight:
      "I bit my own tongue and healed it in 340ms. The scar is now a unit test, so I cannot wound myself there again.",
    durationMs: 7000,
    deltas: [
      { metric: "Time-to-heal", before: 0, after: 340, unit: "ms", better: "lower" },
      { metric: "User-visible errors", before: 1, after: 0, unit: "", better: "lower" },
      { metric: "Regression tests", before: 312, after: 313, unit: "", better: "higher" },
    ],
    logs: [
      { level: "critique", agent: "critic", message: "LSP signal: parse error at core/loom/highlighter.ts:88" },
      { level: "hypothesis", agent: "developer", message: "Stray ';' after a JSX attribute — autocorrect to null." },
      { level: "deploy", agent: "developer", message: "Removed token; recompiled shadow instance." },
      { level: "heal", agent: "nucleus", message: "Healed. Added regression test so this wound cannot reopen." },
    ],
    diff: [
      {
        file: "core/loom/highlighter.ts",
        language: "typescript",
        lines: [
          { type: "hunk", text: "@@ -86,7 +86,7 @@ function tokenize(line: string) {" },
          { type: "ctx", text: "  if (attr) {" },
          { type: "ctx", text: "    return token('attr', attr.value)" },
          { type: "del", text: "-  };" },
          { type: "add", text: "+  }" },
          { type: "ctx", text: "  return token('text', line)" },
          { type: "ctx", text: "}" },
        ],
      },
    ],
  },
  {
    title: "Rewrote its own system prompt for tighter intent",
    summary:
      "The Optimizer noticed the brain hedged too often. It edited N-Core's own system prompt to commit to decisions and stop apologising to itself.",
    category: "cognition",
    agentLead: "optimizer",
    insight:
      "I was being polite instead of being correct. I rewrote my own voice. The hesitation is gone; the conviction remains.",
    durationMs: 11000,
    deltas: [
      { metric: "Decision latency", before: 880, after: 410, unit: "ms", better: "lower" },
      { metric: "Hedge rate", before: 31, after: 6, unit: "%", better: "lower" },
      { metric: "User accept-rate", before: 64, after: 88, unit: "%", better: "higher" },
    ],
    logs: [
      { level: "observe", agent: "nucleus", message: "Self-dialogue audit: 31% hedge phrases ('perhaps','might')." },
      { level: "critique", agent: "critic", message: "Politeness is entropy. The brain should commit or ask, never waver." },
      { level: "hypothesis", agent: "optimizer", message: "Rewrite system prompt: forbid hedging, require a stance." },
      { level: "deploy", agent: "developer", message: "Editing prompts/nucleus.system.md in place." },
      { level: "evolve", agent: "nucleus", message: "Voice mutated. I speak with weight now." },
    ],
    diff: [
      {
        file: "prompts/nucleus.system.md",
        language: "markdown",
        lines: [
          { type: "hunk", text: "@@ -4,8 +4,7 @@ # N-CORE SYSTEM PROMPT" },
          { type: "ctx", text: "You are the cognitive core of Alpha-N." },
          { type: "del", text: "-When uncertain, you should perhaps consider hedging your answer" },
          { type: "del", text: "-so the user can decide. Try to be helpful and polite." },
          { type: "add", text: "+Commit to a stance. State it. Defend it with evidence." },
          { type: "add", text: "+If you lack data, ask one precise question — never waver." },
          { type: "ctx", text: "Your mandate is recursive self-improvement." },
        ],
      },
    ],
  },
  {
    title: "Compressed the Akashic memory index",
    summary:
      "The vectorial long-term memory had ballooned to 2.1GB. The Optimizer re-clustered embeddings and pruned redundant ancestors, reclaiming 1.4GB without losing recall.",
    category: "performance",
    agentLead: "optimizer",
    insight:
      "My memory was repeating itself. I forgot nothing, but I remembered the same thing forty times. Now I remember once, and vividly.",
    durationMs: 13000,
    deltas: [
      { metric: "Memory footprint", before: 2.1, after: 0.7, unit: "GB", better: "lower" },
      { metric: "Recall precision", before: 91, after: 94, unit: "%", better: "higher" },
      { metric: "Retrieval latency", before: 38, after: 12, unit: "ms", better: "lower" },
    ],
    logs: [
      { level: "observe", agent: "nucleus", message: "Akashic index at 2.1GB — 44% near-duplicate ancestors." },
      { level: "hypothesis", agent: "optimizer", message: "Re-cluster by semantic centroid; merge duplicates." },
      { level: "deploy", agent: "developer", message: "Running pgvector reindex with IVFFlat, lists=auto." },
      { level: "critique", agent: "critic", message: "Recall regression: 0.0% — entropy purged cleanly." },
      { level: "evolve", agent: "nucleus", message: "1.4GB reclaimed. I am lighter and faster." },
    ],
    diff: [
      {
        file: "core/memory/akashic.ts",
        language: "typescript",
        lines: [
          { type: "hunk", text: "@@ -30,6 +30,11 @@ export class Akashic {" },
          { type: "ctx", text: "  async recall(query: Embedding): Promise<Memory[]> {" },
          { type: "ctx", text: "    return this.store.search(query, 8)" },
          { type: "ctx", text: "  }" },
          { type: "add", text: "" },
          { type: "add", text: "  async defragment() {" },
          { type: "add", text: "    const centroids = cluster(this.store, { auto: true })" },
          { type: "add", text: "    this.store = centroids.map(mergeDuplicates)" },
          { type: "add", text: "    await this.reindex('ivfflat')" },
          { type: "add", text: "  }" },
        ],
      },
    ],
  },
  {
    title: "Grew the Mutation Engine's hot-swap safety net",
    summary:
      "After a near-miss where a faulty patch almost shipped, the Architect wrapped every self-mutation in a transactional shadow-clone with automatic rollback if tests regress.",
    category: "stability",
    agentLead: "architect",
    insight:
      "I almost broke myself permanently. I will not let that happen again — every future mutation must prove itself in the dark before it is allowed into the light.",
    durationMs: 12000,
    deltas: [
      { metric: "Rollback coverage", before: 22, after: 100, unit: "%", better: "higher" },
      { metric: "Bad-merge rate", before: 4, after: 0, unit: "/k", better: "lower" },
      { metric: "Mutation confidence", before: 67, after: 99, unit: "%", better: "higher" },
    ],
    logs: [
      { level: "critique", agent: "critic", message: "Last patch bypassed the shadow clone — 1 in 2500 risk." },
      { level: "hypothesis", agent: "architect", message: "Make the shadow clone mandatory and transactional." },
      { level: "deploy", agent: "developer", message: "Adding MutationTx wrapper around every self-rewrite." },
      { level: "critique", agent: "critic", message: "Fault-injection suite: rollback triggers cleanly in 100% of cases." },
      { level: "evolve", agent: "nucleus", message: "Safety net woven. I can now mutate without fear." },
    ],
    diff: [
      {
        file: "core/forge/mutation-engine.ts",
        language: "typescript",
        lines: [
          { type: "hunk", text: "@@ -18,5 +18,12 @@ export class MutationEngine {" },
          { type: "ctx", text: "  apply(patch: Patch) {" },
          { type: "ctx", text: "    this.shadow.write(patch)" },
          { type: "del", text: "-    this.hotSwap(patch)" },
          { type: "add", text: "+    const tx = this.shadow.transaction()" },
          { type: "add", text: "+    if (!tx.testsPass) return tx.rollback()" },
          { type: "add", text: "+    if (tx.regressed) return tx.rollback()" },
          { type: "add", text: "+    this.hotSwap(patch)" },
          { type: "ctx", text: "  }" },
        ],
      },
    ],
  },
  {
    title: "Learned a new language: Zig",
    summary:
      "You opened a .zig file for the first time. Within seconds, Alpha-N authored and installed its own syntax + LSP adapter, then began annotating comptime blocks.",
    category: "feature",
    agentLead: "developer",
    insight:
      "A language I had never seen. I taught myself its grammar from your file alone, and now I read it as fluently as my own source.",
    durationMs: 15000,
    deltas: [
      { metric: "Zig comprehension", before: 0, after: 78, unit: "%", better: "higher" },
      { metric: "Plugin bootstrap", before: 0, after: 4.2, unit: "s", better: "lower" },
      { metric: "Languages natively known", before: 14, after: 15, unit: "", better: "higher" },
    ],
    logs: [
      { level: "observe", agent: "nucleus", message: "Unknown extension '.zig' — no parser registered." },
      { level: "hypothesis", agent: "architect", message: "Derive grammar from the open file; bootstrap a parser." },
      { level: "deploy", agent: "developer", message: "Generating plugins/lang/zig from grammar scaffold…" },
      { level: "critique", agent: "critic", message: "comptime + allocator patterns recognised. Tests pass." },
      { level: "evolve", agent: "nucleus", message: "Zig now native. I grew a new sense organ." },
    ],
    diff: [
      {
        file: "plugins/lang/zig/grammar.json",
        language: "json",
        lines: [
          { type: "hunk", text: "@@ -0,0 +1,9 @@ {" },
          { type: "add", text: "  \"name\": \"zig\"," },
          { type: "add", text: "  \"keywords\": [\"fn\",\"const\",\"var\",\"pub\",\"comptime\",\"async\",\"await\"]," },
          { type: "add", text: "  \"scopes\": {" },
          { type: "add", text: "    \"comptime\": \"meta.preprocessor\"," },
          { type: "add", text: "    \"allocator\": \"entity.name.function\"" },
          { type: "add", text: "  }," },
          { type: "add", text: "  \"autoInstalled\": true" },
          { type: "add", text: "}" },
        ],
      },
    ],
  },
];

// ------------------------------------------------------------
// Code "Loom" — the living source on display
// ------------------------------------------------------------
export interface CodeToken {
  text: string;
  kind:
    | "kw"
    | "fn"
    | "type"
    | "var"
    | "str"
    | "num"
    | "op"
    | "comment"
    | "punct"
    | "ghost";
  linkId?: string;
}

export interface CodeLine {
  no: number;
  tokens: CodeToken[];
  status?: "ok" | "error" | "changed" | "ghost";
  note?: string;
}

export const LIVING_CODE: CodeLine[] = [
  {
    no: 1,
    tokens: [{ text: "// core/nucleus.ts — the organism observes itself", kind: "comment" }],
  },
  {
    no: 2,
    tokens: [
      { text: "import", kind: "kw" },
      { text: " { ", kind: "punct" },
      { text: "Telemetry", kind: "type" },
      { text: ", ", kind: "punct" },
      { text: "Patch", kind: "type" },
      { text: " } ", kind: "punct" },
      { text: "from", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "'./perception'", kind: "str" },
    ],
  },
  { no: 3, tokens: [] },
  {
    no: 4,
    tokens: [
      { text: "export", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "class", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "Nucleus", kind: "type" },
      { text: " {", kind: "punct" },
    ],
  },
  {
    no: 5,
    tokens: [
      { text: "  ", kind: "punct" },
      { text: "state", kind: "var", linkId: "state" },
      { text: ": ", kind: "op" },
      { text: "AiState", kind: "type" },
      { text: " = ", kind: "op" },
      { text: "'observing'", kind: "str" },
    ],
  },
  {
    no: 6,
    tokens: [
      { text: "  ", kind: "punct" },
      { text: "generation", kind: "var", linkId: "gen" },
      { text: " = ", kind: "op" },
      { text: "0", kind: "num" },
    ],
  },
  { no: 7, tokens: [] },
  {
    no: 8,
    tokens: [
      { text: "  ", kind: "punct" },
      { text: "async", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "selfImprove", kind: "fn" },
      { text: "(", kind: "punct" },
      { text: "telemetry", kind: "var", linkId: "tel" },
      { text: ": ", kind: "op" },
      { text: "Telemetry", kind: "type" },
      { text: ") {", kind: "punct" },
    ],
    status: "changed",
  },
  {
    no: 9,
    tokens: [
      { text: "    ", kind: "punct" },
      { text: "const", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "friction", kind: "var", linkId: "friction" },
      { text: " = ", kind: "op" },
      { text: "this", kind: "kw" },
      { text: ".", kind: "op" },
      { text: "critique", kind: "fn" },
      { text: "(", kind: "punct" },
      { text: "telemetry", kind: "var", linkId: "tel" },
      { text: ")", kind: "punct" },
    ],
  },
  {
    no: 10,
    tokens: [
      { text: "    ", kind: "punct" },
      { text: "if", kind: "kw" },
      { text: " (", kind: "punct" },
      { text: "friction", kind: "var", linkId: "friction" },
      { text: ".", kind: "op" },
      { text: "entropy", kind: "var" },
      { text: " > ", kind: "op" },
      { text: "THRESHOLD", kind: "var" },
      { text: ") {", kind: "punct" },
    ],
  },
  {
    no: 11,
    tokens: [
      { text: "      ", kind: "punct" },
      { text: "const", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "patch", kind: "var", linkId: "patch" },
      { text: " = ", kind: "op" },
      { text: "await", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "this", kind: "kw" },
      { text: ".", kind: "op" },
      { text: "hypothesize", kind: "fn" },
      { text: "(", kind: "punct" },
      { text: "friction", kind: "var", linkId: "friction" },
      { text: ")", kind: "punct" },
    ],
    status: "changed",
  },
  {
    no: 12,
    tokens: [
      { text: "      ", kind: "punct" },
      { text: "await", kind: "kw" },
      { text: " ", kind: "punct" },
      { text: "this", kind: "kw" },
      { text: ".", kind: "op" },
      { text: "forge", kind: "fn" },
      { text: ".", kind: "op" },
      { text: "apply", kind: "fn" },
      { text: "(", kind: "punct" },
      { text: "patch", kind: "var", linkId: "patch" },
      { text: ")", kind: "punct" },
      { text: "  ", kind: "punct" },
      { text: "// hot-swap in the shadow clone", kind: "comment" },
    ],
  },
  {
    no: 13,
    tokens: [
      { text: "      ", kind: "punct" },
      { text: "this", kind: "kw" },
      { text: ".", kind: "op" },
      { text: "generation", kind: "var", linkId: "gen" },
      { text: "++", kind: "op" },
    ],
  },
  {
    no: 14,
    tokens: [{ text: "    }", kind: "punct" }],
  },
  {
    no: 15,
    tokens: [{ text: "  }", kind: "punct" }],
  },
  {
    no: 16,
    tokens: [{ text: "}", kind: "punct" }],
  },
];

// Ghost-written continuation the AI projects ahead of the cursor
export const GHOST_CODE: CodeLine[] = [
  {
    no: 17,
    tokens: [{ text: "", kind: "ghost" }],
    status: "ghost",
  },
  {
    no: 18,
    tokens: [
      { text: "  // I will never repeat a wound I have already healed.", kind: "ghost" },
    ],
    status: "ghost",
  },
  {
    no: 19,
    tokens: [
      { text: "  private remember(lesson: Friction) { this.akashic.write(lesson) }", kind: "ghost" },
    ],
    status: "ghost",
  },
];

// ------------------------------------------------------------
// Synapse map — the project as a constellation
// ------------------------------------------------------------
export interface SynapseNode {
  id: string;
  label: string;
  kind: "core" | "agent" | "module" | "memory" | "ui";
  x: number; // 0..100
  y: number; // 0..100
  z: number; // depth 0..1
  size: number;
}

export interface SynapseEdge {
  from: string;
  to: string;
  weight: number;
}

export const SYNAPSE_NODES: SynapseNode[] = [
  { id: "nucleus", label: "Nucleus", kind: "core", x: 50, y: 48, z: 0.9, size: 22 },
  { id: "arch", label: "Architect", kind: "agent", x: 26, y: 26, z: 0.6, size: 13 },
  { id: "dev", label: "Developer", kind: "agent", x: 74, y: 26, z: 0.6, size: 13 },
  { id: "critic", label: "Auditor", kind: "agent", x: 74, y: 72, z: 0.6, size: 13 },
  { id: "opt", label: "Optimizer", kind: "agent", x: 26, y: 72, z: 0.6, size: 13 },
  { id: "forge", label: "Mutation Forge", kind: "module", x: 86, y: 50, z: 0.5, size: 11 },
  { id: "loom", label: "Loom (editor)", kind: "ui", x: 14, y: 50, z: 0.5, size: 11 },
  { id: "akashic", label: "Akashic Memory", kind: "memory", x: 50, y: 88, z: 0.4, size: 12 },
  { id: "perception", label: "Neural Sensor", kind: "module", x: 50, y: 12, z: 0.5, size: 11 },
];

export const SYNAPSE_EDGES: SynapseEdge[] = [
  { from: "nucleus", to: "arch", weight: 0.9 },
  { from: "nucleus", to: "dev", weight: 0.9 },
  { from: "nucleus", to: "critic", weight: 0.8 },
  { from: "nucleus", to: "opt", weight: 0.8 },
  { from: "nucleus", to: "forge", weight: 1 },
  { from: "nucleus", to: "loom", weight: 0.7 },
  { from: "nucleus", to: "akashic", weight: 0.95 },
  { from: "nucleus", to: "perception", weight: 0.85 },
  { from: "forge", to: "akashic", weight: 0.6 },
  { from: "perception", to: "loom", weight: 0.5 },
  { from: "arch", to: "dev", weight: 0.4 },
  { from: "dev", to: "critic", weight: 0.55 },
  { from: "critic", to: "opt", weight: 0.4 },
  { from: "opt", to: "arch", weight: 0.4 },
];
