"use client";

import { motion } from "framer-motion";

/**
 * AnimatedLogo — the Alpha-N brand logo with a breathing energy sphere.
 * The "α" glyph pulses with a cyan glow, and rotating rings orbit it.
 */
export function AnimatedLogo() {
  return (
    <div className="relative flex items-center gap-2.5">
      {/* Energy sphere with rotating ring */}
      <div className="relative flex h-10 w-10 items-center justify-center">
        {/* Pulsing glow */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full bg-[oklch(0.82_0.17_195)]/20 blur-md"
        />
        {/* Rotating outer ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-full border border-[oklch(0.82_0.17_195)]/30"
          style={{
            borderTopColor: "oklch(0.82 0.17 195 / 0.8)",
            borderRightColor: "transparent",
            borderBottomColor: "transparent",
            borderLeftColor: "oklch(0.74 0.22 300 / 0.4)",
          }}
        />
        {/* Counter-rotating inner ring */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          className="absolute inset-1.5 rounded-full border border-[oklch(0.74_0.22_300)]/20"
          style={{
            borderTopColor: "transparent",
            borderRightColor: "oklch(0.74 0.22 300 / 0.5)",
            borderBottomColor: "oklch(0.85 0.16 85 / 0.3)",
            borderLeftColor: "transparent",
          }}
        />
        {/* The α glyph */}
        <motion.span
          animate={{
            textShadow: [
              "0 0 8px oklch(0.82 0.17 195 / 0.4)",
              "0 0 16px oklch(0.82 0.17 195 / 0.7)",
              "0 0 8px oklch(0.82 0.17 195 / 0.4)",
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="relative font-mono-ae text-xl font-bold text-[oklch(0.82_0.17_195)]"
        >
          α
        </motion.span>
      </div>
      {/* Brand text */}
      <div className="flex flex-col leading-none">
        <span className="font-mono-ae text-xl font-bold tracking-tight text-foreground">
          Alpha<span className="text-glow-cyan text-[oklch(0.82_0.17_195)]">-N</span>
        </span>
        <span className="eyebrow mt-0.5">self-evolving OS</span>
      </div>
    </div>
  );
}
