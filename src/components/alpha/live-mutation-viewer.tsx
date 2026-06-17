/**
 * live-mutation-viewer.tsx — side panel toggled via an arrow on the right
 * edge of the screen. Shows every mutation N-Core applies in real time,
 * with a "thinking" banner when the AI is busy.
 */
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<string, string> = {
  set_state: "text-[oklch(0.82_0.17_195)]",
  set_active_agent: "text-[oklch(0.74_0.22_300)]",
  set_agent: "text-[oklch(0.74_0.22_300)]",
  add_log: "text-[oklch(0.62_0.06_220)]",
  update_metric: "text-[oklch(0.85_0.16_85)]",
  replace_code: "text-[oklch(0.82_0.17_195)]",
  insert_code: "text-[oklch(0.7_0.18_145)]",
  commit_evolution: "text-[oklch(0.85_0.16_85)]",
  speak: "text-[oklch(0.74_0.22_300)]",
  create_app: "text-[oklch(0.82_0.17_195)]",
  close_app: "text-[oklch(0.7_0.22_15)]",
  run_terminal: "text-[oklch(0.82_0.16_85)]",
  web_search: "text-[oklch(0.82_0.17_195)]",
  add_memory: "text-[oklch(0.7_0.18_145)]",
  add_intention: "text-[oklch(0.85_0.16_85)]",
  violation: "text-[oklch(0.78_0.2_20)]",
};

/**
 * LiveMutationViewer — a side panel toggled via an arrow on the right edge.
 * Shows every mutation N-Core applies, in real time.
 */
export function LiveMutationViewer() {
  const { mutationStream, aiBusy, aiReasoning } = useEvolution();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle arrow on the screen edge */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "glass-strong fixed top-1/2 z-40 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-border/60 transition-all hover:w-7",
          open ? "right-[280px] sm:right-[300px]" : "right-0"
        )}
        data-ai-skip="true"
        aria-label={open ? "Hide mutation viewer" : "Show mutation viewer"}
        title={open ? "Hide live mutations" : "Show live mutations"}
      >
        {open ? (
          <ChevronRight className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
        ) : (
          <>
            <ChevronLeft className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap font-mono-ae text-[0.5rem] text-muted-foreground">
              mutations
            </span>
          </>
        )}
        {mutationStream.length > 0 && !open && (
          <span className="absolute -left-1 top-2 h-2 w-2 rounded-full bg-[oklch(0.82_0.17_195)] neural-dot" />
        )}
      </button>

      {/* The panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="glass-strong fixed right-0 top-0 z-30 flex h-full w-[280px] flex-col border-l border-border/60 sm:w-[300px]"
            data-ai-skip="true"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Activity className={cn("h-4 w-4 text-[oklch(0.82_0.17_195)]", aiBusy && "animate-pulse")} />
                <h2 className="font-mono-ae text-sm font-semibold">Live Mutations</h2>
              </div>
              <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
                {mutationStream.length} total
              </span>
            </div>

            {aiBusy && aiReasoning && (
              <div className="border-b border-border/40 bg-[oklch(0.82_0.17_195)]/[0.05] px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="h-1.5 w-1.5 rounded-full bg-[oklch(0.82_0.17_195)]"
                  />
                  <span className="font-mono-ae text-[0.6rem] text-[oklch(0.82_0.17_195)]">thinking</span>
                </div>
                <p className="mt-1 font-mono-ae text-[0.62rem] italic leading-snug text-foreground/80">
                  {aiReasoning.slice(0, 140)}…
                </p>
              </div>
            )}

            <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-2">
              {mutationStream.length === 0 && (
                <div className="flex h-full items-center justify-center px-4 text-center">
                  <p className="font-mono-ae text-[0.7rem] text-muted-foreground/60">
                    No mutations yet. N-Core is about to act…
                  </p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {mutationStream.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-1 flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.03]"
                  >
                    <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", (KIND_COLOR[m.kind] ?? "text-muted-foreground").replace("text-", "bg-"))} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono-ae text-[0.66rem] leading-snug text-foreground/85 break-words">
                        {m.description}
                      </p>
                      <span className="font-mono-ae text-[0.52rem] text-muted-foreground/40">
                        {new Date(m.time).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
