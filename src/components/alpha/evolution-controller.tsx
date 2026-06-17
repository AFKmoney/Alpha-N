"use client";

import { useEffect } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";

/**
 * EvolutionController — runs the organism's heartbeat.
 * Every second it ticks telemetry. When the organism is at rest
 * for a while, it autonomously initiates a self-improvement cycle.
 * It never asks permission.
 */
export function EvolutionController() {
  const tick = useEvolution((s) => s.tick);
  const startEvolution = useEvolution((s) => s.startEvolution);
  const aiState = useEvolution((s) => s.aiState);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const diffOpen = useEvolution((s) => s.diffOpen);

  useEffect(() => {
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [tick]);

  // Autonomous self-improvement: when resting and no diff is showing,
  // the metacognitive loop stirs and mutates on its own.
  useEffect(() => {
    if (aiState !== "observing") return;
    if (activeEvolution) return;
    if (diffOpen) return;

    const delay = 22000 + Math.random() * 14000;
    const id = setTimeout(() => startEvolution(), delay);
    return () => clearTimeout(id);
  }, [aiState, activeEvolution, diffOpen, startEvolution]);

  return null;
}
