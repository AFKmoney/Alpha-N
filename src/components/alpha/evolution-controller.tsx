"use client";

import { useEffect } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";

/**
 * EvolutionController — the organism's heartbeat.
 * Only ticks telemetry every second. All self-improvement is driven by the
 * real LLM via AutonomousLoop — nothing here is scripted or simulated.
 */
export function EvolutionController() {
  const tick = useEvolution((s) => s.tick);

  useEffect(() => {
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [tick]);

  return null;
}
