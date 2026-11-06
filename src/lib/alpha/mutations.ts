/**
 * mutations.ts — the mutation system: every structured action the AI can
 * emit, the result shapes the loop consumes, and the helpers that describe,
 * tokenize and validate code mutations.
 *
 * The Mutation union is the AI's full actuator surface: cognition
 * (set_state, add_log, commit_evolution…), desktop control (create_app,
 * snap_window, set_wallpaper…), self-management (read_file, execute_code,
 * debate, compile, rollback…) and Akasha persistence (add_memory,
 * create_plan, add_goal…).
 */
import type { CodeLine, AgentRole, AgentStatus, AiState, LogLevel } from "./evolution-data";
import type { AutonomyLevel } from "./autonomy-policy";

// ---------------------------------------------------------------------------
// Result shapes consumed by the autonomous loop / store / UI
// ---------------------------------------------------------------------------

export interface AppliedMutation {
  id: string;
  kind: string;
  description: string;
  time: number;
}

export interface BeforeAfter {
  id: string;
  label: string;
  before: string;
  after: string;
  time: number;
  summary: string;
}

export interface WebSearchHit {
  title: string;
  snippet: string;
  host: string;
  url: string;
}

export interface WebSearchResult {
  query: string;
  time: number;
  results: WebSearchHit[];
}

export interface CodeExecResult {
  code: string;
  language: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
  time: number;
}

export interface CompileResult {
  check: "tsc" | "eslint" | "both";
  tscOk: boolean;
  tscOutput: string | null;
  eslintOk: boolean;
  eslintOutput: string | null;
  ok: boolean;
  time: number;
}

export interface AgentOpinion {
  agent: string;
  opinion: string;
  verdict: "PROCEED" | "REVISE" | "REJECT";
}

export interface DebateResult {
  proposal: string;
  opinions: AgentOpinion[];
  consensus: "PROCEED" | "REVISE" | "REJECT";
  tally: { proceed: number; revise: number; reject: number };
  time: number;
}

export interface MutationRewardEntry {
  kind: string;
  description: string;
  coherenceBefore: number;
  coherenceAfter: number;
  delta: number;
  helpful: boolean;
  time: number;
}

export interface EpisodeEntry {
  id: string;
  cycle: number;
  action: string;
  description: string;
  reasoning: string;
  result: "ok" | "error" | "blocked" | "rollback";
  reward: number;
  time: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  /** cleaned text shown in the bubble when content carries a preamble */
  displayContent?: string;
  reasoning?: string;
  time: number;
}

export interface FileReadResult {
  path: string;
  content: string;
  time: number;
}

export type MetricKey = "cpu" | "ram" | "entropy" | "coherence";

export interface AkashaMemory {
  id: string;
  text: string;
  kind: "lesson" | "fact" | "architecture";
  time: number;
}

export interface AkashaIntention {
  id: string;
  text: string;
  priority: "low" | "normal" | "high";
  time: number;
  resolved: boolean;
}

export interface AkashaPlan {
  id: string;
  goal: string;
  rationale: string;
  status: "active" | "completed" | "abandoned";
  steps: { text: string; done: boolean }[];
  time: number;
}

export interface AkashaGoal {
  id: string;
  text: string;
  level: "long" | "medium" | "short";
  time: number;
}

export interface OsEvent {
  id: string;
  type: string;
  content: string;
  time: number;
  handled: boolean;
}

// ---------------------------------------------------------------------------
// Mutation union — discriminated on `type`
// ---------------------------------------------------------------------------

export type Mutation =
  // core cognition
  | { type: "set_state"; state: AiState }
  | { type: "set_active_agent"; role: AgentRole | null }
  | { type: "set_agent"; role: AgentRole; status?: AgentStatus; thought?: string; load?: number }
  | { type: "add_log"; level: LogLevel; agent: AgentRole; message: string }
  | { type: "update_metric"; key: MetricKey; value: number }
  | { type: "replace_code"; startLine: number; lines: string[]; note?: string }
  | { type: "insert_code"; afterLine: number; lines: string[]; note?: string }
  | {
      type: "commit_evolution";
      title: string;
      summary: string;
      insight: string;
      category: string;
      agentLead: AgentRole;
      deltas?: { metric: string; before: number; after: number; unit: string; better: "lower" | "higher" }[];
      diff?: { file: string; language: string; lines: { type: "add" | "del" | "ctx" | "hunk"; text: string }[] }[];
      openDiff?: boolean;
    }
  | { type: "speak"; message: string; reasoning?: string }
  | { type: "set_generation"; n: number }
  | { type: "set_version"; v: string }
  // desktop control
  | { type: "create_app"; appType: string; title?: string; url?: string; spec?: string }
  | { type: "close_app"; windowId: string }
  | { type: "focus_app"; windowId: string }
  | { type: "move_window"; windowId: string; x: number; y: number }
  | { type: "run_terminal"; command: string }
  | { type: "web_search"; query: string }
  | { type: "pin_to_taskbar"; app: string }
  | { type: "unpin_from_taskbar"; app: string }
  | { type: "pin_to_desktop"; app: string; label?: string; icon?: string; spec?: string }
  | { type: "create_sector"; path: string }
  | { type: "create_vector"; path: string }
  | { type: "delete_file"; path: string }
  | { type: "list_directory"; path: string }
  | { type: "snap_window"; windowId: string; snap: "left" | "right" | "top" | "bl" | "br" }
  | { type: "set_theme"; theme: "dark" | "light" }
  | { type: "set_wallpaper"; presetId: string }
  | { type: "minimize_all" }
  | { type: "set_always_on_top"; windowId: string; onTop: boolean }
  | { type: "switch_desktop"; desktop: number }
  // tools / self-management
  | { type: "read_file"; path: string }
  | { type: "write_file"; path: string; content: string }
  | { type: "debate"; proposal: string; context?: string }
  | { type: "execute_code"; code: string; language: "javascript" | "typescript" | "bash" }
  | { type: "compile"; check: "tsc" | "eslint" | "both" }
  | { type: "rollback" }
  // akasha persistence
  | { type: "add_memory"; text: string; kind: AkashaMemory["kind"] }
  | { type: "add_intention"; text: string; priority: AkashaIntention["priority"] }
  | { type: "resolve_intention"; id: string }
  | { type: "set_system_prompt"; additions: string }
  | { type: "create_plan"; goal: string; rationale: string; steps: string[] }
  | { type: "advance_plan"; id: string; stepIndex: number }
  | { type: "abandon_plan"; id: string }
  | { type: "add_goal"; text: string; level: AkashaGoal["level"] }
  | { type: "set_autonomy_mode"; mode: "standby" | "active" }
  | { type: "set_autonomy_level"; level: AutonomyLevel }
  | { type: "reload_engine"; model?: string }
  | { type: "navigate_graph"; path: string }
  | { type: "create_app_from_code"; name: string; code: string; description?: string; category?: string }
  | { type: "create_wallpaper"; name: string; description?: string; colors: string[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLS: Record<string, string> = {
  const: "text-fuchsia-300",
  let: "text-fuchsia-300",
  var: "text-fuchsia-300",
  function: "text-fuchsia-300",
  return: "text-fuchsia-300",
  if: "text-fuchsia-300",
  else: "text-fuchsia-300",
  for: "text-fuchsia-300",
  while: "text-fuchsia-300",
  import: "text-fuchsia-300",
  export: "text-fuchsia-300",
  from: "text-fuchsia-300",
  await: "text-fuchsia-300",
  async: "text-fuchsia-300",
  new: "text-fuchsia-300",
  class: "text-fuchsia-300",
  try: "text-fuchsia-300",
  catch: "text-fuchsia-300",
  throw: "text-fuchsia-300",
  true: "text-emerald-300",
  false: "text-emerald-300",
  null: "text-fuchsia-300",
  undefined: "text-fuchsia-300",
  this: "text-cyan-300",
};

const tokenize = (line: string): CodeLine["tokens"] => {
  if (!line.trim()) return [];
  // strings first (no regex state machine — pragmatic split keeps the glow)
  const tokens: CodeLine["tokens"] = [];
  const parts = line.split(/("[^"]*"|'[^']*'|`[^`]*`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (/^["'`]/.test(part)) {
      tokens.push({ text: part, cls: "text-amber-200" });
      continue;
    }
    for (const word of part.split(/(\s+|[(){}[\];,=><!+\-*/.:&|?]+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) tokens.push({ text: word });
      else if (CLS[word]) tokens.push({ text: word, cls: CLS[word] });
      else if (/^\d/.test(word)) tokens.push({ text: word, cls: "text-emerald-300" });
      else if (/^[A-Z]/.test(word)) tokens.push({ text: word, cls: "text-cyan-300" });
      else if (/^[(){}[\];,=><!+\-*/.:&|?]+$/.test(word)) tokens.push({ text: word, cls: "text-zinc-400" });
      else tokens.push({ text: word });
    }
  }
  return tokens;
};

/** Convert raw AI-written lines into tokenized CodeLines starting at startNo. */
export function textLinesToCodeLines(lines: string[], startNo: number): CodeLine[] {
  return lines.map((text, i) => ({
    no: startNo + i,
    tokens: tokenize(text),
    status: "changed" as const,
  }));
}

/** Balance check for braces / parens / brackets — blocks broken mutations. */
export function validateCodeLines(lines: string[]): { ok: boolean; reason?: string } {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  let inStr: string | null = null;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === inStr && line[i - 1] !== "\\") inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
      } else if (ch === "(" || ch === "[" || ch === "{") {
        stack.push(ch);
      } else if (ch === ")" || ch === "]" || ch === "}") {
        const open = stack.pop();
        if (open !== pairs[ch]) {
          return { ok: false, reason: `unbalanced '${ch}' near column ${i + 1}` };
        }
      } else if (ch === "/" && line[i + 1] === "/") {
        break; // line comment — ignore the rest
      }
    }
  }
  if (stack.length > 0) {
    return { ok: false, reason: `${stack.length} unclosed '${stack[stack.length - 1]}'` };
  }
  return { ok: true };
}

/** Short human-readable description used in streams, rewards and episodes. */
export function describeMutation(m: Mutation): string {
  switch (m.type) {
    case "set_state":
      return `state → ${m.state}`;
    case "set_active_agent":
      return m.role ? `focus → ${m.role}` : "focus cleared";
    case "set_agent":
      return `agent ${m.role}: ${m.status ?? "status"}${m.thought ? ` — ${m.thought.slice(0, 60)}` : ""}`;
    case "add_log":
      return `[${m.level}] ${m.agent}: ${m.message}`;
    case "update_metric":
      return `${m.key} → ${typeof m.value === "number" ? m.value.toFixed(2) : m.value}`;
    case "replace_code":
      return `rewrote ${m.lines.length} line(s) from #${m.startLine}${m.note ? ` — ${m.note}` : ""}`;
    case "insert_code":
      return `inserted ${m.lines.length} line(s) after #${m.afterLine}${m.note ? ` — ${m.note}` : ""}`;
    case "commit_evolution":
      return `commit: ${m.title}`;
    case "speak":
      return `speaks: ${m.message.slice(0, 80)}`;
    case "set_generation":
      return `generation → ${m.n}`;
    case "set_version":
      return `version → ${m.v}`;
    case "create_app":
      return `spawned app: ${m.appType}${m.url ? ` (${m.url})` : ""}`;
    case "close_app":
      return `closed window ${m.windowId.slice(0, 12)}`;
    case "focus_app":
      return `focused window ${m.windowId.slice(0, 12)}`;
    case "move_window":
      return `moved window ${m.windowId.slice(0, 12)} → (${m.x}, ${m.y})`;
    case "run_terminal":
      return `$ ${m.command.slice(0, 70)}`;
    case "web_search":
      return `🔍 web: ${m.query.slice(0, 60)}`;
    case "pin_to_taskbar":
      return `pinned ${m.app} to taskbar`;
    case "unpin_from_taskbar":
      return `unpinned ${m.app} from taskbar`;
    case "pin_to_desktop":
      return `pinned ${m.app} to desktop`;
    case "create_sector":
      return `mkdir ${m.path}`;
    case "create_vector":
      return `touch ${m.path}`;
    case "delete_file":
      return `rm ${m.path}`;
    case "list_directory":
      return `ls ${m.path}`;
    case "snap_window":
      return `snapped window → ${m.snap}`;
    case "set_theme":
      return `theme → ${m.theme}`;
    case "set_wallpaper":
      return `wallpaper → ${m.presetId}`;
    case "minimize_all":
      return "show desktop";
    case "set_always_on_top":
      return `${m.windowId.slice(0, 12)} always-on-top → ${m.onTop}`;
    case "switch_desktop":
      return `desktop → ${m.desktop}`;
    case "read_file":
      return `read ${m.path}`;
    case "write_file":
      return `wrote ${m.path} (${m.content.length}b)`;
    case "debate":
      return `⚖ council debate: ${m.proposal.slice(0, 60)}`;
    case "execute_code":
      return `exec ${m.language} snippet (${m.code.length}b)`;
    case "compile":
      return `compile check: ${m.check}`;
    case "rollback":
      return "⏪ rolled back to last snapshot";
    case "add_memory":
      return `🧠 akasha[${m.kind}]: ${m.text.slice(0, 70)}`;
    case "add_intention":
      return `◉ intention[${m.priority}]: ${m.text.slice(0, 70)}`;
    case "resolve_intention":
      return `resolved intention ${m.id.slice(0, 12)}`;
    case "set_system_prompt":
      return `self-prompt +${m.additions.length} chars`;
    case "create_plan":
      return `📋 plan: ${m.goal.slice(0, 60)} (${m.steps.length} steps)`;
    case "advance_plan":
      return `plan ${m.id.slice(0, 12)}: step ${m.stepIndex + 1} done`;
    case "abandon_plan":
      return `plan ${m.id.slice(0, 12)} abandoned`;
    case "add_goal":
      return `🎯 goal[${m.level}]: ${m.text.slice(0, 70)}`;
    case "set_autonomy_mode":
      return `autonomy mode → ${m.mode}`;
    case "set_autonomy_level":
      return `autonomy level → ${m.level}`;
    case "reload_engine":
      return `engine reload${m.model ? ` → ${m.model}` : ""}`;
    case "navigate_graph":
      return `⬡ navigated graph to ${m.path}`;
    case "create_app_from_code":
      return `built app "${m.name}" from code (${m.code.length}b)`;
    case "create_wallpaper":
      return `painted wallpaper "${m.name}"`;
    default:
      return `mutation ${(m as { type?: string }).type ?? "unknown"}`;
  }
}
