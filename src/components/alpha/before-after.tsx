"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Eye, GitCompare, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

export function BeforeAfter() {
  const { beforeAfter, beforeAfterOpen, toggleBeforeAfter } = useEvolution();
  const [side, setSide] = useState<"before" | "after">("after");

  return (
    <AnimatePresence>
      {beforeAfterOpen && beforeAfter && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          data-ai-skip="true"
        >
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            onClick={toggleBeforeAfter}
          />
          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="glass-strong relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl glow-cyan"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/50 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)] glow-cyan">
                  <GitCompare className="h-5 w-5" />
                </div>
                <div>
                  <div className="eyebrow text-glow-cyan text-[oklch(0.82_0.17_195)]">
                    visual diff · what I just did
                  </div>
                  <h2 className="mt-1 font-mono-ae text-base font-semibold leading-tight">
                    {beforeAfter.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{beforeAfter.summary}</p>
                </div>
              </div>
              <button
                onClick={toggleBeforeAfter}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* toggle */}
            <div className="flex items-center justify-center gap-2 border-b border-border/50 px-5 py-2.5">
              <button
                onClick={() => setSide("before")}
                className={cn(
                  "rounded-full px-3 py-1 font-mono-ae text-[0.65rem] transition-all",
                  side === "before"
                    ? "bg-[oklch(0.65_0.24_25)]/15 text-[oklch(0.78_0.2_20)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                before
              </button>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <button
                onClick={() => setSide("after")}
                className={cn(
                  "rounded-full px-3 py-1 font-mono-ae text-[0.65rem] transition-all",
                  side === "after"
                    ? "bg-[oklch(0.7_0.18_145)]/15 text-[oklch(0.78_0.18_145)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                after
              </button>
              <span className="ml-2 flex items-center gap-1 font-mono-ae text-[0.6rem] text-muted-foreground/60">
                <Eye className="h-3 w-3" /> N-Core saw both
              </span>
            </div>

            {/* image */}
            <div className="relative min-h-0 flex-1 overflow-auto bg-background/40 p-3">
              <AnimatePresence mode="wait">
                <motion.img
                  key={side}
                  src={side === "before" ? beforeAfter.before : beforeAfter.after}
                  alt={`${side} screenshot`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mx-auto max-w-full rounded-lg border border-border/40"
                />
              </AnimatePresence>
              <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 backdrop-blur">
                <span
                  className={cn(
                    "font-mono-ae text-[0.6rem] font-semibold uppercase",
                    side === "before" ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.78_0.18_145)]"
                  )}
                >
                  {side}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 px-5 py-2.5">
              <span className="font-mono-ae text-[0.62rem] text-muted-foreground">
                {new Date(beforeAfter.time).toLocaleTimeString("en-US", { hour12: false })} · this screenshot feeds my next cycle
              </span>
              <button
                onClick={toggleBeforeAfter}
                className="rounded-lg bg-[oklch(0.82_0.17_195)]/15 px-4 py-1.5 font-mono-ae text-xs font-semibold text-[oklch(0.82_0.17_195)] transition-colors hover:bg-[oklch(0.82_0.17_195)]/25"
              >
                continue evolving
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
