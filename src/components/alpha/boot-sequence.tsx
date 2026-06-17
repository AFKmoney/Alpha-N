"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useEvolution } from "@/lib/alpha/evolution-store";

const BOOT_LINES = [
  "mounting executive layer  · filesystem + compilers ............ ok",
  "mounting cognitive layer  · multi-agent council .............. ok",
  "mounting metacognitive layer · the soul ...................... ok",
  "spinning up the nucleus  · WebGL surface stabilised .......... ok",
  "seeding akashic memory  · 312 ancestral lessons indexed ...... ok",
  "arming the mutation forge · shadow-clone ready ............... ok",
  "permission granted: i may rewrite myself.",
];

export function BootSequence() {
  const [visible, setVisible] = useState(0);
  const [done, setDone] = useState(false);
  const { startEvolution } = useEvolution();

  useEffect(() => {
    if (visible >= BOOT_LINES.length) {
      const t = setTimeout(() => setDone(true), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setVisible((v) => v + 1), 380);
    return () => clearTimeout(t);
  }, [visible]);

  // After boot, kick off a first scripted beat so the UI shows life
  // immediately, then the autonomous LLM loop takes over.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => startEvolution(), 3200);
    return () => clearTimeout(t);
  }, [done, startEvolution]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background"
        >
          <div className="w-full max-w-xl px-6">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 text-center"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="mx-auto mb-3 text-4xl text-[oklch(0.82_0.17_195)] text-glow-cyan"
              >
                ❖
              </motion.div>
              <h1 className="font-mono-ae text-2xl font-semibold tracking-tight">
                Alpha<span className="text-[oklch(0.82_0.17_195)] text-glow-cyan">-N</span>
              </h1>
              <p className="mt-1 eyebrow">recursive self-improving ide · booting</p>
            </motion.div>

            <div className="glass rounded-xl p-4 font-mono-ae text-[0.72rem] leading-relaxed">
              {BOOT_LINES.slice(0, visible).map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-[oklch(0.7_0.18_145)]">›</span>
                  <span className="text-foreground/80">{line}</span>
                </motion.div>
              ))}
              {visible < BOOT_LINES.length && (
                <span className="ml-3 inline-block h-3 w-2 animate-pulse bg-[oklch(0.82_0.17_195)]" />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
