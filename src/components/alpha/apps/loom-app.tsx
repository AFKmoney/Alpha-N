/**
 * loom-app.tsx — the Loom: the living code surface. Renders the evolution
 * store's tokenized codeLines with variable-link glow on hover, ghost lines,
 * mutated-line markers, and click-to-explain on changed lines.
 */
"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvolution, useCodeLines } from "@/lib/alpha/evolution-store";

export function LoomApp(): React.ReactElement {
  const lines = useCodeLines();
  const mutationStream = useEvolution((s) => s.mutationStream);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const [explain, setExplain] = useState<string | null>(null);

  const explainFor = (mutId?: string): string | null => {
    if (!mutId) return null;
    const found = mutationStream.find((m) => m.id === mutId);
    return found ? `${found.description} — ${new Date(found.time).toLocaleTimeString()}` : null;
  };

  return (
    <div className="relative flex h-full flex-col">
      {aiBusy && (
        <div className="lifeline-pulse absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-(--ae-cyan) to-transparent" />
      )}
      <div className="scroll-ae font-mono-ae flex-1 overflow-auto p-4 text-[11.5px] leading-6">
        {lines.lines.map((line) => (
          <div
            key={line.no}
            className={cn(
              "group flex rounded px-1 transition-colors",
              line.status === "changed" && "cursor-pointer bg-(--ae-amethyst)/8 hover:bg-(--ae-amethyst)/15",
              line.status === "ghost" && "ghost-line"
            )}
            onClick={() => setExplain(explainFor(line.mutId) ?? (line.status === "changed" ? "Mutation applied here." : null))}
          >
            <span className="mr-3 w-8 shrink-0 select-none text-right text-zinc-700">{line.no}</span>
            <span className="whitespace-pre">
              {line.tokens.map((token, i) => (
                <span
                  key={i}
                  className={cn(
                    token.cls,
                    token.cls?.includes("cyan") && "transition-all hover:text-glow-cyan"
                  )}
                >
                  {token.text}
                </span>
              ))}
            </span>
            {line.status === "changed" && (
              <span className="ml-auto pl-3 text-[9px] text-(--ae-amethyst)/70 opacity-0 transition-opacity group-hover:opacity-100">
                mutated
              </span>
            )}
          </div>
        ))}
        {lines.ghost.map((line) => (
          <div key={`ghost-${line.no}`} className="ghost-line flex">
            <span className="mr-3 w-8 shrink-0 select-none text-right text-zinc-700">{line.no}</span>
            <span className="whitespace-pre">
              {line.tokens.map((token, i) => (
                <span key={i} className={token.cls ?? "text-zinc-600"}>
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {explain && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="glass font-mono-ae absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg p-3 text-[11px] text-zinc-300"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--ae-amethyst)" />
            <p className="flex-1">{explain}</p>
            <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => setExplain(null)}>
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LoomApp;
