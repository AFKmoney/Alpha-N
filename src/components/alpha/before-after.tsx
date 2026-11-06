/**
 * before-after.tsx — the visual-diff notification: when the AI commits,
 * a small non-intrusive toast (top-right) announces "visual verified";
 * clicking expands the full before/after screenshot modal.
 */
"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useMounted } from "@/lib/alpha/use-mounted";

export function BeforeAfter(): React.ReactElement {
  const beforeAfter = useEvolution((s) => s.beforeAfter);
  const beforeAfterOpen = useEvolution((s) => s.beforeAfterOpen);
  const setBeforeAfter = useEvolution((s) => s.setBeforeAfter);
  const toggleBeforeAfter = useEvolution((s) => s.toggleBeforeAfter);
  const [phase, setPhase] = useState<"before" | "after">("after");
  const mounted = useMounted();

  if (!mounted) return <></>;

  return createPortal(
    <>
      {/* notification toast */}
      <AnimatePresence>
        {beforeAfter && !beforeAfterOpen && (
          <motion.button
            type="button"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            onClick={toggleBeforeAfter}
            className="glass-strong font-mono-ae fixed right-3 top-14 z-[9000] flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-zinc-300 hover:border-[--ae-cyan]/40"
          >
            <Eye className="h-3.5 w-3.5 text-[--ae-cyan]" />
            <span>
              visual verified — <span className="text-[--ae-cyan]">{beforeAfter.label}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* full modal */}
      <AnimatePresence>
        {beforeAfter && beforeAfterOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9300] flex items-center justify-center bg-black/60 p-6"
            onClick={toggleBeforeAfter}
          >
            <motion.div
              initial={{ scale: 0.95, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 12 }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              className="glass-strong w-full max-w-3xl rounded-2xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="eyebrow">visual diff · what I just did</p>
                  <p className="font-mono-ae mt-0.5 text-[11px] text-zinc-300">{beforeAfter.label}</p>
                </div>
                <div className="flex items-center gap-2" data-ai-skip>
                  <div className="flex overflow-hidden rounded-lg border border-white/10">
                    {(["before", "after"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPhase(p)}
                        className={cn(
                          "font-mono-ae px-2.5 py-1 text-[10px] capitalize",
                          phase === p ? "bg-[--ae-cyan]/15 text-[--ae-cyan]" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setBeforeAfter(null)} className="text-zinc-500 hover:text-zinc-200">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="font-mono-ae mb-3 text-[11px] italic text-zinc-500">
                “N-Core saw both.”
              </p>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                {phase === "before" ? (
                  beforeAfter.before ? (
                     
                    <img src={beforeAfter.before} alt="desktop before" className="max-h-[60vh] w-full object-contain" />
                  ) : (
                    <p className="font-mono-ae p-8 text-center text-xs text-zinc-600">no before screenshot</p>
                  )
                ) : beforeAfter.after ? (
                   
                  <img src={beforeAfter.after} alt="desktop after" className="max-h-[60vh] w-full object-contain" />
                ) : (
                  <p className="font-mono-ae p-8 text-center text-xs text-zinc-600">no after screenshot</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

export default BeforeAfter;
