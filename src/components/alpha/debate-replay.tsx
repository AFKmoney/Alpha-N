/**
 * debate-replay.tsx — modal overlay that lets the user replay past AI council
 * debates step by step.
 *
 * Reads from `useEvolution(state => state.debateResults)` as the primary
 * source. Because that store caps at the 5 most recent debates, this component
 * also persists every seen debate to localStorage (`alpha-n:debates`) so older
 * debates remain replayable across reloads. On mount, hydrates from localStorage
 * (microtask-deferred to satisfy the lint rule).
 *
 * For the selected debate, shows the topic, 4 agent panels (Architect,
 * Developer, Auditor, Optimizer), a Play button that reveals each agent's
 * argument one at a time (2-second delay between each), and the final
 * verdict/consensus. If no past debates exist, shows a helpful empty state.
 *
 * The internal store `useDebateReplay` controls open/close state. Also listens
 * for the `alpha-debate-replay-open` window event so any component can open it.
 */
"use client";

import { create } from "zustand";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  Pause,
  Play,
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useMounted } from "@/lib/alpha/use-mounted";
import type { AgentOpinion, DebateResult } from "@/lib/alpha/mutations";
import { cn } from "@/lib/utils";

// ---- Internal store ----
interface DebateReplayStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useDebateReplay = create<DebateReplayStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

// ---- Agent metadata ----
interface AgentMeta {
  role: string;
  name: string;
  glyph: string;
  color: string;
}

const AGENTS: AgentMeta[] = [
  { role: "architect", name: "Architect", glyph: "⌬", color: "text-[oklch(0.74_0.22_300)]" },
  { role: "developer", name: "Developer", glyph: "⌥", color: "text-[oklch(0.82_0.17_195)]" },
  { role: "critic", name: "Auditor", glyph: "✕", color: "text-[oklch(0.65_0.24_25)]" },
  { role: "optimizer", name: "Optimizer", glyph: "✦", color: "text-[oklch(0.85_0.16_85)]" },
];

function agentMeta(role: string): AgentMeta {
  return AGENTS.find((a) => a.role === role) ?? {
    role,
    name: role,
    glyph: "?",
    color: "text-muted-foreground",
  };
}

const VERDICT_STYLE: Record<AgentOpinion["verdict"], { color: string; icon: typeof ThumbsUp; label: string }> = {
  PROCEED: { color: "text-[oklch(0.7_0.18_145)]", icon: ThumbsUp, label: "Proceed" },
  REVISE: { color: "text-[oklch(0.85_0.16_85)]", icon: CheckCircle2, label: "Revise" },
  REJECT: { color: "text-[oklch(0.65_0.24_25)]", icon: ThumbsDown, label: "Reject" },
};

const STORAGE_KEY = "alpha-n:debates";

function loadStoredDebates(): DebateResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DebateResult[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveStoredDebates(debates: DebateResult[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(debates.slice(0, 50)));
  } catch {
    // Storage full or unavailable — silently skip.
  }
}

function relativeTime(ts: number, mounted: boolean): string {
  if (!mounted) return "—";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * DebateReplay — the modal overlay. Mount once near the OS root.
 */
export function DebateReplay() {
  const open = useDebateReplay((s) => s.open);
  const setOpen = useDebateReplay((s) => s.setOpen);
  const liveDebates = useEvolution((s) => s.debateResults);
  const mounted = useMounted();

  // Persisted debates (older than the store's 5-item cap).
  const [stored, setStored] = useState<DebateResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Hydrate from localStorage on mount — microtask-deferred.
  useEffect(() => {
    Promise.resolve().then(() => {
      setStored(loadStoredDebates());
    });
  }, []);

  // Whenever live debates change, merge new ones into `stored` and persist.
  useEffect(() => {
    if (liveDebates.length === 0) return;
    Promise.resolve().then(() => {
      setStored((prev) => {
        const existing = new Set(prev.map((d) => `${d.time}-${d.proposal.slice(0, 60)}`));
        const merged = [...prev];
        for (const d of liveDebates) {
          const key = `${d.time}-${d.proposal.slice(0, 60)}`;
          if (!existing.has(key)) {
            merged.unshift(d);
            existing.add(key);
          }
        }
        const trimmed = merged.slice(0, 50);
        saveStoredDebates(trimmed);
        return trimmed;
      });
    });
  }, [liveDebates]);

  // Listen for open event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("alpha-debate-replay-open", onOpen);
    return () => window.removeEventListener("alpha-debate-replay-open", onOpen);
  }, [setOpen]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Reset playback when the selected debate changes.
  useEffect(() => {
    Promise.resolve().then(() => {
      setRevealedCount(0);
      setPlaying(false);
    });
  }, [selectedId]);

  // Auto-advance playback — reveals one more agent every 2 seconds.
  useEffect(() => {
    if (!playing) return;
    const selected = stored.find((d) => `${d.time}-${d.proposal.slice(0, 60)}` === selectedId);
    if (!selected || revealedCount >= selected.opinions.length) {
      // Defer the stop so we don't synchronously setState inside the effect.
      Promise.resolve().then(() => setPlaying(false));
      return;
    }
    const timer = setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [playing, revealedCount, selectedId, stored]);

  // Pick the most recent debate by default when opening.
  useEffect(() => {
    if (open && stored.length > 0 && !selectedId) {
      const latest = stored[0];
      Promise.resolve().then(() => {
        setSelectedId(`${latest.time}-${latest.proposal.slice(0, 60)}`);
      });
    }
  }, [open, stored, selectedId]);

  const selected = useMemo(
    () =>
      stored.find(
        (d) => `${d.time}-${d.proposal.slice(0, 60)}` === selectedId
      ) ?? null,
    [stored, selectedId]
  );

  const revealAll = () => {
    if (!selected) return;
    setRevealedCount(selected.opinions.length);
    setPlaying(false);
  };

  const togglePlay = () => {
    if (!selected) return;
    if (revealedCount >= selected.opinions.length) {
      // Restart from the beginning.
      setRevealedCount(0);
      Promise.resolve().then(() => setPlaying(true));
    } else {
      setPlaying((p) => !p);
    }
  };

  const stepForward = () => {
    if (!selected) return;
    setRevealedCount((c) => Math.min(c + 1, selected.opinions.length));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          data-ai-skip="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="glass-strong flex h-[80vh] w-[92vw] max-w-5xl overflow-hidden rounded-2xl border border-border/60 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar — debate list */}
            <aside className="flex w-60 shrink-0 flex-col border-r border-border/60 bg-card/30">
              <div className="border-b border-border/60 px-4 py-3">
                <h2 className="font-mono-ae text-xs font-semibold uppercase tracking-wider text-foreground">
                  Past Debates
                </h2>
                <p className="eyebrow mt-0.5">{stored.length} recorded</p>
              </div>
              <div className="scroll-ae flex-1 overflow-y-auto p-2">
                {stored.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No debates yet
                  </div>
                ) : (
                  stored.map((d) => {
                    const key = `${d.time}-${d.proposal.slice(0, 60)}`;
                    const isSel = key === selectedId;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedId(key)}
                        className={cn(
                          "mb-1 w-full rounded-lg border px-3 py-2 text-left transition-all",
                          isSel
                            ? "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/[0.08]"
                            : "border-border/40 bg-card/30 hover:bg-card/50"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              d.consensus === "PROCEED"
                                ? "bg-[oklch(0.7_0.18_145)]"
                                : d.consensus === "REVISE"
                                  ? "bg-[oklch(0.85_0.16_85)]"
                                  : "bg-[oklch(0.65_0.24_25)]"
                            )}
                          />
                          <span className="truncate font-mono-ae text-[0.7rem] text-foreground/90">
                            {d.proposal.slice(0, 32)}
                          </span>
                        </div>
                        <div className="mt-1 font-mono-ae text-[0.55rem] text-muted-foreground">
                          {relativeTime(d.time, mounted)} · {d.opinions.length} agents
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Main panel — selected debate */}
            <div className="flex min-w-0 flex-1 flex-col">
              {selected ? (
                <>
                  {/* Header */}
                  <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-[oklch(0.74_0.22_300)]" />
                        <h3 className="font-mono-ae text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Debate Topic
                        </h3>
                      </div>
                      <p className="mt-1.5 text-sm leading-snug text-foreground">
                        {selected.proposal}
                      </p>
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-all hover:bg-foreground/[0.06] hover:text-foreground"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </header>

                  {/* Agent panels */}
                  <div className="scroll-ae flex-1 overflow-y-auto p-5">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {selected.opinions.map((op, i) => {
                        const meta = agentMeta(op.agent);
                        const vcfg = VERDICT_STYLE[op.verdict];
                        const VIcon = vcfg.icon;
                        const revealed = i < revealedCount;
                        return (
                          <motion.div
                            key={`${op.agent}-${i}`}
                            initial={false}
                            animate={{ opacity: revealed ? 1 : 0.35 }}
                            className={cn(
                              "rounded-xl border p-4 transition-all",
                              revealed
                                ? "border-border/60 bg-card/40"
                                : "border-dashed border-border/40 bg-card/20"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={cn("font-mono-ae text-base", meta.color)}>
                                  {meta.glyph}
                                </span>
                                <div>
                                  <div className={cn("font-mono-ae text-xs font-semibold", meta.color)}>
                                    {meta.name}
                                  </div>
                                  <div className="eyebrow">council</div>
                                </div>
                              </div>
                              {revealed ? (
                                <span className={cn("flex items-center gap-1 text-[0.6rem]", vcfg.color)}>
                                  <VIcon className="h-3 w-3" />
                                  <span className="font-mono-ae">{vcfg.label}</span>
                                </span>
                              ) : (
                                <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
                                  hidden
                                </span>
                              )}
                            </div>
                            {revealed ? (
                              <p className="mt-2 text-xs leading-relaxed text-foreground/85">
                                {op.opinion}
                              </p>
                            ) : (
                              <p className="mt-2 font-mono-ae text-[0.65rem] text-muted-foreground/60">
                                Press play to reveal…
                              </p>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Consensus — only shows when all agents are revealed */}
                    <AnimatePresence>
                      {revealedCount >= selected.opinions.length && (
                        <motion.div
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 rounded-xl border border-border/60 bg-card/50 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="eyebrow">council consensus</div>
                              <div
                                className={cn(
                                  "mt-1 font-mono-ae text-2xl font-bold",
                                  selected.consensus === "PROCEED"
                                    ? "text-[oklch(0.7_0.18_145)]"
                                    : selected.consensus === "REVISE"
                                      ? "text-[oklch(0.85_0.16_85)]"
                                      : "text-[oklch(0.65_0.24_25)]"
                                )}
                              >
                                {selected.consensus}
                              </div>
                            </div>
                            <div className="flex gap-2 text-center">
                              {(["PROCEED", "REVISE", "REJECT"] as const).map((v) => {
                                const count =
                                  v === "PROCEED"
                                    ? selected.tally.proceed
                                    : v === "REVISE"
                                      ? selected.tally.revise
                                      : selected.tally.reject;
                                return (
                                  <div
                                    key={v}
                                    className="rounded-lg border border-border/40 bg-card/40 px-3 py-1.5"
                                  >
                                    <div className="font-mono-ae text-base font-bold text-foreground">
                                      {count}
                                    </div>
                                    <div className="eyebrow mt-0.5">{v.toLowerCase()}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Transport */}
                  <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
                    <div className="font-mono-ae text-[0.62rem] text-muted-foreground">
                      {revealedCount} / {selected.opinions.length} agents revealed
                      {playing && " · playing…"}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={togglePlay}
                        className="flex items-center gap-1.5 rounded-lg border border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 px-3 py-1.5 text-xs text-[oklch(0.82_0.17_195)] transition-all hover:bg-[oklch(0.82_0.17_195)]/20"
                      >
                        {playing ? (
                          <>
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" /> Play
                          </>
                        )}
                      </button>
                      <button
                        onClick={stepForward}
                        disabled={revealedCount >= selected.opinions.length}
                        className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground disabled:opacity-40"
                      >
                        <SkipForward className="h-3.5 w-3.5" /> Step
                      </button>
                      <button
                        onClick={revealAll}
                        disabled={revealedCount >= selected.opinions.length}
                        className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground disabled:opacity-40"
                      >
                        Reveal all <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </footer>
                </>
              ) : (
                <EmptyState onClose={() => setOpen(false)} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- Empty state ----
function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/40 bg-card/40"
      >
        <MessageSquare className="h-7 w-7 text-[oklch(0.74_0.22_300)]" />
      </motion.div>
      <div>
        <h3 className="font-mono-ae text-sm font-semibold text-foreground">
          No debates yet
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Trigger a council debate to see it here. Debates happen when the AI
          proposes a major change and the four council members (Architect,
          Developer, Auditor, Optimizer) argue about whether to proceed.
        </p>
      </div>
      <button
        onClick={onClose}
        className="rounded-lg border border-border/60 bg-card/40 px-4 py-1.5 text-xs text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground"
      >
        Close
      </button>
    </div>
  );
}
