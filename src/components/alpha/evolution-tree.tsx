/**
 * evolution-tree.tsx — the Timeline of Speciation. Clickable version nodes
 * that re-open the NeuralDiff modal for any past evolution.
 */
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, TrendingUp, Zap } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AGENT_META, type EvoCategory } from "@/lib/alpha/evolution-data";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";

const CATEGORY_STYLE: Record<EvoCategory, { label: string; color: string; dot: string }> = {
  performance: { label: "Performance", color: "text-[oklch(0.85_0.16_85)]", dot: "bg-[oklch(0.85_0.16_85)]" },
  feature: { label: "Feature", color: "text-[oklch(0.82_0.17_195)]", dot: "bg-[oklch(0.82_0.17_195)]" },
  "self-healing": { label: "Self-Heal", color: "text-[oklch(0.7_0.18_145)]", dot: "bg-[oklch(0.7_0.18_145)]" },
  cognition: { label: "Cognition", color: "text-[oklch(0.74_0.22_300)]", dot: "bg-[oklch(0.74_0.22_300)]" },
  stability: { label: "Stability", color: "text-[oklch(0.7_0.22_15)]", dot: "bg-[oklch(0.7_0.22_15)]" },
};

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function EvolutionTree() {
  const { history, generation, openHistoryDiff, selectedHistoryId, activeEvolution } = useEvolution();
  const mounted = useMounted();

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
            <h2 className="font-mono-ae text-sm font-semibold">Timeline of Speciation</h2>
          </div>
          <p className="mt-0.5 eyebrow">evolutionary lineage</p>
        </div>
        <div className="text-right">
          <div className="font-mono-ae text-xl font-semibold text-glow-cyan text-[oklch(0.82_0.17_195)]">
            {generation}
          </div>
          <div className="eyebrow">generations</div>
        </div>
      </div>

      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-3">
        {/* Active evolution indicator */}
        <AnimatePresence>
          {activeEvolution && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 overflow-hidden"
            >
              <div className="rounded-xl border border-[oklch(0.85_0.16_85)]/30 bg-[oklch(0.85_0.16_85)]/[0.06] p-3">
                <div className="flex items-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="text-[oklch(0.85_0.16_85)]"
                  >
                    ❖
                  </motion.span>
                  <span className="font-mono-ae text-xs font-semibold text-[oklch(0.85_0.16_85)]">
                    MUTATING NOW
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-foreground/80">
                  {activeEvolution.scenario.title}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[oklch(0.85_0.16_85)]/10">
                  <motion.div
                    className="h-full bg-[oklch(0.85_0.16_85)]"
                    initial={{ width: "0%" }}
                    animate={{
                      width: `${((activeEvolution.phase + 1) / activeEvolution.scenario.logs.length) * 100}%`,
                    }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <p className="mt-1.5 font-mono-ae text-[0.6rem] text-muted-foreground">
                  phase {activeEvolution.phase + 1}/{activeEvolution.scenario.logs.length} ·{" "}
                  {activeEvolution.scenario.logs[activeEvolution.phase]?.message.slice(0, 48)}…
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The tree */}
        <div className="relative">
          {history.map((v, idx) => {
            const cat = CATEGORY_STYLE[v.category];
            const isLatest = idx === 0;
            const isSelected = selectedHistoryId === v.id;
            return (
              <div key={v.id} className="relative flex gap-3 pb-3">
                {/* spine */}
                <div className="relative flex w-6 shrink-0 flex-col items-center">
                  <button
                    onClick={() => openHistoryDiff(v.id)}
                    className={cn(
                      "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-all",
                      isLatest
                        ? "border-[oklch(0.82_0.17_195)]/60 bg-[oklch(0.82_0.17_195)]/15 glow-cyan"
                        : "border-border/60 bg-card/60 hover:border-[oklch(0.82_0.17_195)]/40",
                      isSelected && "scale-110 glow-cyan"
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", cat.dot, isLatest && "neural-dot")} />
                  </button>
                  {idx < history.length - 1 && (
                    <span className="absolute top-6 bottom-0 w-px bg-gradient-to-b from-border/60 to-transparent" />
                  )}
                </div>

                {/* node */}
                <motion.button
                  onClick={() => openHistoryDiff(v.id)}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "group flex-1 rounded-xl border p-3 text-left transition-all",
                    isLatest
                      ? "border-border/60 bg-card/50 hover:bg-card/70"
                      : "border-border/40 bg-card/30 hover:bg-card/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-ae text-xs font-semibold text-foreground">
                      v{v.version}
                    </span>
                    <span className={cn("eyebrow", cat.color)}>{cat.label}</span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-foreground/85">
                    {v.title}
                  </p>
                  {v.deltas.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {v.deltas.slice(0, 2).map((d, i) => {
                        const improved = d.better === "lower" ? d.after < d.before : d.after > d.before;
                        return (
                          <span
                            key={i}
                            className="flex items-center gap-1 rounded-md bg-foreground/[0.04] px-1.5 py-0.5 font-mono-ae text-[0.6rem]"
                          >
                            <TrendingUp className={cn("h-2.5 w-2.5", improved ? "text-[oklch(0.7_0.18_145)]" : "text-[oklch(0.65_0.24_25)]")} />
                            <span className="text-muted-foreground">{d.metric}</span>
                            <span className={improved ? "text-[oklch(0.7_0.18_145)]" : "text-[oklch(0.65_0.24_25)]"}>
                              {d.before}{d.unit}→{d.after}{d.unit}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="flex items-center gap-1 font-mono-ae text-[0.6rem] text-muted-foreground">
                      <Zap className="h-2.5 w-2.5" />
                      {AGENT_META[v.agentLead].glyph} {AGENT_META[v.agentLead].name.replace("The ", "")}
                    </span>
                    <span className="font-mono-ae text-[0.6rem] text-muted-foreground/70">
                      {mounted ? relativeTime(v.timestamp) : "—"}
                    </span>
                  </div>
                </motion.button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
