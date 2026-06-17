"use client";

import { useEffect } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";

/**
 * EvolutionController — the organism's heartbeat + scripted fallback.
 *
 * - Always ticks telemetry every second.
 * - The scripted evolution loop only fires when the AI autonomy is OFF,
 *   acting as a non-network fallback so the UI still feels alive offline.
 * - When autonomy is ON, the real LLM-driven AutonomousLoop owns self-improvement.
 */
export function EvolutionController() {
  const tick = useEvolution((s) => s.tick);
  const startEvolution = useEvolution((s) => s.startEvolution);
  const aiState = useEvolution((s) => s.aiState);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const diffOpen = useEvolution((s) => s.diffOpen);
  const beforeAfterOpen = useEvolution((s) => s.beforeAfterOpen);
  const autonomy = useEvolution((s) => s.autonomy);
  const aiBusy = useEvolution((s) => s.aiBusy);

  useEffect(() => {
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [tick]);

  // Scripted fallback: only when autonomy is off and nothing else is happening.
  useEffect(() => {
    if (autonomy) return;
    if (aiBusy) return;
    if (aiState !== "observing") return;
    if (activeEvolution) return;
    if (diffOpen || beforeAfterOpen) return;

    const delay = 16000 + Math.random() * 10000;
    const id = setTimeout(() => startEvolution(), delay);
    return () => clearTimeout(id);
  }, [aiState, activeEvolution, diffOpen, beforeAfterOpen, autonomy, aiBusy, startEvolution]);

  return null;
}
