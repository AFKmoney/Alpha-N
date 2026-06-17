"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollText } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AGENT_META, type LogLevel } from "@/lib/alpha/evolution-data";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";

const LEVEL_STYLE: Record<LogLevel, { color: string; glyph: string; label: string }> = {
  observe: { color: "text-[oklch(0.62_0.06_220)]", glyph: "◎", label: "observe" },
  critique: { color: "text-[oklch(0.7_0.22_15)]", glyph: "◉", label: "critique" },
  hypothesis: { color: "text-[oklch(0.74_0.22_300)]", glyph: "◈", label: "hypothesis" },
  deploy: { color: "text-[oklch(0.82_0.17_195)]", glyph: "⌬", label: "deploy" },
  evolve: { color: "text-[oklch(0.85_0.16_85)]", glyph: "❖", label: "evolve" },
  heal: { color: "text-[oklch(0.7_0.18_145)]", glyph: "✚", label: "heal" },
};

export function EvolutionLog() {
  const { logs } = useEvolution();
  const scrollRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-[oklch(0.7_0.18_145)]" />
          <h2 className="font-mono-ae text-sm font-semibold">EVOLUTION.md</h2>
        </div>
        <span className="eyebrow">metacognitive stream</span>
      </div>
      <div ref={scrollRef} className="scroll-ae min-h-0 flex-1 overflow-y-auto p-2.5">
        <AnimatePresence initial={false}>
          {logs.map((log) => {
            const style = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.observe;
            const agentName =
              log.agent === "nucleus"
                ? "nucleus"
                : AGENT_META[log.agent].name.replace("The ", "");
            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -8, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mb-1 flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.03]"
              >
                <span className={cn("mt-0.5 shrink-0 text-xs", style.color)}>{style.glyph}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("eyebrow", style.color)}>{style.label}</span>
                    <span className="font-mono-ae text-[0.58rem] text-muted-foreground/60">
                      {agentName}
                    </span>
                    <span className="ml-auto font-mono-ae text-[0.55rem] text-muted-foreground/40">
                      {mounted ? new Date(log.time).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono-ae text-[0.72rem] leading-snug text-foreground/85">
                    {log.message}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
