/**
 * evolution-graph.tsx — full-screen mutation stream visualization.
 *
 * Every applied mutation becomes a node placed in one of four semantic
 * lanes (code_change / ui_tweak / behavior / security — plus an "other"
 * lane only when unknown kinds appear). Consecutive mutations are joined
 * by curved cubic-bezier edges so the stream reads as a left-to-right
 * timeline (the store keeps it newest-first; this view reverses it).
 *
 * Interactions: wheel zooms around the cursor, drag pans, buttons zoom /
 * reset, hovering a node shows a tooltip with its kind, description,
 * time and the reward-model delta for that exact mutation. Opens via
 * `alpha-evolution-graph-open`, closes with Esc.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { GitBranch, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { AppliedMutation, MutationRewardEntry } from "@/lib/alpha/mutations";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface GraphState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const useGraphStore = create<GraphState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

// ---------------------------------------------------------------------------
// Classification — mutation kind → lane + oklch accent
// ---------------------------------------------------------------------------

type GraphCategory = "code_change" | "ui_tweak" | "behavior" | "security" | "other";

interface CategoryStyle {
  lane: number;
  color: string;
  label: string;
}

const CATEGORY_STYLES: Record<GraphCategory, CategoryStyle> = {
  code_change: { lane: 0, color: "var(--ae-emerald)", label: "Code change" },
  ui_tweak: { lane: 1, color: "var(--ae-gold)", label: "UI tweak" },
  behavior: { lane: 2, color: "var(--ae-cyan)", label: "Behavior" },
  security: { lane: 3, color: "var(--ae-rose)", label: "Security" },
  other: { lane: 4, color: "oklch(0.65 0.02 280)", label: "Other" },
};

const EXACT_KINDS: Record<string, GraphCategory> = {
  // code_change
  replace_code: "code_change",
  insert_code: "code_change",
  write_file: "code_change",
  create_app_from_code: "code_change",
  commit_evolution: "code_change",
  // ui_tweak
  set_theme: "ui_tweak",
  set_wallpaper: "ui_tweak",
  snap_window: "ui_tweak",
  move_window: "ui_tweak",
  create_app: "ui_tweak",
  minimize_all: "ui_tweak",
  // behavior
  set_agent: "behavior",
  set_state: "behavior",
  speak: "behavior",
  add_log: "behavior",
  set_system_prompt: "behavior",
  web_search: "behavior",
  run_terminal: "behavior",
  // security
  rollback: "security",
  delete_file: "security",
  compile: "security",
  execute_code: "security",
  debate: "security",
};

const PREFIX_KINDS: [string, GraphCategory][] = [
  ["pin", "ui_tweak"],
  ["set_autonomy", "behavior"],
];

export function classifyKind(kind: string): GraphCategory {
  const exact = EXACT_KINDS[kind];
  if (exact) return exact;
  for (const [prefix, cat] of PREFIX_KINDS) {
    if (kind.startsWith(prefix)) return cat;
  }
  return "other";
}

/** Accent color for a category — zinc tone for kinds outside the four named ones. */
function categoryColor(cat: GraphCategory): string {
  return CATEGORY_STYLES[cat].color;
}

/** Lane index → category (used for band labels). */
const LANES: GraphCategory[] = ["code_change", "ui_tweak", "behavior", "security"];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const LANE_H = 88;
const TOP_PAD = 34;
const X0 = 48;
const COL_W = 70;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface GraphNode extends AppliedMutation {
  cat: GraphCategory;
  x: number;
  y: number;
  reward: MutationRewardEntry | null;
}

function rewardDeltaLabel(entry: MutationRewardEntry): string {
  const sign = entry.delta >= 0 ? "+" : "";
  return `${sign}${entry.delta.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvolutionGraph(): React.ReactElement {
  const open = useGraphStore((s) => s.open);
  const setOpen = useGraphStore((s) => s.setOpen);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 560 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);

  const mutationStream = useEvolution((s) => s.mutationStream);
  const rewardModel = useEvolution((s) => s.rewardModel);

  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setTransform({ x: 0, y: 0, k: 1 });
      setHovered(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useGraphStore.getState().open) setOpen(false);
    };
    window.addEventListener("alpha-evolution-graph-open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("alpha-evolution-graph-open", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [setOpen]);

  // Chronological order — the store keeps the stream newest-first.
  const nodes: GraphNode[] = useMemo(() => {
    const chrono = [...mutationStream].reverse();
    return chrono.map((m, i) => {
      const cat = classifyKind(m.kind);
      const lane = CATEGORY_STYLES[cat].lane;
      const reward = rewardModel.find((r) => r.kind === m.kind && r.description === m.description) ?? null;
      return {
        ...m,
        cat,
        x: X0 + i * COL_W,
        y: TOP_PAD + lane * LANE_H + 30,
        reward,
      };
    });
  }, [mutationStream, rewardModel]);

  const contentWidth = X0 + nodes.length * COL_W + 120;

  // Track the canvas size so the tooltip can clamp itself during render
  // without ever reading the ref outside of effects.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, portal]);

  // Non-passive wheel zoom anchored at the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.k * factor));
        const wx = (cx - t.x) / t.k;
        const wy = (cy - t.y) / t.k;
        return { k, x: cx - wx * k, y: cy - wy * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, portal]);

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setTransform((t) => {
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.k * factor));
      const wx = (cx - t.x) / t.k;
      const wy = (cy - t.y) / t.k;
      return { k, x: cx - wx * k, y: cy - wy * k };
    });
  };

  const resetView = () => setTransform({ x: 0, y: 0, k: 1 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panRef.current = { px: e.clientX, py: e.clientY, tx: transform.x, ty: transform.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = panRef.current;
    if (!start) return;
    setTransform((t) => ({
      ...t,
      x: start.tx + (e.clientX - start.px),
      y: start.ty + (e.clientY - start.py),
    }));
  };

  const onPointerUp = () => {
    panRef.current = null;
  };

  const hoveredNode = nodes.find((n) => n.id === hovered) ?? null;
  // Screen-space position of the hovered node (for the tooltip div).
  const hoveredScreen = hoveredNode
    ? { x: transform.x + hoveredNode.x * transform.k, y: transform.y + hoveredNode.y * transform.k }
    : null;

  const presentCategories = useMemo(() => {
    const cats = new Set<GraphCategory>();
    nodes.forEach((n) => cats.add(n.cat));
    return cats;
  }, [nodes]);

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="evolution-graph"
          className="fixed inset-0 z-[9400] flex items-center justify-center bg-black/70 p-5 backdrop-blur-[4px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="glass-strong font-mono-ae flex h-[88vh] w-[min(1200px,94vw)] flex-col overflow-hidden rounded-2xl border-[--ae-cyan]/20 shadow-2xl"
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
          >
            {/* header */}
            <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
              <GitBranch className="h-4 w-4 text-[--ae-cyan]" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-100">Evolution Graph</p>
                <p className="eyebrow mt-0.5">{nodes.length} mutations · scroll to zoom · drag to pan</p>
              </div>
              {/* legend */}
              <div className="mr-2 hidden items-center gap-3 md:flex">
                {(Object.keys(CATEGORY_STYLES) as GraphCategory[])
                  .filter((c) => c !== "other" || presentCategories.has("other"))
                  .map((c) => (
                    <span key={c} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: categoryColor(c) }}
                      />
                      {CATEGORY_STYLES[c].label}
                    </span>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => zoomBy(1.25)}
                className="rounded-md border border-white/10 p-1.5 text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
                aria-label="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(0.8)}
                className="rounded-md border border-white/10 p-1.5 text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
                aria-label="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={resetView}
                className="rounded-md border border-white/10 p-1.5 text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100"
                aria-label="Reset view"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                aria-label="Close evolution graph"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* canvas */}
            <div
              ref={containerRef}
              className="relative flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {nodes.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <GitBranch className="h-10 w-10 text-zinc-700" />
                  <p className="eyebrow">no mutations yet</p>
                  <p className="max-w-[300px] text-xs text-zinc-500">
                    Once the AI starts acting, every mutation appears here as a node in its semantic lane.
                  </p>
                </div>
              ) : (
                <svg className="h-full w-full select-none" role="img" aria-label="Mutation stream graph">
                  <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                    {/* lane bands */}
                    {LANES.map((laneCat, lane) => (
                      <g key={`lane-${lane}`}>
                        <rect
                          x={-4000}
                          y={TOP_PAD + lane * LANE_H}
                          width={contentWidth + 8000}
                          height={LANE_H - 14}
                          fill="rgba(255,255,255,0.018)"
                          stroke="rgba(255,255,255,0.06)"
                        />
                        <text
                          x={10}
                          y={TOP_PAD + lane * LANE_H + 16}
                          fontSize={9}
                          letterSpacing={2}
                          style={{ fill: "oklch(0.62 0.02 280)", textTransform: "uppercase" }}
                        >
                          {CATEGORY_STYLES[laneCat].label.toUpperCase()}
                        </text>
                      </g>
                    ))}

                    {/* edges between consecutive mutations */}
                    {nodes.slice(1).map((n, i) => {
                      const prev = nodes[i];
                      return (
                        <path
                          key={`edge-${prev.id}-${n.id}`}
                          d={`M ${prev.x + 9} ${prev.y} C ${prev.x + 9 + 34} ${prev.y}, ${n.x - 9 - 34} ${n.y}, ${n.x - 9} ${n.y}`}
                          fill="none"
                          stroke={categoryColor(n.cat)}
                          strokeOpacity={0.28}
                          strokeWidth={1.4}
                        />
                      );
                    })}

                    {/* nodes */}
                    {nodes.map((n) => {
                      const color = categoryColor(n.cat);
                      const isHovered = n.id === hovered;
                      return (
                        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                          <circle
                            r={isHovered ? 16 : 14}
                            fill="transparent"
                            onPointerEnter={() => setHovered(n.id)}
                            onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                            style={{ cursor: "pointer" }}
                          />
                          <circle r={7} fill="oklch(0.13 0.02 280)" stroke={color} strokeWidth={2} />
                          <circle r={2.4} fill={color} />
                          {isHovered && (
                            <circle r={11} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1} />
                          )}
                          <text
                            y={22}
                            textAnchor="middle"
                            fontSize={7.5}
                            style={{ fill: "oklch(0.7 0.02 280)", fontFamily: "var(--ae-font-mono)" }}
                          >
                            {n.kind.length > 12 ? `${n.kind.slice(0, 11)}…` : n.kind}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}

              {/* hover tooltip */}
              {hoveredNode && hoveredScreen && nodes.length > 0 && (
                <div
                  className="glass-strong pointer-events-none absolute z-10 w-[260px] rounded-xl border-white/12 p-3 text-xs shadow-2xl"
                  style={{
                    left: Math.max(8, Math.min(hoveredScreen.x + 14, canvasSize.w - 276)),
                    top: Math.max(8, hoveredScreen.y - 84),
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(hoveredNode.cat) }} />
                    <span className="truncate text-[11px] font-semibold text-zinc-100">{hoveredNode.kind}</span>
                    {hoveredNode.reward && (
                      <span
                        className={cn(
                          "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold",
                          hoveredNode.reward.delta >= 0
                            ? "bg-[--ae-emerald]/15 text-[--ae-emerald]"
                            : "bg-[--ae-rose]/15 text-[--ae-rose]"
                        )}
                      >
                        {rewardDeltaLabel(hoveredNode.reward)} {hoveredNode.reward.helpful ? "↑" : "↓"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-zinc-300">
                    {hoveredNode.description}
                  </p>
                  <p className="mt-1.5 text-[9px] text-zinc-500">{new Date(hoveredNode.time).toLocaleString()}</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portal
  );
}

export default EvolutionGraph;
