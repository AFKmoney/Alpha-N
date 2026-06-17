"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Cpu } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AGENT_META, type Agent, type AgentStatus } from "@/lib/alpha/evolution-data";
import { cn } from "@/lib/utils";

const HUE_RING: Record<Agent["hue"], string> = {
  cyan: "stroke-[oklch(0.82_0.17_195)]",
  amethyst: "stroke-[oklch(0.74_0.22_300)]",
  gold: "stroke-[oklch(0.85_0.16_85)]",
  rose: "stroke-[oklch(0.7_0.22_15)]",
};
const HUE_TEXT: Record<Agent["hue"], string> = {
  cyan: "text-[oklch(0.82_0.17_195)]",
  amethyst: "text-[oklch(0.74_0.22_300)]",
  gold: "text-[oklch(0.85_0.16_85)]",
  rose: "text-[oklch(0.7_0.22_15)]",
};
const HUE_GLOW: Record<Agent["hue"], string> = {
  cyan: "glow-cyan",
  amethyst: "glow-amethyst",
  gold: "glow-gold",
  rose: "",
};

const STATUS_VERB: Record<AgentStatus, string> = {
  idle: "standing by",
  thinking: "thinking",
  writing: "writing",
  reviewing: "auditing",
  optimizing: "optimizing",
  deploying: "deploying",
};

export function AgentPanel() {
  const { agents, activeAgent, aiState } = useEvolution();

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[oklch(0.74_0.22_300)]" />
          <h2 className="font-mono-ae text-sm font-semibold">Cognitive Council</h2>
        </div>
        <span className="eyebrow">{aiState === "observing" ? "at rest" : "deliberating"}</span>
      </div>

      <div className="scroll-ae min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {agents.map((a) => {
          const isActive = activeAgent === a.role;
          return (
            <motion.div
              key={a.role}
              layout
              className={cn(
                "rounded-xl border p-3 transition-all",
                isActive
                  ? cn("border-transparent bg-card/60", HUE_GLOW[a.hue])
                  : "border-border/40 bg-card/30"
              )}
            >
              <div className="flex items-center gap-3">
                {/* Load ring */}
                <div className="relative h-10 w-10 shrink-0">
                  <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="oklch(0.7 0.05 250 / 0.15)"
                      strokeWidth="2.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className={HUE_RING[a.hue]}
                      strokeDasharray={`${(a.load * 94.2).toFixed(3)} 94.2`}
                      style={{ transition: "stroke-dasharray 0.5s ease" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn("text-base leading-none", HUE_TEXT[a.hue])}>
                      {a.glyph}
                    </span>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-ae text-xs font-semibold text-foreground">
                      {a.name}
                    </span>
                    <span
                      className={cn(
                        "eyebrow",
                        isActive ? HUE_TEXT[a.hue] : "text-muted-foreground"
                      )}
                    >
                      {STATUS_VERB[a.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">
                    {AGENT_META[a.role].mandate}
                  </p>
                </div>
              </div>

              {/* Live thought */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={a.thought}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    "mt-2 rounded-lg border-l-2 px-2.5 py-1.5 text-[0.7rem] italic leading-snug",
                    isActive
                      ? cn("border-l-current bg-foreground/[0.04]", HUE_TEXT[a.hue])
                      : "border-border/40 bg-foreground/[0.02] text-muted-foreground"
                  )}
                >
                  &ldquo;{a.thought}&rdquo;
                </motion.div>
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
