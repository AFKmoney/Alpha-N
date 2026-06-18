/**
 * evolution-graph.tsx — full-screen interactive graph of every mutation the
 * AI has applied to itself over time.
 *
 * Each mutation is rendered as a circular SVG node, colored by category:
 *   code_change  → emerald  (oklch 0.7 0.18 145)
 *   ui_tweak     → amber    (oklch 0.85 0.16 85)
 *   behavior     → teal     (oklch 0.82 0.17 195)
 *   security     → red      (oklch 0.65 0.24 25)
 * Edges connect sequential mutations in chronological order. Hovering a node
 * shows a tooltip with the mutation's kind, description, timestamp, and reward
 * delta. Zoom with the mouse wheel, pan by dragging. If no mutations exist,
 * shows a helpful empty state.
 *
 * This component is intended to replace `evolution-tree.tsx` when wired in —
 * but it does not edit that file. The internal store `useEvolutionGraph`
 * controls the open/closed state so any component (e.g. a button on the
 * timeline header) can open the overlay.
 */
"use client";

import { create } from "zustand";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  Maximize2,
  Minimize2,
  TrendingDown,
  TrendingUp,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useMounted } from "@/lib/alpha/use-mounted";
import type { AppliedMutation, MutationRewardEntry } from "@/lib/alpha/mutations";
import { cn } from "@/lib/utils";

// ---- Internal store ----
interface EvolutionGraphStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useEvolutionGraph = create<EvolutionGraphStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

// ---- Mutation categories ----
type GraphCategory = "code_change" | "ui_tweak" | "behavior" | "security";

interface CategoryConfig {
  color: string; // hex/oklch for SVG fill
  label: string;
  dot: string; // tailwind for HTML badges
}

const CATEGORY_CONFIG: Record<GraphCategory, CategoryConfig> = {
  code_change: {
    color: "oklch(0.7 0.18 145)",
    label: "Code",
    dot: "bg-[oklch(0.7_0.18_145)]",
  },
  ui_tweak: {
    color: "oklch(0.85 0.16 85)",
    label: "UI",
    dot: "bg-[oklch(0.85_0.16_85)]",
  },
  behavior: {
    color: "oklch(0.82 0.17 195)",
    label: "Behavior",
    dot: "bg-[oklch(0.82_0.17_195)]",
  },
  security: {
    color: "oklch(0.65 0.24 25)",
    label: "Security",
    dot: "bg-[oklch(0.65_0.24_25)]",
  },
};

// Classify a mutation `kind` string into one of the 4 graph categories.
function classifyKind(kind: string): GraphCategory {
  const codeKinds = new Set([
    "replace_code",
    "insert_code",
    "commit_evolution",
    "read_file",
    "write_file",
    "execute_code",
    "compile",
  ]);
  const uiKinds = new Set([
    "create_app",
    "close_app",
    "focus_app",
    "move_window",
  ]);
  const securityKinds = new Set(["rollback"]);
  if (codeKinds.has(kind)) return "code_change";
  if (uiKinds.has(kind)) return "ui_tweak";
  if (securityKinds.has(kind)) return "security";
  return "behavior";
}

// ---- Node layout ----
interface GraphNode {
  id: string;
  mutation: AppliedMutation;
  category: GraphCategory;
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SVG_W = 1600;
const SVG_H = 900;
const LANE_Y: Record<GraphCategory, number> = {
  code_change: 180,
  ui_tweak: 360,
  behavior: 540,
  security: 720,
};
const NODE_R = 14;
const COL_W = 70;

function buildGraph(mutations: AppliedMutation[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  // The store keeps mutations newest-first; reverse for chronological layout.
  const chrono = [...mutations].reverse();
  const nodes: GraphNode[] = chrono.map((m, i) => {
    const category = classifyKind(m.kind);
    return {
      id: m.id,
      mutation: m,
      category,
      x: 80 + i * COL_W,
      y: LANE_Y[category],
    };
  });
  const edges: GraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: nodes[i - 1].id, to: nodes[i].id });
  }
  return { nodes, edges };
}

function findReward(
  rewards: MutationRewardEntry[],
  mutation: AppliedMutation
): MutationRewardEntry | undefined {
  return rewards.find(
    (r) => r.kind === mutation.kind && r.description === mutation.description
  );
}

/**
 * EvolutionGraph — the full-screen SVG visualization. Mount once near the
 * OS root. Open via `useEvolutionGraph.getState().setOpen(true)`.
 */
export function EvolutionGraph() {
  const open = useEvolutionGraph((s) => s.open);
  const setOpen = useEvolutionGraph((s) => s.setOpen);

  const mutationStream = useEvolution((s) => s.mutationStream);
  const rewardModel = useEvolution((s) => s.rewardModel);
  const mounted = useMounted();

  const [hover, setHover] = useState<{ node: GraphNode; rx: number; ry: number } | null>(null);
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, w: SVG_W, h: SVG_H });
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  // Listen for open event so any component can open the graph.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("alpha-evolution-graph-open", onOpen);
    return () => window.removeEventListener("alpha-evolution-graph-open", onOpen);
  }, [setOpen]);

  // Reset view when opening.
  useEffect(() => {
    if (open) {
      Promise.resolve().then(() => {
        setView({ x: 0, y: 0, w: SVG_W, h: SVG_H });
        setHover(null);
      });
    }
  }, [open]);

  const { nodes, edges } = useMemo(
    () => buildGraph(mutationStream),
    [mutationStream]
  );

  // ---- Zoom & pan handlers ----
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const newW = Math.max(200, Math.min(SVG_W * 4, view.w * factor));
    const newH = Math.max(120, Math.min(SVG_H * 4, view.h * factor));
    // Zoom toward the cursor — keep the point under the cursor stable.
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * view.w + view.x;
    const cy = ((e.clientY - rect.top) / rect.height) * view.h + view.y;
    const nx = cx - ((cx - view.x) * newW) / view.w;
    const ny = cy - ((cy - view.y) * newH) / view.h;
    setView({ x: nx, y: ny, w: newW, h: newH });
  };

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: view.x,
      vy: view.y,
    };
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * view.w;
    const dy = ((e.clientY - dragRef.current.startY) / rect.height) * view.h;
    setView((v) => ({ ...v, x: dragRef.current!.vx - dx, y: dragRef.current!.vy - dy }));
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    const newW = Math.max(200, Math.min(SVG_W * 4, view.w * factor));
    const newH = Math.max(120, Math.min(SVG_H * 4, view.h * factor));
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    setView({
      x: cx - newW / 2,
      y: cy - newH / 2,
      w: newW,
      h: newH,
    });
  };

  const resetView = () => setView({ x: 0, y: 0, w: SVG_W, h: SVG_H });

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl"
          data-ai-skip="true"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
              <div>
                <h2 className="font-mono-ae text-sm font-semibold text-foreground">
                  Evolution Graph
                </h2>
                <p className="eyebrow">
                  {nodes.length} mutation{nodes.length === 1 ? "" : "s"} · {edges.length} edge{edges.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {/* Legend */}
            <div className="hidden items-center gap-3 md:flex">
              {(Object.keys(CATEGORY_CONFIG) as GraphCategory[]).map((cat) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: CATEGORY_CONFIG[cat].color }}
                  />
                  <span className="font-mono-ae text-[0.62rem] text-muted-foreground">
                    {CATEGORY_CONFIG[cat].label}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => zoomBy(0.8)}
                className="rounded-md border border-border/60 bg-card/40 p-1.5 text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground"
                title="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => zoomBy(1.25)}
                className="rounded-md border border-border/60 bg-card/40 p-1.5 text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground"
                title="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={resetView}
                className="rounded-md border border-border/60 bg-card/40 p-1.5 text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground"
                title="Reset view"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="ml-1 rounded-md p-1.5 text-muted-foreground transition-all hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Graph canvas */}
          <div className="relative flex-1 overflow-hidden">
            {nodes.length === 0 ? (
              <EmptyState />
            ) : (
              <svg
                className="h-full w-full cursor-grab active:cursor-grabbing"
                viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                onWheel={onWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              >
                {/* Lane separators + labels */}
                {(Object.keys(LANE_Y) as GraphCategory[]).map((cat) => (
                  <g key={cat}>
                    <line
                      x1={0}
                      y1={LANE_Y[cat]}
                      x2={SVG_W}
                      y2={LANE_Y[cat]}
                      stroke="oklch(0.5 0 0 / 0.12)"
                      strokeDasharray="4 6"
                    />
                    <text
                      x={12}
                      y={LANE_Y[cat] - 18}
                      fill={CATEGORY_CONFIG[cat].color}
                      fontSize={11}
                      fontFamily="var(--font-mono-ae, monospace)"
                      opacity={0.7}
                    >
                      {CATEGORY_CONFIG[cat].label}
                    </text>
                  </g>
                ))}

                {/* Edges */}
                {edges.map((edge, i) => {
                  const from = nodes.find((n) => n.id === edge.from);
                  const to = nodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  // Curve the edge between lanes using a cubic bezier.
                  const midY = (from.y + to.y) / 2;
                  return (
                    <path
                      key={`edge-${i}`}
                      d={`M ${from.x} ${from.y} C ${from.x + COL_W / 2} ${midY}, ${to.x - COL_W / 2} ${midY}, ${to.x} ${to.y}`}
                      fill="none"
                      stroke="oklch(0.5 0 0 / 0.25)"
                      strokeWidth={1.5}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map((node) => {
                  const cfg = CATEGORY_CONFIG[node.category];
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      onMouseEnter={(e) => {
                        const rect = (
                          e.currentTarget.ownerSVGElement as SVGSVGElement
                        ).getBoundingClientRect();
                        setHover({
                          node,
                          rx: e.clientX - rect.left,
                          ry: e.clientY - rect.top,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Glow ring */}
                      <circle
                        r={NODE_R + 4}
                        fill={cfg.color}
                        opacity={0.18}
                      />
                      {/* Core node */}
                      <circle
                        r={NODE_R}
                        fill={cfg.color}
                        stroke="oklch(0.2 0 0 / 0.7)"
                        strokeWidth={1.5}
                      />
                      {/* Inner dot for visual interest */}
                      <circle r={3} fill="oklch(0.95 0 0 / 0.85)" />
                    </g>
                  );
                })}
              </svg>
            )}

            {/* Hover tooltip */}
            {hover && (
              <div
                className="glass-strong pointer-events-none absolute z-10 w-64 rounded-xl border border-border/60 p-3 shadow-xl"
                style={{
                  left: Math.min(hover.rx + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 280),
                  top: Math.min(hover.ry + 12, (typeof window !== "undefined" ? window.innerHeight : 720) - 200),
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: CATEGORY_CONFIG[hover.node.category].color }}
                  />
                  <span className="font-mono-ae text-xs font-semibold text-foreground">
                    {hover.node.mutation.kind}
                  </span>
                  <span className="ml-auto eyebrow">
                    {CATEGORY_CONFIG[hover.node.category].label}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-snug text-foreground/85">
                  {hover.node.mutation.description}
                </p>
                <div className="mt-2 flex items-center justify-between font-mono-ae text-[0.6rem] text-muted-foreground">
                  <span>{mounted ? new Date(hover.node.mutation.time).toLocaleTimeString() : "—"}</span>
                  <RewardBadge
                    reward={findReward(rewardModel, hover.node.mutation)}
                  />
                </div>
              </div>
            )}

            {/* Zoom indicator */}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border/40 bg-card/60 px-2 py-1 font-mono-ae text-[0.6rem] text-muted-foreground">
              zoom {((SVG_W / view.w) * 100).toFixed(0)}% · drag to pan · scroll to zoom
            </div>
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between border-t border-border/60 px-5 py-2 text-[0.62rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Minimize2 className="h-3 w-3" />
              <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">Esc</kbd>
              to close
            </span>
            <span className="font-mono-ae">alpha-n · evolution graph</span>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- Sub-components ----
function RewardBadge({ reward }: { reward?: MutationRewardEntry }) {
  if (!reward) return <span>no reward data</span>;
  const positive = reward.delta >= 0;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5",
        positive ? "text-[oklch(0.7_0.18_145)]" : "text-[oklch(0.65_0.24_25)]"
      )}
    >
      {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {reward.delta >= 0 ? "+" : ""}
      {(reward.delta * 100).toFixed(1)}%
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <motion.div
        animate={{ rotate: [0, 8, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/40 bg-card/40"
      >
        <GitBranch className="h-7 w-7 text-[oklch(0.82_0.17_195)]" />
      </motion.div>
      <div>
        <h3 className="font-mono-ae text-sm font-semibold text-foreground">
          No mutations yet
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Trigger an evolution cycle (the <span className="font-mono-ae text-[oklch(0.85_0.16_85)]">evolve</span> button
          in the sidebar or <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">Cmd+↵</kbd>)
          to make the AI rewrite itself. Every mutation will appear here as a node
          in the graph, colored by its category.
        </p>
      </div>
    </div>
  );
}
