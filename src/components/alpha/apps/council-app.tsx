/**
 * council-app.tsx — the 4-agent council: live load rings, states and
 * current thoughts straight from the evolution store.
 */
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";

const HUES: Record<string, { text: string; ring: string; bg: string }> = {
  architect: { text: "text-(--ae-amethyst)", ring: "stroke-(--ae-amethyst)", bg: "bg-(--ae-amethyst)/10" },
  developer: { text: "text-(--ae-cyan)", ring: "stroke-(--ae-cyan)", bg: "bg-(--ae-cyan)/10" },
  critic: { text: "text-(--ae-rose)", ring: "stroke-(--ae-rose)", bg: "bg-(--ae-rose)/10" },
  optimizer: { text: "text-(--ae-gold)", ring: "stroke-(--ae-gold)", bg: "bg-(--ae-gold)/10" },
};

export function CouncilApp(): React.ReactElement {
  const agents = useEvolution((s) => s.agents);
  const activeAgent = useEvolution((s) => s.activeAgent);
  const aiBusy = useEvolution((s) => s.aiBusy);

  return (
    <div className="scroll-ae h-full overflow-y-auto p-4">
      <p className="eyebrow mb-3">agent council {aiBusy ? "— deliberating" : "— standing by"}</p>
      <div className="grid grid-cols-2 gap-3">
        {agents.map((agent, i) => {
          const hue = HUES[agent.role] ?? HUES.optimizer;
          const load = Math.min(1, Math.max(0, agent.load));
          const circumference = 2 * Math.PI * 20;
          return (
            <motion.div
              key={agent.role}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={cn("glass rounded-xl p-3", agent.role === activeAgent && hue.bg)}
            >
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 shrink-0">
                  <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className={hue.ring}
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - load)}
                      style={{ transition: "stroke-dashoffset 600ms ease" }}
                    />
                  </svg>
                  <span className={cn("font-mono-ae absolute inset-0 flex items-center justify-center text-[10px]", hue.text)}>
                    {Math.round(load * 100)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className={cn("font-mono-ae text-xs font-semibold capitalize", hue.text)}>{agent.role}</p>
                  <p className="font-mono-ae text-[10px] text-zinc-500">{agent.status}</p>
                </div>
              </div>
              <p className="font-mono-ae mt-2 line-clamp-3 min-h-[2.4rem] text-[10.5px] leading-4 text-zinc-400">
                {agent.thought ?? "—"}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default CouncilApp;
