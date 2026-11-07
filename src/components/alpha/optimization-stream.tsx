/**
 * optimization-stream.tsx — the mutation feed panel showing every action
 * the AI applied in real time, with a live reasoning banner when busy.
 */
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Activity, Zap } from "lucide-react";
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
  set_generation: "text-muted-foreground",
  set_version: "text-muted-foreground",
};

export function OptimizationStream() {
  const { mutationStream, aiBusy, aiReasoning } = useEvolution();

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className={cn("h-4 w-4 text-[oklch(0.82_0.17_195)]", aiBusy && "animate-pulse")} />
          <h2 className="font-mono-ae text-sm font-semibold">Optimization Stream</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.span
            animate={{ opacity: aiBusy ? [0.4, 1, 0.4] : 0.6 }}
            transition={{ duration: 1.2, repeat: aiBusy ? Infinity : 0 }}
            className="h-1.5 w-1.5 rounded-full bg-[oklch(0.82_0.17_195)]"
          />
          <span className="eyebrow">{aiBusy ? "mutating" : "idle"}</span>
        </div>
      </div>

      {aiBusy && aiReasoning && (
        <div className="border-b border-border/40 bg-[oklch(0.82_0.17_195)]/[0.05] px-4 py-2">
          <p className="font-mono-ae text-[0.65rem] italic leading-snug text-foreground/80">
            {aiReasoning}
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
              initial={{ opacity: 0, x: -10, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-1 flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.03]"
            >
              <Zap className={cn("mt-0.5 h-3 w-3 shrink-0", KIND_COLOR[m.kind] ?? "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <p className="font-mono-ae text-[0.68rem] leading-snug text-foreground/85 break-words">
                  {m.description}
                </p>
                <span className="font-mono-ae text-[0.55rem] text-muted-foreground/40">
                  {new Date(m.time).toLocaleTimeString("en-US", { hour12: false })}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
