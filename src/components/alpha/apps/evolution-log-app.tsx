/**
 * evolution-log-app.tsx — the OODA log (observe/critique/hypothesis/deploy/
 * evolve/heal) streaming from the store, plus the Timeline of Speciation:
 * every committed generation, clickable to open its history diff.
 */
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { LogLevel } from "@/lib/alpha/evolution-data";

const LEVEL_COLOR: Record<LogLevel, string> = {
  observe: "text-(--ae-cyan)",
  critique: "text-(--ae-rose)",
  hypothesis: "text-(--ae-gold)",
  deploy: "text-(--ae-emerald)",
  evolve: "text-(--ae-amethyst)",
  heal: "text-(--ae-emerald)",
};

export function EvolutionLogApp(): React.ReactElement {
  const logs = useEvolution((s) => s.logs);
  const history = useEvolution((s) => s.history);
  const generation = useEvolution((s) => s.generation);
  const version = useEvolution((s) => s.version);
  const openHistoryDiff = useEvolution((s) => s.openHistoryDiff);

  return (
    <div className="flex h-full">
      {/* OODA stream */}
      <div className="scroll-ae min-w-0 flex-1 overflow-y-auto border-r border-white/8 p-3">
        <p className="eyebrow mb-2">ooda stream</p>
        <div className="space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="font-mono-ae flex items-start gap-2 text-[11px]">
              <span className="w-14 shrink-0 text-zinc-600">{new Date(log.time).toLocaleTimeString()}</span>
              <span className={cn("w-16 shrink-0 font-semibold", LEVEL_COLOR[log.level])}>[{log.level}]</span>
              <span className="min-w-0 flex-1 text-zinc-300">
                <span className="text-zinc-500">{log.agent}:</span> {log.message}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline of Speciation */}
      <div className="scroll-ae w-64 shrink-0 overflow-y-auto p-3">
        <p className="eyebrow mb-2">timeline of speciation</p>
        <p className="font-mono-ae mb-3 text-[10px] text-zinc-500">
          gen {generation} · v{version} · {history.length} commits
        </p>
        <div className="space-y-2">
          {history.map((entry, i) => (
            <motion.button
              key={entry.id}
              type="button"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              onClick={() => openHistoryDiff(entry.id)}
              className="group w-full rounded-lg border border-white/8 bg-white/3 p-2.5 text-left transition-colors hover:border-(--ae-amethyst)/40 hover:bg-(--ae-amethyst)/8"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono-ae text-[11px] font-semibold text-zinc-200 group-hover:text-(--ae-amethyst)">
                  {entry.title}
                </span>
                <span className="font-mono-ae text-[9px] text-zinc-500">v{entry.version}</span>
              </div>
              <p className="font-mono-ae mt-0.5 line-clamp-2 text-[10px] text-zinc-500">{entry.summary}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.deltas.slice(0, 3).map((delta) => (
                  <span
                    key={delta.metric}
                    className={cn(
                      "font-mono-ae rounded px-1 text-[9px]",
                      delta.better === "lower"
                        ? delta.after < delta.before
                          ? "bg-(--ae-emerald)/15 text-(--ae-emerald)"
                          : "bg-(--ae-rose)/15 text-(--ae-rose)"
                        : delta.after > delta.before
                          ? "bg-(--ae-emerald)/15 text-(--ae-emerald)"
                          : "bg-(--ae-rose)/15 text-(--ae-rose)"
                    )}
                  >
                    {delta.metric} {delta.before}→{delta.after}
                  </span>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default EvolutionLogApp;
