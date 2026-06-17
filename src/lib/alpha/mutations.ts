// ============================================================
// Alpha-N — Mutation system
// The structured language through which N-Core rewrites its own UI.
// The LLM emits an array of these; the client applies them live.
// ============================================================

import type {
  AgentRole,
  AgentStatus,
  AiState,
  CodeLine,
  CodeToken,
  DiffHunk,
  EvoCategory,
  LogLevel,
  MetricDelta,
} from "./evolution-data";

export type MetricKey = "cpu" | "ram" | "entropy" | "coherence";

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  time: number;
  reasoning?: string; // AI's private reasoning, shown collapsed
}

export interface AppliedMutation {
  id: string;
  kind: string;
  description: string;
  time: number;
}

export interface BeforeAfter {
  id: string;
  label: string;
  before: string; // data URL
  after: string; // data URL
  time: number;
  summary: string;
}

// ---- The mutation union ----
export type Mutation =
  | { type: "set_state"; state: AiState }
  | { type: "set_active_agent"; role: AgentRole | null }
  | {
      type: "set_agent";
      role: AgentRole;
      status?: AgentStatus;
      thought?: string;
      load?: number;
    }
  | {
      type: "add_log";
      level: LogLevel;
      agent: AgentRole | "nucleus";
      message: string;
    }
  | { type: "update_metric"; key: MetricKey; value: number }
  | {
      type: "replace_code";
      startLine: number;
      lines: string[]; // plain text lines; tokenized client-side
      note?: string;
    }
  | {
      type: "insert_code";
      afterLine: number;
      lines: string[];
    }
  | {
      type: "commit_evolution";
      title: string;
      summary: string;
      insight: string;
      category: EvoCategory;
      agentLead: AgentRole;
      deltas?: MetricDelta[];
      diff?: DiffHunk[];
      openDiff?: boolean;
    }
  | { type: "speak"; message: string; reasoning?: string }
  | { type: "set_generation"; n: number }
  | { type: "set_version"; v: string }
  // ---- Alpha-OS desktop mutations ----
  | {
      type: "create_app";
      appType:
        | "terminal"
        | "editor"
        | "files"
        | "browser"
        | "monitor"
        | "evolution"
        | "agents"
        | "security"
        | "custom";
      title?: string;
      url?: string; // for browser
      spec?: string; // for custom apps: a description of what the app does
    }
  | { type: "close_app"; windowId: string }
  | { type: "focus_app"; windowId: string }
  | { type: "move_window"; windowId: string; x: number; y: number }
  | { type: "run_terminal"; command: string }
  | { type: "web_search"; query: string }
  | { type: "add_memory"; text: string; kind: "lesson" | "fact" | "architecture" }
  | { type: "add_intention"; text: string; priority: "low" | "normal" | "high" }
  | { type: "resolve_intention"; id: string }
  | { type: "rollback" };

// ---- Web search result (fed back to the AI) ----
export interface WebSearchResult {
  query: string;
  time: number;
  results: { rank: number; title: string; url: string; snippet: string; host: string; date: string }[];
}

// ---- Akasha: persistent memory the AI never forgets ----
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

// ---- Code validation: detects obviously broken AI output ----
export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateCodeLines(lines: string[]): ValidationResult {
  // Check brace balance across the lines being inserted/replaced
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const line of lines) {
    // skip string contents naively (good enough for safety check)
    const stripped = line.replace(/\/\/.*$/, "").replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const ch of stripped) {
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "(") parens++;
      else if (ch === ")") parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
  }
  if (Math.abs(braces) > 0) return { ok: false, reason: `unbalanced braces (Δ${braces})` };
  if (Math.abs(parens) > 0) return { ok: false, reason: `unbalanced parens (Δ${parens})` };
  if (Math.abs(brackets) > 0) return { ok: false, reason: `unbalanced brackets (Δ${brackets})` };
  return { ok: true };
}

// ---- A pragmatic TypeScript-ish tokenizer ----
// Good enough to give AI-written code the same living glow.
const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "class",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "if",
  "else",
  "return",
  "for",
  "while",
  "new",
  "this",
  "type",
  "interface",
  "extends",
  "implements",
  "public",
  "private",
  "protected",
  "readonly",
  "static",
  "void",
  "null",
  "undefined",
  "true",
  "false",
  "as",
  "in",
  "of",
  "try",
  "catch",
  "finally",
  "throw",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "enum",
]);

export function tokenizeLine(text: string): CodeToken[] {
  if (!text) return [];
  const tokens: CodeToken[] = [];
  // regex captures: comments, strings, numbers, identifiers, operators, whitespace
  const re =
    /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\d+\.?\d*)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([{}()\[\].,;:<>+\-*/%=&|!?]+)/g;
  let m: RegExpExecArray | null;
  let lastWasFn = false;
  while ((m = re.exec(text)) !== null) {
    const [full, comment, str, num, ident, ws, punct] = m;
    if (ws !== undefined) {
      tokens.push({ text: ws, kind: "punct" });
      lastWasFn = false;
      continue;
    }
    if (comment !== undefined) {
      tokens.push({ text: comment, kind: "comment" });
      lastWasFn = false;
      continue;
    }
    if (str !== undefined) {
      tokens.push({ text: str, kind: "str" });
      lastWasFn = false;
      continue;
    }
    if (num !== undefined) {
      tokens.push({ text: num, kind: "num" });
      lastWasFn = false;
      continue;
    }
    if (ident !== undefined) {
      if (KEYWORDS.has(ident)) {
        tokens.push({ text: ident, kind: "kw" });
        lastWasFn = false;
      } else if (/^[A-Z]/.test(ident)) {
        tokens.push({ text: ident, kind: "type" });
        lastWasFn = false;
      } else {
        // look ahead for "(" => function call
        const rest = text.slice(re.lastIndex);
        const isFn = /^\s*\(/.test(rest);
        if (isFn || lastWasFn) {
          tokens.push({ text: ident, kind: "fn" });
        } else {
          tokens.push({ text: ident, kind: "var" });
        }
        lastWasFn = false;
      }
      continue;
    }
    if (punct !== undefined) {
      tokens.push({ text: punct, kind: "op" });
      lastWasFn = false;
      continue;
    }
    // fallback
    tokens.push({ text: full, kind: "var" });
  }
  return tokens;
}

export function textLinesToCodeLines(
  lines: string[],
  startNo: number
): CodeLine[] {
  return lines.map((text, i) => ({
    no: startNo + i,
    tokens: tokenizeLine(text),
    status: "changed" as const,
  }));
}

// Description helper for the optimization stream
export function describeMutation(m: Mutation): string {
  switch (m.type) {
    case "set_state":
      return `nucleus → ${m.state}`;
    case "set_active_agent":
      return `focus → ${m.role ?? "none"}`;
    case "set_agent":
      return `${m.role}: ${m.status ?? "active"} · ${(m.thought ?? "").slice(0, 48)}`;
    case "add_log":
      return `[${m.level}] ${m.agent}: ${m.message.slice(0, 60)}`;
    case "update_metric":
      return `${m.key} = ${m.value}`;
    case "replace_code":
      return `rewrote L${m.startLine}–${m.startLine + m.lines.length - 1}${m.note ? ` · ${m.note}` : ""}`;
    case "insert_code":
      return `inserted ${m.lines.length} lines after L${m.afterLine}`;
    case "commit_evolution":
      return `COMMIT · ${m.title.slice(0, 50)}`;
    case "speak":
      return `spoke: ${m.message.slice(0, 60)}`;
    case "set_generation":
      return `generation = ${m.n}`;
    case "set_version":
      return `version = ${m.v}`;
    case "create_app":
      return `spawned app: ${m.title ?? m.appType}${m.url ? ` → ${m.url}` : ""}`;
    case "close_app":
      return `closed window ${m.windowId.slice(0, 8)}`;
    case "focus_app":
      return `focused window ${m.windowId.slice(0, 8)}`;
    case "move_window":
      return `moved window ${m.windowId.slice(0, 8)} → (${m.x},${m.y})`;
    case "run_terminal":
      return `$ ${m.command.slice(0, 64)}`;
    case "web_search":
      return `🔍 web: "${m.query.slice(0, 56)}"`;
    case "add_memory":
      return `🧠 akasha: ${m.text.slice(0, 56)}`;
    case "add_intention":
      return `◉ intention[${m.priority}]: ${m.text.slice(0, 56)}`;
    case "resolve_intention":
      return `✓ resolved intention ${m.id.slice(0, 8)}`;
    case "rollback":
      return `↺ ROLLBACK — restored previous snapshot`;
  }
}
