/**
 * calculator-app.tsx — Alpha-OS Calculator (standard + scientific).
 *
 * Purpose: a full calculator with a hand-rolled recursive-descent expression
 * evaluator (NO eval()), live result preview, keyboard support, degree/radian
 * trig modes, and a 20-entry history persisted to localStorage.
 *
 * Browser-API compatibility:
 *  - localStorage is wrapped in try/catch (private mode / quota errors degrade
 *    to in-memory history only).
 *  - No other browser APIs are required; works everywhere.
 */
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================ EXPRESSION EVALUATOR ============================

type Token = { t: "num" | "id" | "op"; v: string };

const FUNCS: Record<string, (x: number) => number> = {
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  sqrt: (x) => Math.sqrt(x),
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  abs: (x) => Math.abs(x),
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Tokenize a (possibly pretty-printed) expression into numbers/identifiers/operators. */
function tokenize(src: string): Token[] {
  const s = src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi");
  const toks: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i += 1;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const v = s.slice(i, j);
      if (!/^\d+(\.\d*)?$|^\.\d+$/.test(v)) throw new Error(`bad number "${v}"`);
      toks.push({ t: "num", v });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j += 1;
      toks.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
    } else if ("+-*/%^()".includes(c)) {
      toks.push({ t: "op", v: c });
      i += 1;
    } else {
      throw new Error(`unexpected "${c}"`);
    }
  }
  return toks;
}

/** Recursive-descent parser. Grammar (highest last):
 *  expr   := term (('+'|'-') term)*
 *  term   := power (('*'|'/'|'%') power)*
 *  power  := unary ('^' power)?          (right associative)
 *  unary  := '-' unary | primary
 *  primary:= num | const | func '(' expr ')' | '(' expr ')'
 */
class ExprParser {
  private pos = 0;

  constructor(private readonly toks: Token[], private readonly degrees: boolean) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new Error("unexpected trailing input");
    return v;
  }

  private peek(): Token | null {
    return this.pos < this.toks.length ? this.toks[this.pos] : null;
  }

  private eatOp(...ops: string[]): string | null {
    const tk = this.peek();
    if (tk && tk.t === "op" && ops.includes(tk.v)) {
      this.pos += 1;
      return tk.v;
    }
    return null;
  }

  private expr(): number {
    let v = this.term();
    for (;;) {
      const op = this.eatOp("+", "-");
      if (!op) return v;
      const rhs = this.term();
      v = op === "+" ? v + rhs : v - rhs;
    }
  }

  private term(): number {
    let v = this.power();
    for (;;) {
      const op = this.eatOp("*", "/", "%");
      if (!op) return v;
      const rhs = this.power();
      if (op === "*") v = v * rhs;
      else if (op === "/") {
        if (rhs === 0) throw new Error("division by zero");
        v = v / rhs;
      } else {
        if (rhs === 0) throw new Error("modulo by zero");
        v = v % rhs;
      }
    }
  }

  private power(): number {
    const base = this.unary();
    if (this.eatOp("^")) {
      const exp = this.power();
      return Math.pow(base, exp);
    }
    return base;
  }

  private unary(): number {
    if (this.eatOp("-")) return -this.unary();
    if (this.eatOp("+")) return this.unary();
    return this.primary();
  }

  private primary(): number {
    const tk = this.peek();
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "num") {
      this.pos += 1;
      return parseFloat(tk.v);
    }
    if (tk.t === "id") {
      this.pos += 1;
      const name = tk.v;
      const fn = FUNCS[name];
      if (fn) {
        if (!this.eatOp("(")) throw new Error(`expected ( after ${name}`);
        const arg = this.expr();
        if (!this.eatOp(")")) throw new Error("expected )");
        // Degree mode converts the trig input from degrees to radians.
        if (this.degrees && (name === "sin" || name === "cos" || name === "tan")) {
          return fn((arg * Math.PI) / 180);
        }
        return fn(arg);
      }
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`unknown "${name}"`);
    }
    if (tk.v === "(") {
      this.pos += 1;
      const v = this.expr();
      if (!this.eatOp(")")) throw new Error("expected )");
      return v;
    }
    throw new Error(`unexpected "${tk.v}"`);
  }
}

/** Evaluate an expression string; throws on invalid input. */
export function evaluateExpression(src: string, degrees: boolean): number {
  if (!src.trim()) throw new Error("empty");
  return new ExprParser(tokenize(src), degrees).parse();
}

/** Human-friendly result formatting (kills float dust, uses exponentials for extremes). */
function formatResult(n: number): string {
  if (Number.isNaN(n)) return "undefined";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "−∞";
  const rounded = Number(n.toPrecision(12));
  if (rounded !== 0 && (Math.abs(rounded) >= 1e12 || Math.abs(rounded) < 1e-9)) {
    return rounded
      .toExponential(6)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  }
  return String(rounded);
}

// ================================ HISTORY TYPES ===============================

type HistoryEntry = { expr: string; result: string; ts: number };

const HISTORY_KEY = "alpha-os:calculator:history";
const MODE_KEY = "alpha-os:calculator:degrees";
const MAX_HISTORY = 20;

function readHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          typeof e === "object" && e !== null &&
          typeof (e as HistoryEntry).expr === "string" &&
          typeof (e as HistoryEntry).result === "string"
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

// ================================== THE APP ==================================

type KeyDef = { label: string; insert?: string; kind?: "num" | "op" | "fn" | "eq" | "clr"; span?: boolean };

export function CalculatorApp({ windowId: _windowId }: { windowId?: string }) {
  const [expr, setExpr] = useState("");
  const [degrees, setDegrees] = useState(false);
  const [sciOpen, setSciOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Deferred hydration from localStorage (never setState synchronously in effect).
  useEffect(() => {
    Promise.resolve().then(() => {
      setHistory(readHistory());
      try {
        setDegrees(window.localStorage.getItem(MODE_KEY) === "1");
      } catch {
        /* ignore */
      }
    });
  }, []);

  // Persist history + angle mode whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      window.localStorage.setItem(MODE_KEY, degrees ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [history, degrees]);

  const live = (() => {
    if (!expr.trim()) return "";
    try {
      return formatResult(evaluateExpression(expr, degrees));
    } catch {
      return "";
    }
  })();

  const insert = (text: string) => setExpr((p) => p + text);
  const backspace = () => setExpr((p) => p.slice(0, -1));
  const clearAll = () => setExpr("");

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const value = evaluateExpression(expr, degrees);
      const result = formatResult(value);
      setExpr(result);
      setHistory((p) => [{ expr, result, ts: Date.now() }, ...p].slice(0, MAX_HISTORY));
    } catch {
      /* invalid expression — keep as-is, live preview already hints */
    }
  };

  // Keyboard support (effect re-binds per render → always fresh closures).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (/^[0-9]$/.test(k)) insert(k);
      else if (k === "." || k === ",") insert(".");
      else if (k === "+") insert("+");
      else if (k === "-") insert("−");
      else if (k === "*") insert("×");
      else if (k === "/") insert("÷");
      else if (k === "%") insert("%");
      else if (k === "^") insert("^");
      else if (k === "(") insert("(");
      else if (k === ")") insert(")");
      else if (k === "Enter" || k === "=") equals();
      else if (k === "Backspace") backspace();
      else if (k === "Escape") clearAll();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const mainKeys: KeyDef[] = [
    { label: "C", kind: "clr" },
    { label: "⌫", kind: "clr" },
    { label: "(", kind: "op" },
    { label: ")", kind: "op" },
    { label: "÷", kind: "op" },
    { label: "7", kind: "num" },
    { label: "8", kind: "num" },
    { label: "9", kind: "num" },
    { label: "%", kind: "op" },
    { label: "×", kind: "op" },
    { label: "4", kind: "num" },
    { label: "5", kind: "num" },
    { label: "6", kind: "num" },
    { label: "^", kind: "op" },
    { label: "−", kind: "op" },
    { label: "1", kind: "num" },
    { label: "2", kind: "num" },
    { label: "3", kind: "num" },
    { label: "=", kind: "eq" },
    { label: "+", kind: "op" },
    { label: "0", kind: "num", span: true },
    { label: ".", kind: "num" },
  ];

  // 12 scientific keys revealed by the toggle.
  const sciKeys: KeyDef[] = [
    { label: "sin", insert: "sin(", kind: "fn" },
    { label: "cos", insert: "cos(", kind: "fn" },
    { label: "tan", insert: "tan(", kind: "fn" },
    { label: "√", insert: "√(", kind: "fn" },
    { label: "log", insert: "log(", kind: "fn" },
    { label: "ln", insert: "ln(", kind: "fn" },
    { label: "abs", insert: "abs(", kind: "fn" },
    { label: "π", insert: "π", kind: "fn" },
    { label: "e", insert: "e", kind: "fn" },
    { label: "x²", insert: "^2", kind: "fn" },
    { label: "1/x", insert: "^-1", kind: "fn" },
    { label: degrees ? "RAD" : "DEG", kind: "fn" },
  ];

  const pressKey = (k: KeyDef) => {
    if (k.label === "C") clearAll();
    else if (k.label === "⌫") backspace();
    else if (k.label === "=") equals();
    else if (k.label === "RAD" || k.label === "DEG") setDegrees((d) => !d);
    else if (k.insert) insert(k.insert);
  };

  const keyClass = (k: KeyDef) =>
    cn(
      "relative flex h-10 items-center justify-center rounded-lg border font-mono-ae text-sm transition-colors select-none",
      "border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.09]",
      k.kind === "op" && "border-(--ae-cyan)/25 bg-(--ae-cyan)/[0.07] text-(--ae-cyan)",
      k.kind === "fn" && "border-(--ae-amethyst)/25 bg-(--ae-amethyst)/[0.07] text-(--ae-amethyst) text-xs",
      k.kind === "eq" && "border-(--ae-cyan)/40 bg-(--ae-cyan)/15 text-(--ae-cyan) text-glow-cyan font-semibold",
      k.kind === "clr" && "border-(--ae-rose)/25 bg-(--ae-rose)/[0.06] text-(--ae-rose)",
      k.span && "col-span-2"
    );

  return (
    <div className="flex h-full flex-col gap-2 bg-(--ae-obsidian-deep) p-2.5">
      {/* header */}
      <div className="flex items-center justify-between">
        <span className="eyebrow">Calculator</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSciOpen((v) => !v)}
            className={cn(
              "eyebrow rounded-full border px-2.5 py-1 transition-colors",
              sciOpen
                ? "border-(--ae-amethyst)/40 bg-(--ae-amethyst)/10 text-(--ae-amethyst)"
                : "border-white/10 text-zinc-400 hover:text-zinc-200"
            )}
          >
            fx sci
          </button>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors",
              historyOpen
                ? "border-(--ae-gold)/40 bg-(--ae-gold)/10 text-(--ae-gold)"
                : "border-white/10 text-zinc-400 hover:text-zinc-200"
            )}
          >
            <History className="h-3 w-3" />
            <span className="eyebrow">history</span>
          </button>
        </div>
      </div>

      {/* display */}
      <div className="glass-strong flex flex-col items-end justify-center gap-1 rounded-xl px-4 py-3">
        <div className="min-h-4 w-full truncate text-right font-mono-ae text-xs text-zinc-400" title={expr}>
          {expr || "\u00A0"}
        </div>
        <div className="w-full truncate text-right font-mono-ae text-3xl font-semibold text-(--ae-cyan) text-glow-cyan">
          {live || "0"}
        </div>
        <div className="flex w-full items-center justify-between text-[10px] text-zinc-500 font-mono-ae">
          <span>{degrees ? "DEG" : "RAD"} mode</span>
          <span>Enter = · Esc clear · ⌫ delete</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* keypad */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {sciOpen && (
              <motion.div
                key="sci"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-6 gap-1.5 pb-1.5">
                  {sciKeys.map((k) => (
                    <motion.button
                      key={k.label}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => pressKey(k)}
                      className={keyClass(k)}
                    >
                      {k.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid min-h-0 flex-1 grid-cols-5 content-start gap-1.5">
            {mainKeys.map((k, i) => (
              <motion.button
                key={`${k.label}-${i}`}
                whileTap={{ scale: 0.92 }}
                onClick={() => pressKey(k)}
                className={keyClass(k)}
              >
                {k.label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* history rail */}
        <AnimatePresence initial={false}>
          {historyOpen && (
            <motion.aside
              key="history"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 176, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="glass flex flex-col overflow-hidden rounded-xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-2">
                <span className="eyebrow">History</span>
                <button
                  onClick={() => setHistory([])}
                  className="text-zinc-500 transition-colors hover:text-(--ae-rose)"
                  aria-label="Clear history"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="scroll-ae min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                {history.length === 0 && (
                  <p className="px-1.5 py-3 text-center text-[10px] leading-relaxed text-zinc-500">
                    No calculations yet.
                  </p>
                )}
                {history.map((h) => (
                  <button
                    key={h.ts}
                    onClick={() => setExpr(h.expr)}
                    className="group block w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-white/10 hover:bg-white/5"
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate font-mono-ae text-[10px] text-zinc-400">{h.expr}</span>
                      <X className="h-2.5 w-2.5 shrink-0 text-transparent group-hover:text-zinc-600" />
                    </span>
                    <span className="block truncate font-mono-ae text-xs text-(--ae-gold)">{h.result}</span>
                  </button>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default CalculatorApp;
