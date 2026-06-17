/**
 * before-after.tsx — the visual-diff overlay that pops up after each AI cycle.
 * Shows a notification toast first; clicking it expands the full modal with
 * side-by-side before/after screenshots of the desktop.
 */
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Eye, GitCompare, Maximize2, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

export function BeforeAfter() {
  const { beforeAfter, beforeAfterOpen, toggleBeforeAfter, setBeforeAfter } = useEvolution();
  const [side, setSide] = useState<"before" | "after">("after");

  const showNotification = beforeAfter && !beforeAfterOpen;

  return (
    <>
      {/* Notification toast — small, non-intrusive */}
      <AnimatePresence>
        {showNotification && beforeAfter && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 20, x: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="glass-strong fixed top-14 left-3 z-40 w-[min(92vw,340px)] cursor-pointer overflow-hidden rounded-xl border border-[oklch(0.7_0.18_145)]/30 sm:left-4"
            style={{ boxShadow: "0 0 24px -4px oklch(0.7 0.18 145 / 0.4)" }}
            data-ai-skip="true"
            onClick={toggleBeforeAfter}
          >
            <div className="flex items-start gap-2.5 p-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.7_0.18_145)]/15 text-[oklch(0.7_0.18_145)]">
                <Eye className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="eyebrow text-[oklch(0.7_0.18_145)]">
                  visual verified · {beforeAfter.label}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[0.65rem] leading-snug text-muted-foreground">
                  {beforeAfter.summary}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Maximize2 className="h-2.5 w-2.5 text-[oklch(0.7_0.18_145)]" />
                  <span className="font-mono-ae text-[0.55rem] text-[oklch(0.7_0.18_145)]">
                    click to compare before/after
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setBeforeAfter(null);
                }}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full modal — only when notification is clicked */}
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
              className="glass-strong relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
              style={{ boxShadow: "0 0 28px -4px oklch(0.7 0.18 145 / 0.5)" }}
            >
              <div className="flex items-start justify-between gap-4 border-b border-border/50 p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[oklch(0.7_0.18_145)]/15 text-[oklch(0.7_0.18_145)]">
                    <GitCompare className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="eyebrow text-[oklch(0.7_0.18_145)]">
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
                  className="rounded-lg bg-[oklch(0.7_0.18_145)]/15 px-4 py-1.5 font-mono-ae text-xs font-semibold text-[oklch(0.7_0.18_145)] transition-colors hover:bg-[oklch(0.7_0.18_145)]/25"
                >
                  continue evolving
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
