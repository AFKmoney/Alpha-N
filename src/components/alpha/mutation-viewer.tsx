/**
 * mutation-viewer.tsx — the live mutation feed: toggled by a chevron arrow
 * on the right edge, shows every applied mutation in real time with a
 * "thinking" banner while the AI is busy.
 */
"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";

function kindDot(kind: string): string {
  if (kind === "violation") return "bg-(--ae-rose)";
  if (kind.includes("code") || kind.includes("file") || kind.includes("commit")) return "bg-(--ae-emerald)";
  if (kind.includes("app") || kind.includes("window") || kind.includes("wallpaper") || kind.includes("theme")) return "bg-(--ae-gold)";
  if (kind.includes("terminal") || kind.includes("search") || kind.includes("exec") || kind.includes("compile")) return "bg-(--ae-cyan)";
  return "bg-(--ae-amethyst)";
}

export function MutationViewer(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const mutationStream = useEvolution((s) => s.mutationStream);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const aiReasoning = useEvolution((s) => s.aiReasoning);

  return (
    <div className="fixed right-0 top-1/2 z-[6800] flex -translate-y-1/2 items-center gap-0" data-ai-skip>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="glass-strong mr-1 h-[70vh] w-72 overflow-hidden rounded-2xl"
          >
            <div className="border-b border-white/8 px-3 py-2">
              <p className="eyebrow">live mutations</p>
            </div>
            {aiBusy && (
              <div className="flex items-center gap-2 border-b border-white/8 bg-(--ae-amethyst)/8 px-3 py-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-(--ae-amethyst)" />
                <span className="font-mono-ae truncate text-[10px] text-(--ae-amethyst)">
                  {aiReasoning ?? "N-Core is thinking…"}
                </span>
              </div>
            )}
            <div className="scroll-ae h-[calc(70vh-64px)] overflow-y-auto p-2">
              {mutationStream.length === 0 && (
                <p className="font-mono-ae p-3 text-[10.5px] text-zinc-600">
                  No mutations yet. Talk to me, or wait for the next cycle.
                </p>
              )}
              <div className="space-y-1">
                {mutationStream.map((mutation) => (
                  <div key={mutation.id} className="font-mono-ae flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", kindDot(mutation.kind))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10.5px] text-zinc-300" title={mutation.description}>
                        {mutation.description}
                      </p>
                      <p className="text-[9px] text-zinc-600">{new Date(mutation.time).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        whileHover={{ scale: 1.1 }}
        onClick={() => setOpen((o) => !o)}
        className="glass flex h-16 w-6 items-center justify-center rounded-l-xl text-zinc-400 hover:text-(--ae-cyan)"
        aria-label="Toggle mutation viewer"
      >
        <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </motion.button>
    </div>
  );
}

export default MutationViewer;
