/**
 * memory-network.tsx — the Aether Engine's semantic memory graph as a
 * living constellation: force-directed SVG layout, semantic search, health
 * stats, auto-refresh every 4s. Graceful when the engine is offline.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface GraphNode {
  id: string;
  text: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

const KIND_COLOR: Record<string, string> = {
  fact: "#34d399",
  lesson: "#34d399",
  plan: "#fbbf24",
  goal: "#67e8f9",
  intention: "#a78bfa",
  log: "#94a3b8",
};

export function MemoryNetwork(): React.ReactElement {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [health, setHealth] = useState<{ nodes: number; edges: number; cache_hits: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<string[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const rafRef = useRef(0);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/alpha/aether?endpoint=graph");
      const data = (await res.json()) as {
        ok?: boolean;
        offline?: boolean;
        nodes?: { id: string; text: string; kind?: string }[];
        edges?: GraphEdge[];
      };
      if (data.offline) {
        setOffline(true);
        return;
      }
      setOffline(false);
      const incoming = data.nodes ?? [];
      setNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.id, n]));
        const w = containerRef.current?.clientWidth ?? 600;
        const h = containerRef.current?.clientHeight ?? 400;
        const merged = incoming.map((n, i) => {
          const existing = prevMap.get(n.id);
          return existing ?? {
            id: n.id,
            text: n.text,
            kind: n.kind,
            x: w / 2 + Math.cos((i / Math.max(incoming.length, 1)) * Math.PI * 2) * 120,
            y: h / 2 + Math.sin((i / Math.max(incoming.length, 1)) * Math.PI * 2) * 120,
            vx: 0,
            vy: 0,
          };
        });
        nodesRef.current = merged;
        return merged;
      });
      setEdges(data.edges ?? []);
    } catch {
      setOffline(true);
    }
    try {
      const res = await fetch("/api/alpha/aether?endpoint=health");
      const data = (await res.json()) as { nodes?: number; edges?: number; cache_hits?: number };
      setHealth({ nodes: data.nodes ?? 0, edges: data.edges ?? 0, cache_hits: data.cache_hits ?? 0 });
    } catch {
      /* health optional */
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchGraph());
    const timer = window.setInterval(fetchGraph, 4000);
    return () => window.clearInterval(timer);
  }, [fetchGraph]);

  // force-directed relaxation
  useEffect(() => {
    const step = () => {
      const ns = nodesRef.current;
      const w = containerRef.current?.clientWidth ?? 600;
      const h = containerRef.current?.clientHeight ?? 400;
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x;
          const dy = ns[j].y - ns[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const repulse = 2400 / (dist * dist);
          ns[i].vx -= (dx / dist) * repulse * 0.01;
          ns[i].vy -= (dy / dist) * repulse * 0.01;
          ns[j].vx += (dx / dist) * repulse * 0.01;
          ns[j].vy += (dy / dist) * repulse * 0.01;
        }
        ns[i].vx += (w / 2 - ns[i].x) * 0.0008;
        ns[i].vy += (h / 2 - ns[i].y) * 0.0008;
      }
      for (const edge of edges) {
        const a = ns.find((n) => n.id === edge.from);
        const b = ns.find((n) => n.id === edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const target = 110;
        const pull = (dist - target) * 0.002 * Math.max(edge.weight, 0.2);
        a.vx += (dx / dist) * pull;
        a.vy += (dy / dist) * pull;
        b.vx -= (dx / dist) * pull;
        b.vy -= (dy / dist) * pull;
      }
      for (const n of ns) {
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x = Math.min(Math.max(n.x + n.vx, 30), w - 30);
        n.y = Math.min(Math.max(n.y + n.vy, 30), h - 30);
      }
      setNodes([...ns]);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [edges]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchHits([]);
      return;
    }
    try {
      const res = await fetch("/api/alpha/aether?endpoint=graph/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, limit: 5 }),
      });
      const data = (await res.json()) as { results?: { id: string }[] };
      setSearchHits((data.results ?? []).map((r) => r.id));
    } catch {
      setSearchHits([]);
    }
  }, [query]);

  const positions = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2" data-ai-skip>
        <Activity className={cn("h-3.5 w-3.5", offline ? "text-(--ae-rose)" : "text-(--ae-emerald)")} />
        <span className="font-mono-ae text-[10px] text-zinc-400">
          {offline ? "aether offline — the OS runs without it" : `${health?.nodes ?? nodes.length} nodes · ${health?.edges ?? edges.length} edges · ${health?.cache_hits ?? 0} cache hits`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            placeholder="semantic search…"
            className="font-mono-ae w-40 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-(--ae-cyan)/40"
          />
          <button type="button" onClick={() => void runSearch()} className="rounded-md border border-white/10 p-1 text-zinc-400 hover:text-(--ae-cyan)">
            <Search className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1">
        <svg className="absolute inset-0 h-full w-full">
          {edges.map((edge, i) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            return (
              <line
                key={`e-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(167,139,250,0.8)"
                strokeWidth={1}
                opacity={Math.max(edge.weight, 0.08) * 0.6}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const color = KIND_COLOR[node.kind ?? ""] ?? "#94a3b8";
          const highlighted = searchHits.includes(node.id);
          return (
            <motion.button
              key={node.id}
              type="button"
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border",
                highlighted ? "border-(--ae-gold)" : "border-transparent"
              )}
              style={{ left: node.x, top: node.y }}
              onClick={() => setSelected(node)}
              whileHover={{ scale: 1.4 }}
              title={node.text}
            >
              <span
                className="block h-2.5 w-2.5 rounded-full"
                style={{ background: color, boxShadow: `0 0 10px ${color}` }}
              />
            </motion.button>
          );
        })}
        {nodes.length === 0 && !offline && (
          <div className="font-mono-ae absolute inset-0 flex items-center justify-center text-[11px] text-zinc-600">
            graph empty — the AI feeds it as it learns
          </div>
        )}
      </div>

      {selected && (
        <div className="glass border-t border-white/10 p-3 text-[11px]">
          <div className="flex items-baseline justify-between">
            <span className="font-mono-ae font-semibold" style={{ color: KIND_COLOR[selected.kind ?? ""] ?? "#94a3b8" }}>
              [{selected.kind ?? "node"}]
            </span>
            <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          <p className="font-mono-ae mt-1 text-zinc-300">{selected.text}</p>
        </div>
      )}
    </div>
  );
}

export default MemoryNetwork;
