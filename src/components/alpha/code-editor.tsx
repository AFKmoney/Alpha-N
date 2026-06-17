"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Circle, FileCode2, GitCommitVertical, AlertTriangle } from "lucide-react";
import { useEvolution, useCodeLines } from "@/lib/alpha/evolution-store";
import { GHOST_CODE, type CodeToken } from "@/lib/alpha/evolution-data";
import { cn } from "@/lib/utils";


const TOKEN_COLORS: Record<CodeToken["kind"], string> = {
  kw: "text-[oklch(0.74_0.22_300)]", // amethyst keywords
  fn: "text-[oklch(0.82_0.17_195)]", // cyan functions
  type: "text-[oklch(0.82_0.16_85)]", // gold types
  var: "text-foreground",
  str: "text-[oklch(0.7_0.18_145)]", // green strings
  num: "text-[oklch(0.85_0.14_55)]", // amber numbers
  op: "text-muted-foreground",
  punct: "text-muted-foreground/80",
  comment: "text-muted-foreground/60 italic",
  ghost: "ghost-text",
};

const LINK_COLORS = [
  "text-[oklch(0.82_0.17_195)]",
  "text-[oklch(0.74_0.22_300)]",
  "text-[oklch(0.82_0.16_85)]",
  "text-[oklch(0.7_0.18_145)]",
];

export function CodeEditor() {
  const { lines } = useCodeLines();
  const { hoveredLink, setHoveredLink, aiState, ghostVisible, generation } = useEvolution();

  const [cursorLine, setCursorLine] = useState(11);

  // Cycle the cursor line subtly to feel alive.
  useEffect(() => {
    const id = setInterval(() => {
      setCursorLine((c) => (c % lines.length) + 1);
    }, 4200);
    return () => clearInterval(id);
  }, [lines.length]);

  const hasError = aiState === "self-improving" && generation % 3 === 2;

  const linkColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const ids = new Set<string>();
    lines.forEach((l) => l.tokens.forEach((t) => t.linkId && ids.add(t.linkId)));
    [...ids].forEach((id, i) => map.set(id, LINK_COLORS[i % LINK_COLORS.length]));
    return map;
  }, [lines]);

  return (
    <div className="glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      {/* Editor chrome */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.65_0.24_25)]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.85_0.16_85)]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.7_0.18_145)]/70" />
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileCode2 className="h-3.5 w-3.5" />
            <span className="font-mono-ae text-xs">core/nucleus.ts</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-border/50 px-2 py-0.5">
            <GitCommitVertical className="h-3 w-3 text-[oklch(0.82_0.17_195)]" />
            <span className="font-mono-ae text-[0.65rem] text-muted-foreground">main</span>
          </div>
          <CompileBadge hasError={hasError} />
        </div>
      </div>

      {/* The Loom */}
      <div className="scroll-ae relative min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full">
          {/* Lifeline */}
          <div className="relative w-2 shrink-0">
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
                hasError ? "lifeline-error" : "lifeline"
              )}
            />
            {/* compile pulse marker — re-fires each generation */}
            <AnimatePresence>
              {generation > 0 && (
                <motion.div
                  key={generation}
                  initial={{ top: "0%", opacity: 0 }}
                  animate={{ top: "100%", opacity: [0, 1, 1, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.6, ease: "easeInOut" }}
                  className="absolute left-1/2 h-10 w-px -translate-x-1/2"
                  style={{
                    background:
                      "linear-gradient(180deg, transparent, oklch(0.82 0.17 195), transparent)",
                    boxShadow: "0 0 12px oklch(0.82 0.17 195 / 0.8)",
                  }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Line numbers + code */}
          <div className="flex-1 py-3 pr-4 font-mono-ae text-[0.82rem] leading-[1.65]">
            {lines.map((line) => (
              <div
                key={line.no}
                className={cn(
                  "group flex items-start gap-3 px-2 transition-colors",
                  line.status === "changed" &&
                    "bg-[oklch(0.82_0.17_195)]/[0.06] border-l border-[oklch(0.82_0.17_195)]/40",
                  cursorLine === line.no && "bg-foreground/[0.03]"
                )}
              >
                <span
                  className={cn(
                    "w-7 shrink-0 select-none text-right text-[0.68rem] tabular-nums",
                    line.status === "changed"
                      ? "text-[oklch(0.82_0.17_195)]"
                      : "text-muted-foreground/50"
                  )}
                >
                  {line.no}
                </span>
                <code className="whitespace-pre">
                  {line.tokens.length === 0 ? (
                    <span>&nbsp;</span>
                  ) : (
                    line.tokens.map((tok, i) => {
                      const isLinked = !!tok.linkId;
                      const isActive = hoveredLink && hoveredLink === tok.linkId;
                      const baseColor = isLinked
                        ? linkColorMap.get(tok.linkId!) ?? TOKEN_COLORS.var
                        : TOKEN_COLORS[tok.kind];
                      return (
                        <span
                          key={i}
                          className={cn(
                            baseColor,
                            isLinked && "token-linked cursor-pointer",
                            isActive && "active rounded"
                          )}
                          onMouseEnter={() => isLinked && setHoveredLink(tok.linkId!)}
                          onMouseLeave={() => isLinked && setHoveredLink(null)}
                        >
                          {tok.text}
                        </span>
                      );
                    })
                  )}
                  {cursorLine === line.no && (
                    <span className="ml-px inline-block h-[1.05em] w-[2px] -translate-y-[1px] animate-pulse bg-[oklch(0.82_0.17_195)] align-middle" />
                  )}
                </code>
                {line.status === "changed" && (
                  <span className="ml-auto flex items-center gap-1 text-[0.6rem] text-[oklch(0.82_0.17_195)]/80">
                    <Sparkle /> mutated
                  </span>
                )}
              </div>
            ))}

            {/* Ghost writing */}
            {ghostVisible && (
              <div className="mt-1 border-t border-dashed border-[oklch(0.82_0.17_195)]/15 pt-2">
                <div className="mb-1 flex items-center gap-2 px-2">
                  <span className="eyebrow text-[oklch(0.74_0.22_300)]/80">
                    ghost-write · projected
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-[oklch(0.74_0.22_300)]/30 to-transparent" />
                </div>
                {GHOST_CODE.filter((l) => l.tokens.some((t) => t.text)).map((line) => (
                  <div key={line.no} className="flex items-start gap-3 px-2">
                    <span className="w-7 shrink-0 text-right text-[0.68rem] text-muted-foreground/30">
                      {line.no}
                    </span>
                    <code className="ghost-text whitespace-pre">
                      {line.tokens.map((t, i) => (
                        <span key={i}>{t.text}</span>
                      ))}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom mini-status */}
      <div className="flex items-center justify-between border-t border-border/50 px-4 py-1.5 text-[0.65rem] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Circle className="h-2 w-2 fill-[oklch(0.7_0.18_145)] text-[oklch(0.7_0.18_145)]" />
            <span className="font-mono-ae">TS 5.0</span>
          </span>
          <span className="font-mono-ae">UTF-8</span>
          <span className="font-mono-ae">LF</span>
        </div>
        <div className="flex items-center gap-3 font-mono-ae">
          <span>Ln {cursorLine}, Col 18</span>
          <span className="text-[oklch(0.7_0.18_145)]">0 errors</span>
          <span className="text-[oklch(0.85_0.16_85)]">2 warnings</span>
        </div>
      </div>
    </div>
  );
}

function CompileBadge({ hasError }: { hasError: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.65rem] transition-colors",
        hasError
          ? "border-[oklch(0.65_0.24_25)]/40 bg-[oklch(0.65_0.24_25)]/10 text-[oklch(0.65_0.24_25)]"
          : "border-[oklch(0.7_0.18_145)]/30 bg-[oklch(0.7_0.18_145)]/10 text-[oklch(0.7_0.18_145)]"
      )}
    >
      {hasError ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      <span className="font-mono-ae">{hasError ? "self-healing" : "compiled"}</span>
    </div>
  );
}

function Sparkle() {
  return (
    <motion.span
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 2, repeat: Infinity }}
      className="inline-block"
    >
      ✦
    </motion.span>
  );
}
