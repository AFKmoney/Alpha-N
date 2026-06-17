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
  | { type: "set_version"; v: string };

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
  }
}
