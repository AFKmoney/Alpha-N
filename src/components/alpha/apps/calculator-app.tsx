/**
 * calculator-app.tsx — a full-featured scientific calculator.
 *
 * Features:
 * - Standard numpad + 4 operations (+, -, *, /), %, +/-, ., C, =, backspace
 * - Scientific mode toggle: sin, cos, tan, sqrt, x², x^y, log, ln, π, e
 * - Keyboard input support (digits, operators, Enter, Backspace, Escape)
 * - Calculation history sidebar (last 20 calculations, persisted in localStorage)
 *
 * NOTE: All math is evaluated through a small custom tokenizer/parser. We do
 * NOT use `eval()` for safety. Trig functions take degrees in scientific mode
 * (calculator convention).
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Delete, History, Sigma, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface CalculatorAppProps {
  windowId?: string;
}

interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
  time: number;
}

const HISTORY_KEY = "alpha-calc-history";
const MAX_HISTORY = 20;

/**
 * A tiny expression evaluator. Supports + - * / % ^ ( ), unary minus,
 * and the functions/constants sin, cos, tan, sqrt, log, ln, pi, e.
 * Numbers must be decimal. Throws on malformed input.
 */
function evaluateExpression(expr: string): number {
  let i = 0;
  const s = expr.replace(/\s+/g, "");

  const peek = (): string => s[i] ?? "";
  const next = (): string => s[i++] ?? "";

  const parseExpression = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };

  const parseTerm = (): number => {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") v /= r;
      else v %= r;
    }
    return v;
  };

  const parseFactor = (): number => {
    let v = parseUnary();
    if (peek() === "^") {
      next();
      const r = parseFactor(); // right-associative
      v = Math.pow(v, r);
    }
    return v;
  };

  const parseUnary = (): number => {
    if (peek() === "-") {
      next();
      return -parseUnary();
    }
    if (peek() === "+") {
      next();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    if (peek() === "(") {
      next();
      const v = parseExpression();
      if (peek() === ")") next();
      return v;
    }
    // identifier (function or constant)
    if (/[a-z]/i.test(peek())) {
      let name = "";
      while (/[a-z]/i.test(peek())) name += next().toLowerCase();
      if (peek() === "(") {
        next();
        const arg = parseExpression();
        if (peek() === ")") next();
        const rad = (arg * Math.PI) / 180; // degrees → radians
        switch (name) {
          case "sin": return Math.sin(rad);
          case "cos": return Math.cos(rad);
          case "tan": return Math.tan(rad);
          case "sqrt": return Math.sqrt(arg);
          case "log": return Math.log10(arg);
          case "ln": return Math.log(arg);
          case "abs": return Math.abs(arg);
          default: throw new Error(`Unknown function: ${name}`);
        }
      }
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      throw new Error(`Unknown identifier: ${name}`);
    }
    // number
    let num = "";
    while (/[0-9.]/.test(peek())) num += next();
    const v = parseFloat(num);
    if (Number.isNaN(v)) throw new Error(`Expected number at ${i}`);
    return v;
  };

  const result = parseExpression();
  if (i !== s.length) throw new Error(`Unexpected token at ${i}`);
  return result;
}

/** Format a number for display: trim trailing zeros, switch to exponential for very large/small. */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 1e-9 || abs >= 1e15) return n.toExponential(8).replace(/\.?0+e/, "e");
  // Round to 12 significant digits, drop trailing zeros
  const rounded = parseFloat(n.toPrecision(12));
  return String(rounded);
}

/**
 * CalculatorApp — full standard + scientific calculator with history.
 */
export function CalculatorApp({ windowId: _windowId }: CalculatorAppProps = {}) {
  const [display, setDisplay] = useState("0");
  const [expression, setExpression] = useState("");
  const [scientific, setScientific] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState(false);

  // Load history from localStorage on mount. Wrapped in a microtask so the
  // setState call is not synchronous inside the effect body (lint-clean).
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw) as HistoryEntry[]);
      } catch {
        // localStorage unavailable or malformed — start with empty history
      }
    });
  }, []);

  const persistHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // storage full or unavailable — non-fatal
    }
  }, []);

  /** Append a token to the current expression. Resets error state. */
  const append = useCallback((token: string) => {
    setError(false);
    setExpression((prev) => {
      const next = prev === "" && /[0-9.]/.test(token) ? token : prev + token;
      return next;
    });
    setDisplay((prev) => {
      if (error) return token;
      if (prev === "0" && /[0-9.]/.test(token)) return token;
      return prev + token;
    });
  }, [error]);

  /** Clear everything. */
  const clearAll = useCallback(() => {
    setDisplay("0");
    setExpression("");
    setError(false);
  }, []);

  /** Backspace: remove last character. */
  const backspace = useCallback(() => {
    setError(false);
    setExpression((prev) => prev.slice(0, -1));
    setDisplay((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  }, []);

  /** Evaluate the current expression and push the result to history. */
  const evaluate = useCallback(() => {
    if (!expression) return;
    try {
      const result = evaluateExpression(expression);
      const formatted = formatNumber(result);
      setDisplay(formatted);
      setError(!Number.isFinite(result));
      const entry: HistoryEntry = {
        id: `calc-${Date.now()}`,
        expression,
        result: formatted,
        time: Date.now(),
      };
      persistHistory([entry, ...history].slice(0, MAX_HISTORY));
      setExpression(formatted === "Error" ? "" : formatted);
    } catch {
      setDisplay("Error");
      setError(true);
    }
  }, [expression, history, persistHistory]);

  /** Toggle the sign of the current display value. */
  const toggleSign = useCallback(() => {
    setDisplay((prev) => {
      if (prev === "0" || prev === "Error") return prev;
      return prev.startsWith("-") ? prev.slice(1) : `-${prev}`;
    });
    setExpression((prev) => {
      if (prev === "" ) return prev;
      // toggle sign of the trailing number
      const match = prev.match(/(-?[\d.]+)$/);
      if (!match) return prev;
      const num = match[1];
      const toggled = num.startsWith("-") ? num.slice(1) : `-${num}`;
      return prev.slice(0, -num.length) + toggled;
    });
  }, []);

  /** Apply a scientific function wrapper (e.g. sin → "sin("). */
  const applyFunction = useCallback((fn: string) => {
    setError(false);
    const token = fn === "pi" ? "pi" : fn === "e" ? "e" : `${fn}(`;
    setExpression((prev) => prev + token);
    setDisplay((prev) => (prev === "0" ? token : prev + token));
  }, []);

  /** Use a previous result: load it back into the display + expression. */
  const recallHistory = useCallback((entry: HistoryEntry) => {
    setDisplay(entry.result);
    setExpression(entry.result);
    setError(false);
  }, []);

  /** Clear the calculation history. */
  const clearHistory = useCallback(() => persistHistory([]), [persistHistory]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const k = e.key;
      if (/[0-9.]/.test(k)) { append(k); e.preventDefault(); }
      else if (k === "+" || k === "-" || k === "*" || k === "/" || k === "%" || k === "^") { append(k); e.preventDefault(); }
      else if (k === "(" || k === ")") { append(k); e.preventDefault(); }
      else if (k === "Enter" || k === "=") { evaluate(); e.preventDefault(); }
      else if (k === "Backspace") { backspace(); e.preventDefault(); }
      else if (k === "Escape" || k === "c" || k === "C") { clearAll(); e.preventDefault(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [append, evaluate, backspace, clearAll]);

  // Standard numpad layout
  const standardKeys = useMemo(() => [
    { label: "C", action: clearAll, className: "text-[oklch(0.7_0.2_15)]" },
    { label: "+/-", action: toggleSign },
    { label: "%", action: () => append("%") },
    { label: "÷", action: () => append("/"), className: "text-[oklch(0.82_0.17_195)]" },
    { label: "7", action: () => append("7") },
    { label: "8", action: () => append("8") },
    { label: "9", action: () => append("9") },
    { label: "×", action: () => append("*"), className: "text-[oklch(0.82_0.17_195)]" },
    { label: "4", action: () => append("4") },
    { label: "5", action: () => append("5") },
    { label: "6", action: () => append("6") },
    { label: "−", action: () => append("-"), className: "text-[oklch(0.82_0.17_195)]" },
    { label: "1", action: () => append("1") },
    { label: "2", action: () => append("2") },
    { label: "3", action: () => append("3") },
    { label: "+", action: () => append("+"), className: "text-[oklch(0.82_0.17_195)]" },
    { label: "0", action: () => append("0"), className: "col-span-2" },
    { label: ".", action: () => append(".") },
    { label: "=", action: evaluate, className: "bg-[oklch(0.82_0.17_195)] text-background hover:bg-[oklch(0.82_0.17_195)]/80" },
  ], [append, clearAll, evaluate, toggleSign]);

  const scientificKeys = useMemo(() => [
    { label: "sin", action: () => applyFunction("sin") },
    { label: "cos", action: () => applyFunction("cos") },
    { label: "tan", action: () => applyFunction("tan") },
    { label: "√", action: () => applyFunction("sqrt") },
    { label: "x²", action: () => append("^2") },
    { label: "x^y", action: () => append("^") },
    { label: "log", action: () => applyFunction("log") },
    { label: "ln", action: () => applyFunction("ln") },
    { label: "π", action: () => applyFunction("pi") },
    { label: "e", action: () => applyFunction("e") },
    { label: "(", action: () => append("(") },
    { label: ")", action: () => append(")") },
  ], [append, applyFunction]);

  return (
    <div className="flex h-full flex-col bg-background lg:flex-row">
      {/* Calculator side */}
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {/* Scientific toggle */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sigma className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
            <span className="font-mono-ae text-xs text-muted-foreground">Scientific</span>
            <Switch checked={scientific} onCheckedChange={setScientific} />
          </div>
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
            keyboard: 0-9 + − × ÷ Enter ⌫ Esc
          </span>
        </div>

        {/* Display */}
        <div
          className={cn(
            "mb-3 rounded-lg border border-border/50 bg-card/40 p-4 text-right",
            error && "border-[oklch(0.7_0.2_15)]/50"
          )}
        >
          <div className="font-mono-ae min-h-[1.2rem] truncate text-xs text-muted-foreground">
            {expression || "\u00A0"}
          </div>
          <div
            className={cn(
              "font-mono-ae truncate text-3xl font-semibold",
              error ? "text-[oklch(0.7_0.2_15)]" : "text-foreground"
            )}
          >
            {display}
          </div>
        </div>

        {/* Scientific pad */}
        {scientific && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6"
          >
            {scientificKeys.map((k) => (
              <Button
                key={k.label}
                variant="outline"
                size="sm"
                onClick={k.action}
                className="h-9 font-mono-ae text-xs hover:border-[oklch(0.85_0.16_85)]/50 hover:text-[oklch(0.85_0.16_85)]"
              >
                {k.label}
              </Button>
            ))}
          </motion.div>
        )}

        {/* Standard numpad */}
        <div className="grid flex-1 grid-cols-4 gap-1.5">
          {standardKeys.map((k, idx) => (
            <Button
              key={`${k.label}-${idx}`}
              variant="outline"
              onClick={k.action}
              className={cn(
                "h-12 font-mono-ae text-base font-medium transition-all hover:scale-[1.02] active:scale-95",
                k.className
              )}
            >
              {k.label}
            </Button>
          ))}
          {/* Backspace row */}
          <Button
            variant="ghost"
            onClick={backspace}
            className="col-span-4 h-10 font-mono-ae text-xs text-muted-foreground hover:text-[oklch(0.7_0.2_15)]"
          >
            <Delete className="mr-1.5 h-3.5 w-3.5" />
            Backspace
          </Button>
        </div>
      </div>

      {/* History sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-t border-border/50 bg-card/20 lg:w-64 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5 text-[oklch(0.82_0.17_195)]" />
            <span className="eyebrow">history</span>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="h-6 px-2 text-[0.6rem] text-muted-foreground hover:text-[oklch(0.7_0.2_15)]"
            >
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {history.length === 0 ? (
              <p className="px-2 py-6 text-center font-mono-ae text-xs text-muted-foreground/50">
                No calculations yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      onClick={() => recallHistory(entry)}
                      className="group w-full rounded-md border border-transparent px-2.5 py-2 text-left transition-all hover:border-border/60 hover:bg-card/50"
                    >
                      <div className="font-mono-ae truncate text-[0.7rem] text-muted-foreground">
                        {entry.expression}
                      </div>
                      <div className="font-mono-ae truncate text-sm font-semibold text-[oklch(0.82_0.17_195)]">
                        = {entry.result}
                      </div>
                      <div className="font-mono-ae text-[0.55rem] text-muted-foreground/60">
                        {new Date(entry.time).toLocaleTimeString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}

export default CalculatorApp;
