/**
 * synapse-map.tsx — full-screen SVG constellation of the OS architecture.
 * Renders 9 nodes (nucleus, agents, modules, memory, UI) with edges that
 * ignite when the council deliberates or a node is hovered.
 */
"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Network, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { SYNAPSE_EDGES, SYNAPSE_NODES, type SynapseNode } from "@/lib/alpha/evolution-data";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<SynapseNode["kind"], { fill: string; stroke: string; label: string }> = {
  core: { fill: "oklch(0.82 0.17 195)", stroke: "oklch(0.82 0.17 195)", label: "core" },
  agent: { fill: "oklch(0.74 0.22 300)", stroke: "oklch(0.74 0.22 300)", label: "agent" },
  module: { fill: "oklch(0.85 0.16 85)", stroke: "oklch(0.85 0.16 85)", label: "module" },
  memory: { fill: "oklch(0.7 0.18 145)", stroke: "oklch(0.7 0.18 145)", label: "memory" },
  ui: { fill: "oklch(0.7 0.22 15)", stroke: "oklch(0.7 0.22 15)", label: "ui" },
};

export function SynapseMap() {
  const { synapseOpen, toggleSynapse, activeAgent, aiState } = useEvolution();
  const [hovered, setHovered] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(SYNAPSE_NODES.map((n) => [n.id, n])),
    []
  );

  return (
    <AnimatePresence>
      {synapseOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
        >
          <div className="absolute inset-0 bg-background/80 backdrop-blur-lg" onClick={toggleSynapse} />
          <motion.div
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="glass-strong relative z-10 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl glow-amethyst"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-[oklch(0.74_0.22_300)]" />
                <h2 className="font-mono-ae text-sm font-semibold">Synapse Map</h2>
                <span className="eyebrow ml-2">architecture constellation</span>
              </div>
              <button
                onClick={toggleSynapse}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close synapse map"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="synapseGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="oklch(0.82 0.17 195 / 0.25)" />
                    <stop offset="100%" stopColor="oklch(0.82 0.17 195 / 0)" />
                  </radialGradient>
                  <filter id="synapseBlur">
                    <feGaussianBlur stdDeviation="0.4" />
                  </filter>
                </defs>

                {/* ambient glow */}
                <circle cx="50" cy="48" r="42" fill="url(#synapseGlow)" />

                {/* edges */}
                {SYNAPSE_EDGES.map((e, i) => {
                  const from = nodeMap.get(e.from)!;
                  const to = nodeMap.get(e.to)!;
                  const lit =
                    hovered === e.from ||
                    hovered === e.to ||
                    (activeAgent &&
                      ((e.from === "nucleus" && e.to === agentToNode(activeAgent)) ||
                        (e.to === "nucleus" && e.from === agentToNode(activeAgent)))) ||
                    aiState === "self-improving";
                  return (
                    <g key={i}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={lit ? "oklch(0.82 0.17 195 / 0.7)" : "oklch(0.7 0.05 250 / 0.18)"}
                        strokeWidth={lit ? 0.5 : 0.25}
                        vectorEffect="non-scaling-stroke"
                      />
                      {lit && aiState === "self-improving" && (
                        <motion.circle
                          r="0.7"
                          fill="oklch(0.82 0.17 195)"
                          initial={{ opacity: 0 }}
                          animate={{
                            opacity: [0, 1, 0],
                            cx: [from.x, to.x],
                            cy: [from.y, to.y],
                          }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                    </g>
                  );
                })}

                {/* nodes */}
                {SYNAPSE_NODES.map((n) => {
                  const style = KIND_STYLE[n.kind];
                  const isHovered = hovered === n.id;
                  const isAgent = n.kind === "agent";
                  const agentActive =
                    isAgent && activeAgent && agentToNode(activeAgent) === n.id;
                  const r = n.size / 4 + (n.z * 1.5);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x} ${n.y})`}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                      className="cursor-pointer"
                    >
                      {/* halo */}
                      <circle
                        r={r + (isHovered ? 4 : 2)}
                        fill={style.fill}
                        opacity={isHovered || agentActive ? 0.18 : 0.07}
                      />
                      {/* core */}
                      <circle
                        r={r}
                        fill={style.fill}
                        opacity={0.85}
                        className="synapse-node"
                      />
                      {n.kind === "core" && (
                        <circle
                          r={r + 1.5}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth="0.3"
                          opacity="0.5"
                          vectorEffect="non-scaling-stroke"
                        >
                          <animate
                            attributeName="r"
                            values={`${r + 1};${r + 3};${r + 1}`}
                            dur="3s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      )}
                      <text
                        y={r + 3}
                        textAnchor="middle"
                        className="font-mono-ae"
                        fontSize="2.2"
                        fill={isHovered ? "oklch(0.98 0 0)" : "oklch(0.7 0.03 250)"}
                      >
                        {n.label}
                      </text>
                      <text
                        y={r + 5.6}
                        textAnchor="middle"
                        fontSize="1.5"
                        fill="oklch(0.55 0.03 250)"
                        className="font-mono-ae"
                      >
                        {style.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* legend */}
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
                {(Object.keys(KIND_STYLE) as SynapseNode["kind"][]).map((k) => (
                  <div
                    key={k}
                    className="flex items-center gap-1.5 rounded-full border border-border/40 bg-card/60 px-2 py-0.5 backdrop-blur"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: KIND_STYLE[k].fill }}
                    />
                    <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
                      {KIND_STYLE[k].label}
                    </span>
                  </div>
                ))}
              </div>

              {/* hint */}
              <div className="pointer-events-none absolute right-3 top-3 max-w-[200px] rounded-lg border border-border/40 bg-card/60 px-3 py-1.5 backdrop-blur">
                <p className="font-mono-ae text-[0.6rem] leading-relaxed text-muted-foreground">
                  {hovered
                    ? `→ ${nodeMap.get(hovered)?.label}: this faculty ${hovered === "nucleus" ? "is the organism's core" : "binds to the Nucleus"}.`
                    : "Hover a node. Edges ignite when the council deliberates."}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function agentToNode(role: string): string {
  switch (role) {
    case "architect":
      return "arch";
    case "developer":
      return "dev";
    case "critic":
      return "critic";
    case "optimizer":
      return "opt";
    default:
      return "";
  }
}
