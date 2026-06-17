"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Brain, GitCompare, Sparkles, TrendingUp, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AGENT_META, type DiffLine } from "@/lib/alpha/evolution-data";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  performance: "Performance",
  feature: "Feature",
  "self-healing": "Self-Healing",
  cognition: "Cognition",
  stability: "Stability",
};

function lineStyle(l: DiffLine) {
  switch (l.type) {
    case "add":
      return "bg-[oklch(0.7_0.18_145)]/[0.12] text-[oklch(0.78_0.18_145)]";
    case "del":
      return "bg-[oklch(0.65_0.24_25)]/[0.1] text-[oklch(0.78_0.2_20)] line-through decoration-[oklch(0.65_0.24_25)]/40";
    case "hunk":
      return "bg-[oklch(0.74_0.22_300)]/[0.1] text-[oklch(0.74_0.22_300)]";
    default:
      return "text-muted-foreground";
  }
}

export function NeuralDiff() {
  const { diffOpen, pendingDiff, dismissDiff } = useEvolution();

  return (
    <AnimatePresence>
      {diffOpen && pendingDiff && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            onClick={dismissDiff}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-strong relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl glow-cyan"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border/50 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)] glow-cyan">
                  <GitCompare className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="eyebrow text-glow-cyan text-[oklch(0.82_0.17_195)]">
                      Neural Diff · v{pendingDiff.version}
                    </span>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono-ae text-[0.6rem] text-muted-foreground">
                      {CATEGORY_LABEL[pendingDiff.category]}
                    </span>
                  </div>
                  <h2 className="mt-1 font-mono-ae text-lg font-semibold leading-tight">
                    {pendingDiff.title}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {pendingDiff.summary}
                  </p>
                </div>
              </div>
              <button
                onClick={dismissDiff}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close diff"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* The explanation — "I noticed… I rewrote…" */}
            <div className="border-b border-border/50 bg-[oklch(0.74_0.22_300)]/[0.05] px-5 py-3">
              <div className="flex items-start gap-2">
                <Brain className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.74_0.22_300)]" />
                <p className="text-sm italic text-foreground/90">
                  &ldquo;{pendingDiff.insight}&rdquo;
                </p>
              </div>
              <div className="mt-2 flex items-center gap-1.5 font-mono-ae text-[0.62rem] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                <span>
                  authored by {AGENT_META[pendingDiff.agentLead].glyph}{" "}
                  {AGENT_META[pendingDiff.agentLead].name}
                </span>
              </div>
            </div>

            {/* Metric deltas */}
            {pendingDiff.deltas.length > 0 && (
              <div className="grid grid-cols-1 gap-2 border-b border-border/50 p-5 sm:grid-cols-3">
                {pendingDiff.deltas.map((d, i) => {
                  const improved = d.better === "lower" ? d.after < d.before : d.after > d.before;
                  const isNew = d.before === 0;
                  const pct = isNew
                    ? 100
                    : Math.abs(((d.after - d.before) / d.before) * 100) || 0;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.08 }}
                      className="rounded-xl border border-border/50 bg-card/40 p-3"
                    >
                      <div className="eyebrow truncate">{d.metric}</div>
                      <div className="mt-1.5 flex items-center gap-1.5 font-mono-ae text-sm">
                        <span className="text-muted-foreground line-through">
                          {d.before}{d.unit}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className={improved ? "text-[oklch(0.78_0.18_145)] font-semibold" : "text-[oklch(0.78_0.2_20)] font-semibold"}>
                          {d.after}{d.unit}
                        </span>
                      </div>
                      <div className={cn("mt-1 flex items-center gap-1 text-[0.65rem]", improved ? "text-[oklch(0.78_0.18_145)]" : "text-[oklch(0.78_0.2_20)]")}>
                        <TrendingUp className="h-3 w-3" />
                        {isNew ? "new faculty" : `${pct.toFixed(1)}% ${improved ? "improved" : "regressed"}`}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* The patch — healing code */}
            <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-5">
              <div className="eyebrow mb-2">the patch · cicatrising</div>
              {pendingDiff.diff.map((hunk, hi) => (
                <div key={hi} className="mb-4 overflow-hidden rounded-xl border border-border/50">
                  <div className="flex items-center gap-2 border-b border-border/50 bg-foreground/[0.03] px-3 py-1.5">
                    <span className="h-2 w-2 rounded-full bg-[oklch(0.82_0.17_195)] neural-dot" />
                    <span className="font-mono-ae text-xs text-foreground/80">{hunk.file}</span>
                    <span className="ml-auto font-mono-ae text-[0.6rem] text-muted-foreground">
                      {hunk.language}
                    </span>
                  </div>
                  <div className="font-mono-ae text-[0.78rem] leading-relaxed">
                    {hunk.lines.map((l, li) => (
                      <motion.div
                        key={li}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + li * 0.06 }}
                        className={cn(
                          "flex items-start gap-2 px-3 py-0.5",
                          lineStyle(l),
                          l.type === "add" && "healing"
                        )}
                      >
                        <span className="w-3 shrink-0 select-none text-center text-[0.65rem] opacity-60">
                          {l.type === "add" ? "+" : l.type === "del" ? "-" : l.type === "hunk" ? "@" : " "}
                        </span>
                        <code className="whitespace-pre-wrap break-all">{l.text || " "}</code>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-3">
              <div className="flex items-center gap-2 font-mono-ae text-[0.65rem] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.7_0.18_145)] neural-dot" />
                shadow-clone validated · 313 tests green · hot-swapped
              </div>
              <button
                onClick={dismissDiff}
                className="rounded-lg bg-[oklch(0.82_0.17_195)]/15 px-4 py-1.5 font-mono-ae text-xs font-semibold text-[oklch(0.82_0.17_195)] transition-colors hover:bg-[oklch(0.82_0.17_195)]/25"
              >
                acknowledge
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
