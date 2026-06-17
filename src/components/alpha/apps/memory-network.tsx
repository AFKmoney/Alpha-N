/**
 * memory-network.tsx — interactive visualization of the Aether Engine's
 * semantic memory graph. Every node is a memory, plan, goal, or fact;
 * every edge is a semantic similarity link. The user can explore the
 * AI's mind as a living constellation and run semantic searches.
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Network, RefreshCw, X, Search } from "lucide-react";

interface GraphNode {
  id: string;
  text: string;
  kind: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const KIND_COLORS: Record<string, string> = {
  fact: "oklch(0.82 0.17 195)",
  lesson: "oklch(0.7 0.18 145)",
  architecture: "oklch(0.85 0.16 85)",
  plan: "oklch(0.85 0.16 85)",
  goal: "oklch(0.82 0.17 195)",
  intention: "oklch(0.74 0.22 300)",
  memory: "oklch(0.7 0.18 145)",
  log: "oklch(0.62 0.06 220)",
  code: "oklch(0.82 0.17 195)",
  event: "oklch(0.7 0.22 15)",
  default: "oklch(0.6 0.05 250)",
};

function colorForKind(kind: string): string {
  return KIND_COLORS[kind] ?? KIND_COLORS.default;
}

/**
 * MemoryNetwork — an interactive visualization of the Aether Engine's
 * semantic memory graph. Every node is a memory, plan, goal, or fact.
 * Every edge is a semantic similarity link. The user can explore the
 * AI's mind as a living constellation.
 */
export function MemoryNetworkApp() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; nodes: number; edges: number; cache_hits: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/alpha/aether?endpoint=graph", { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.nodes) {
        setGraph(data);
      }
    } catch {
      // Aether engine might not be running
    }
    setLoading(false);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/alpha/aether?endpoint=health", { cache: "no-store" });
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  // Initial load + auto-refresh every 4 seconds
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchGraph();
    void fetchHealth();
    const id = setInterval(() => {
      void fetchGraph();
      void fetchHealth();
    }, 4000);
    return () => clearInterval(id);
  }, [fetchGraph, fetchHealth]);

  // Semantic search
  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch("/api/alpha/aether?endpoint=graph/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: 10 }),
      });
      const data = await res.json();
      if (data.results) {
        setSearchResults(data.results);
      }
    } catch {
      // ignore
    }
  };

  // Compute node positions (force-directed-ish layout)
  const positions = useGraphLayout(graph, hovered);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
          <h3 className="font-mono-ae text-sm font-semibold">Memory Network</h3>
          {health && (
            <span className="font-mono-ae text-[0.55rem] text-muted-foreground">
              {health.nodes} nodes · {health.edges} edges · {health.decompositions || 0} decomps · {health.distillation_patterns || 0} patterns
            </span>
          )}
        </div>
        <button
          onClick={() => { void fetchGraph(); void fetchHealth(); }}
          className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border/50 p-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Semantic search the AI's memory…"
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
          />
        </div>
        <button
          onClick={doSearch}
          className="rounded-lg bg-[oklch(0.82_0.17_195)]/15 px-2.5 py-1 font-mono-ae text-[0.65rem] text-[oklch(0.82_0.17_195)] hover:bg-[oklch(0.82_0.17_195)]/25"
        >
          search
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="max-h-24 overflow-y-auto border-b border-border/50 p-2 scroll-ae">
          <div className="eyebrow mb-1">semantic search results</div>
          {searchResults.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelected(r)}
              className="block w-full truncate rounded px-2 py-0.5 text-left font-mono-ae text-[0.65rem] text-foreground/70 hover:bg-foreground/[0.06]"
            >
              <span className="text-[oklch(0.82_0.17_195)]">{r.score?.toFixed(2)}</span> {r.text.slice(0, 80)}
            </button>
          ))}
        </div>
      )}

      {/* Graph canvas */}
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : graph.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Network className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-mono-ae text-[0.7rem] text-muted-foreground/60">
              Memory graph is empty. The AI will populate it as it thinks.
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox="0 0 1000 700"
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="oklch(0.82 0.17 195 / 0.3)" />
                <stop offset="100%" stopColor="oklch(0.82 0.17 195 / 0)" />
              </radialGradient>
            </defs>

            {/* Edges */}
            {graph.edges.map((edge, i) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const isHighlighted = hovered === edge.from || hovered === edge.to;
              return (
                <line
                  key={i}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isHighlighted ? "oklch(0.82 0.17 195 / 0.5)" : "oklch(0.7 0.05 250 / 0.15)"}
                  strokeWidth={isHighlighted ? 1.5 : 0.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Nodes */}
            <AnimatePresence>
              {graph.nodes.map((node) => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                const color = colorForKind(node.kind);
                const isHovered = hovered === node.id;
                const isSelected = selected?.id === node.id;
                const r = isHovered || isSelected ? 14 : 9;
                return (
                  <motion.g
                    key={node.id}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
                    exit={{ opacity: 0, scale: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(node)}
                    style={{ cursor: "pointer" }}
                  >
                    {/* glow */}
                    <circle r={r + 8} fill="url(#nodeGlow)" opacity={isHovered ? 0.6 : 0.2} />
                    {/* core */}
                    <circle
                      r={r}
                      fill={color}
                      opacity={0.85}
                      className="synapse-node"
                    />
                    {/* ring on hover */}
                    {isHovered && (
                      <circle
                        r={r + 3}
                        fill="none"
                        stroke={color}
                        strokeWidth="1"
                        opacity="0.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {/* label */}
                    {(isHovered || isSelected) && (
                      <text
                        y={r + 14}
                        textAnchor="middle"
                        className="font-mono-ae"
                        fontSize="10"
                        fill="oklch(0.9 0.02 250)"
                      >
                        {node.text.slice(0, 30)}
                      </text>
                    )}
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </svg>
        )}

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1.5">
          {Object.entries(KIND_COLORS).filter(([k]) => k !== "default").map(([kind, color]) => (
            <div key={kind} className="flex items-center gap-1 rounded-full border border-border/40 bg-card/60 px-1.5 py-0.5 backdrop-blur">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              <span className="font-mono-ae text-[0.55rem] text-muted-foreground">{kind}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Selected node detail panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-[oklch(0.82_0.17_195)]/30 bg-[oklch(0.82_0.17_195)]/[0.05]"
          >
            <div className="flex items-start gap-2 p-3">
              <span
                className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                style={{ background: colorForKind(selected.kind) }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="eyebrow" style={{ color: colorForKind(selected.kind) }}>
                    {selected.kind}
                  </span>
                  {selected.score && (
                    <span className="font-mono-ae text-[0.55rem] text-muted-foreground">
                      relevance: {selected.score.toFixed(3)}
                    </span>
                  )}
                </div>
                <p className="mt-1 break-words font-mono-ae text-[0.72rem] leading-snug text-foreground/85">
                  {selected.text}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Simple force-directed layout for the graph nodes.
 * Computes positions based on a circular layout with jitter,
 * then applies a few iterations of spring relaxation.
 */
function useGraphLayout(graph: GraphData, hovered: string | null): Map<string, { x: number; y: number }> {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (graph.nodes.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPositions(new Map());
      return;
    }

    const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    const cx = 500;
    const cy = 350;
    const radius = 250;

    // Initialize with circular layout
    graph.nodes.forEach((node, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      const r = radius * (0.5 + Math.random() * 0.5);
      pos.set(node.id, {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      });
    });

    // Build adjacency map
    const adj = new Map<string, string[]>();
    graph.edges.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from)!.push(e.to);
      adj.get(e.to)!.push(e.from);
    });

    // Spring relaxation (10 iterations)
    for (let iter = 0; iter < 10; iter++) {
      // Repulsion between all nodes
      const nodes = graph.nodes;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos.get(nodes[i].id)!;
          const b = pos.get(nodes[j].id)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const force = 500 / (dist * dist);
          a.vx -= (dx / dist) * force;
          a.vy -= (dy / dist) * force;
          b.vx += (dx / dist) * force;
          b.vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      graph.edges.forEach((edge) => {
        const a = pos.get(edge.from);
        const b = pos.get(edge.to);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;
        const force = dist * 0.01 * edge.weight;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      });

      // Apply velocity with damping + center gravity
      pos.forEach((p) => {
        p.vx = p.vx * 0.5 + (cx - p.x) * 0.001;
        p.vy = p.vy * 0.5 + (cy - p.y) * 0.001;
        p.x += Math.max(-20, Math.min(20, p.vx));
        p.y += Math.max(-20, Math.min(20, p.vy));
        // clamp to viewport
        p.x = Math.max(50, Math.min(950, p.x));
        p.y = Math.max(50, Math.min(650, p.y));
      });
    }

    // Convert to output format
    const out = new Map<string, { x: number; y: number }>();
    pos.forEach((p, id) => {
      out.set(id, { x: p.x, y: p.y });
    });
    setPositions(out);
  }, [graph.nodes, graph.edges]);

  return positions;
}
