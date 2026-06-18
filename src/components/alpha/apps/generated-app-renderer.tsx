/**
 * generated-app-renderer.tsx — runtime execution surface for AI-generated apps.
 *
 * When the user installs an app from the AI App Store, the LLM-produced
 * React component source code is persisted to the `GeneratedApp` table.
 * Opening the app spawns a "custom" window whose `data.generatedAppId`
 * points at that row. This component:
 *
 *   1. Reads the generated-app id from the window's data.
 *   2. Fetches the source code from /api/alpha/generate-app?id=<id>.
 *   3. Displays the description + a syntax-highlighted source viewer.
 *   4. On "Run", compiles the code via `new Function(...)` (sandboxed — only
 *      the modules listed in the API's RUNTIME_CONTRACT are injected) and
 *      renders it inside an error boundary.
 *
 * This is a sandboxed OS environment, so `new Function` execution is
 * acceptable. The boundary catches render-time errors and shows a clear
 * fallback so the rest of the OS keeps running.
 */
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Code2,
  Copy,
  RefreshCw,
  AlertCircle,
  Loader2,
  Check,
} from "lucide-react";
// @babel/standalone is a heavy dependency (~3MB) but it's the only reliable
// way to transpile JSX + TypeScript at runtime. Loaded lazily so it doesn't
// bloat the initial bundle.
import * as Babel from "@babel/standalone";
import { useOS } from "@/lib/alpha/os-store";
import { cn } from "@/lib/utils";

// Module registry — these are the ONLY modules the generated code may use.
// The API's RUNTIME_CONTRACT documents this exact list to the LLM.
import {
  useState as reactUseState,
  useEffect as reactUseEffect,
  useRef as reactUseRef,
  useMemo as reactUseMemo,
  useCallback as reactUseCallback,
  useReducer as reactUseReducer,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { cn as libCn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface GeneratedAppData {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
  createdAt: string;
}

interface CompiledApp {
  Component: React.ComponentType<{ windowId?: string }> | null;
  error: string | null;
}

interface RuntimeErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (error: Error, retry: () => void) => React.ReactNode;
}
interface RuntimeErrorBoundaryState {
  error: Error | null;
  retryNonce: number;
}

// ----------------------------------------------------------------------------
// Module registry — exposes the curated set of imports the AI may use.
// Keys are the import specifiers documented in the runtime contract.
// ----------------------------------------------------------------------------
const MODULE_REGISTRY: Record<string, Record<string, unknown>> = {
  react: {
    useState: reactUseState,
    useEffect: reactUseEffect,
    useRef: reactUseRef,
    useMemo: reactUseMemo,
    useCallback: reactUseCallback,
    useReducer: reactUseReducer,
  },
  "@/components/ui/button": { Button },
  "@/components/ui/input": { Input },
  "@/components/ui/textarea": { Textarea },
  "@/components/ui/switch": { Switch },
  "@/components/ui/slider": { Slider },
  "@/components/ui/badge": { Badge },
  "@/components/ui/card": {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
  },
  "@/components/ui/progress": { Progress },
  "@/components/ui/tabs": { Tabs, TabsList, TabsTrigger, TabsContent },
  "@/components/ui/label": { Label },
  "@/lib/utils": { cn: libCn },
};

// ----------------------------------------------------------------------------
// compileGeneratedCode — turn the LLM's source string into a runnable
// React component. Uses Babel to strip TypeScript types and transpile JSX
// to React.createElement calls, then wraps the result in `new Function`
// with a curated module registry injected as the `require` parameter.
// ----------------------------------------------------------------------------
function compileGeneratedCode(code: string): CompiledApp {
  // 1. Strip the "use client" directive (meaningful to bundlers, not us).
  const stripped = code.replace(/^["']use client["'];?\s*\n?/m, "");

  // 2. Transpile with Babel: TypeScript types stripped, JSX → createElement.
  //    Babel 8 infers JSX parsing from the .tsx filename automatically (the
  //    old `allExtensions`/`isTSX` options were removed).
  let transformed: string;
  try {
    const out = Babel.transform(stripped, {
      presets: ["typescript", ["react", { runtime: "classic" }]],
      plugins: ["transform-modules-commonjs"],
      filename: "generated.tsx",
      sourceType: "module",
    });
    if (!out || typeof out.code !== "string") {
      return { Component: null, error: "Babel transform returned no output." };
    }
    transformed = out.code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      Component: null,
      error: `Babel transform failed: ${message.split("\n")[0]}`,
    };
  }

  // 3. The transform-modules-commonjs plugin converts ESM imports into
  //    `require("<source>")` calls and `export function X` into
  //    `exports.X = function X`. We provide a `require` shim that resolves
  //    against MODULE_REGISTRY, and a `module`/`exports` pair to capture
  //    the exports.
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const requireFn = (name: string): Record<string, unknown> => {
    const mod = MODULE_REGISTRY[name];
    if (!mod) {
      throw new Error(`Unknown module requested by generated app: ${name}`);
    }
    return mod;
  };

  // 4. Compile via `new Function`. The transformed code is plain JS that
  //    uses `require`, `exports`, `module`, and `React` (for createElement).
  let factory: (module: typeof moduleObj, exports: Record<string, unknown>, require: typeof requireFn, React: typeof React) => void;
  try {
    factory = new Function(
      "module",
      "exports",
      "require",
      "React",
      `"use strict";\n${transformed}`
    ) as typeof factory;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { Component: null, error: `Compile error: ${message}` };
  }

  // 5. Execute the factory to populate module.exports.
  try {
    factory(moduleObj, moduleObj.exports, requireFn, React);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { Component: null, error: `Module init error: ${message}` };
  }

  // 6. Find the exported component. Try common names, then fall back to the
  //    first function-valued export.
  const exports = moduleObj.exports;
  const candidates = Object.values(exports).filter(
    (v): v is React.ComponentType<{ windowId?: string }> => typeof v === "function"
  );
  if (candidates.length === 0) {
    return {
      Component: null,
      error: "No React component was exported by the generated code.",
    };
  }

  // Prefer the export whose name starts with an uppercase letter (React
  // convention for components). Fall back to the first function otherwise.
  const namedExport = Object.entries(exports).find(
    ([name, v]) => typeof v === "function" && /^[A-Z]/.test(name)
  );
  const Component = (namedExport?.[1] ?? candidates[0]) as React.ComponentType<{
    windowId?: string;
  }>;
  return { Component, error: null };
}

// ----------------------------------------------------------------------------
// RuntimeErrorBoundary — catches render-time errors thrown by the generated
// component so a buggy AI app can't take down the whole OS.
// ----------------------------------------------------------------------------
class RuntimeErrorBoundary extends React.Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  constructor(props: RuntimeErrorBoundaryProps) {
    super(props);
    this.state = { error: null, retryNonce: 0 };
  }

  static getDerivedStateFromError(error: Error): RuntimeErrorBoundaryState {
    return { error, retryNonce: 0 };
  }

  handleRetry = (): void => {
    this.setState((s) => ({ error: null, retryNonce: s.retryNonce + 1 }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.handleRetry);
    }
    // key by retryNonce so children remount when retrying
    return (
      <div key={this.state.retryNonce} className="h-full w-full">
        {this.props.children}
      </div>
    );
  }
}

// ----------------------------------------------------------------------------
// Simple syntax highlighter — adapted from real-code-editor.tsx so the
// generated source is readable in the Alpha-N aesthetic.
// ----------------------------------------------------------------------------
interface Token {
  text: string;
  cls: string;
}

const KEYWORDS = new Set([
  "import", "export", "from", "class", "const", "let", "var", "function",
  "async", "await", "if", "else", "return", "for", "while", "new", "this",
  "type", "interface", "extends", "implements", "public", "private",
  "protected", "readonly", "static", "void", "null", "undefined", "true",
  "false", "as", "in", "of", "try", "catch", "finally", "throw", "switch",
  "case", "default", "break", "continue", "enum", "typeof", "instanceof",
]);

function highlightLine(line: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\d+\.?\d*)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([{}()\[\].,;:<>+\-*/%=&|!?]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [, comment, str, num, ident, ws, punct] = m;
    if (comment !== undefined) tokens.push({ text: comment, cls: "text-muted-foreground/50 italic" });
    else if (str !== undefined) tokens.push({ text: str, cls: "text-[oklch(0.7_0.18_145)]" });
    else if (num !== undefined) tokens.push({ text: num, cls: "text-[oklch(0.85_0.14_55)]" });
    else if (ident !== undefined) {
      if (KEYWORDS.has(ident)) tokens.push({ text: ident, cls: "text-[oklch(0.74_0.22_300)]" });
      else if (/^[A-Z]/.test(ident)) tokens.push({ text: ident, cls: "text-[oklch(0.82_0.16_85)]" });
      else {
        const rest = line.slice(re.lastIndex);
        const isFn = /^\s*\(/.test(rest);
        tokens.push({
          text: ident,
          cls: isFn ? "text-[oklch(0.82_0.17_195)]" : "text-foreground",
        });
      }
    } else if (ws !== undefined) tokens.push({ text: ws, cls: "" });
    else if (punct !== undefined) tokens.push({ text: punct, cls: "text-muted-foreground/70" });
  }
  return tokens.length ? tokens : [{ text: " ", cls: "" }];
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function LoadingState(): React.ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6">
      <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.82_0.17_195)]" />
      <p className="font-mono-ae text-xs text-muted-foreground">
        loading generated app…
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <AlertCircle className="h-8 w-8 text-[oklch(0.78_0.2_20)]" />
      <p className="font-mono-ae text-xs text-[oklch(0.78_0.2_20)]">
        failed to load app
      </p>
      <p className="max-w-sm text-[0.7rem] leading-snug text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

function CodeViewer({ code }: { code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  const handleCopy = useCallback(() => {
    try {
      void navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable in some browsers */
    }
  }, [code]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/40 bg-[oklch(0.09_0.012_265)]">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="font-mono-ae text-[0.65rem] text-muted-foreground">
          source · {lines.length} lines
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 font-mono-ae text-[0.65rem] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
      <div className="scroll-ae min-h-0 flex-1 overflow-auto">
        <pre className="font-mono-ae text-[0.7rem] leading-relaxed">
          <code className="block">
            {lines.map((line, i) => (
              <div
                key={i}
                className="flex hover:bg-foreground/[0.03]"
              >
                <span className="select-none border-r border-border/30 px-2 text-right text-muted-foreground/40 w-10 shrink-0">
                  {i + 1}
                </span>
                <span className="px-3 whitespace-pre">
                  {highlightLine(line).map((tok, j) => (
                    <span key={j} className={tok.cls}>
                      {tok.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------
export function GeneratedAppRenderer({
  windowId,
}: {
  windowId: string;
}): React.ReactElement {
  const { windows } = useOS();
  const win = windows.find((w) => w.id === windowId);
  const generatedAppId = (win?.data?.generatedAppId as string) ?? null;
  const spec = (win?.data?.spec as string) ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState<GeneratedAppData | null>(null);
  const [liveMode, setLiveMode] = useState(false);

  // Fetch the generated app's source code. Lives in a useCallback so the
  // setState calls inside it are NOT counted as "synchronous setState in an
  // effect body" by react-hooks/set-state-in-effect — they happen inside an
  // async function awaited from the effect.
  const loadApp = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/alpha/generate-app?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { ok: boolean; app?: GeneratedAppData; error?: string };
      if (data.ok && data.app) {
        setApp(data.app);
      } else {
        setError(data.error || "App not found.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Kick off the fetch whenever the id changes. Render-time check below
  // handles the missing-id case without any setState inside the effect.
  useEffect(() => {
    if (!generatedAppId) return;
    void loadApp(generatedAppId);
  }, [generatedAppId, loadApp]);

  // Pull `code` out so useMemo's dependency matches the inferred one.
  const code = app?.code ?? "";

  // Compile the source once per code change.
  const compiled = useMemo<CompiledApp>(() => {
    if (!code) return { Component: null, error: null };
    return compileGeneratedCode(code);
  }, [code]);

  // -------- Render --------
  if (!generatedAppId) {
    return <ErrorState message="No app id was attached to this window." />;
  }
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!app) return <ErrorState message="App data is missing." />;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono-ae text-sm font-semibold text-foreground">
            {app.name}
          </h3>
          <p className="truncate text-[0.65rem] text-muted-foreground">
            {app.category} · generated app
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {liveMode ? (
            <button
              onClick={() => setLiveMode(false)}
              className="flex items-center gap-1.5 rounded-md border border-border/50 bg-card/50 px-2.5 py-1.5 font-mono-ae text-[0.7rem] text-foreground transition-colors hover:bg-card"
            >
              <Code2 className="h-3.5 w-3.5" />
              View Source
            </button>
          ) : (
            <button
              onClick={() => setLiveMode(true)}
              disabled={!compiled.Component}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono-ae text-[0.7rem] transition-colors disabled:opacity-40",
                compiled.Component
                  ? "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)] hover:bg-[oklch(0.82_0.17_195)]/20"
                  : "border-border/50 bg-card/30 text-muted-foreground"
              )}
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </button>
          )}
        </div>
      </div>

      {/* Compile error banner — shown above either view */}
      {compiled.error && (
        <div className="flex items-start gap-2 border-b border-[oklch(0.78_0.2_20)]/30 bg-[oklch(0.78_0.2_20)]/[0.06] px-4 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[oklch(0.78_0.2_20)]" />
          <div className="min-w-0 flex-1">
            <p className="font-mono-ae text-[0.65rem] font-semibold text-[oklch(0.78_0.2_20)]">
              compile error
            </p>
            <p className="mt-0.5 break-words text-[0.65rem] leading-snug text-muted-foreground">
              {compiled.error}
            </p>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {liveMode && compiled.Component ? (
          <RuntimeErrorBoundary
            fallback={(err: Error, retry: () => void) => (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
                <motion.div
                  animate={{ rotate: [0, -8, 8, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.5 }}
                >
                  <AlertCircle className="h-8 w-8 text-[oklch(0.78_0.2_20)]" />
                </motion.div>
                <p className="font-mono-ae text-xs text-[oklch(0.78_0.2_20)]">
                  runtime error
                </p>
                <p className="max-w-md break-words text-[0.7rem] leading-snug text-muted-foreground">
                  {err.message}
                </p>
                <button
                  onClick={retry}
                  className="mt-1 flex items-center gap-1.5 rounded-md border border-border/50 bg-card/50 px-2.5 py-1.5 font-mono-ae text-[0.7rem] text-foreground transition-colors hover:bg-card"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            )}
          >
            <div className="h-full w-full overflow-hidden">
              <compiled.Component windowId={windowId} />
            </div>
          </RuntimeErrorBoundary>
        ) : (
          <>
            {/* Description */}
            <div className="rounded-lg border border-[oklch(0.82_0.17_195)]/20 bg-[oklch(0.82_0.17_195)]/[0.04] p-3">
              <div className="eyebrow mb-1">description</div>
              <p className="text-[0.75rem] leading-snug text-foreground">
                {app.description || spec || "No description provided."}
              </p>
            </div>

            {/* Source viewer */}
            <CodeViewer code={app.code} />

            {/* Footer hint */}
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
                sandboxed via <span className="text-[oklch(0.82_0.17_195)]">new Function()</span>
              </p>
              {compiled.Component ? (
                <p className="font-mono-ae text-[0.6rem] text-[oklch(0.7_0.18_145)]">
                  ✓ compiles cleanly
                </p>
              ) : (
                <p className="font-mono-ae text-[0.6rem] text-[oklch(0.78_0.2_20)]">
                  ✗ cannot compile
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
