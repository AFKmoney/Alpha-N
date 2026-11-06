/**
 * debate-replay.tsx — the council debate replay theater.
 *
 * Left sidebar lists every recorded debate (live from the evolution store
 * merged with a localStorage archive so older debates survive reloads);
 * the main panel replays the four council agents one reveal at a time.
 * Play reveals one agent every 2 seconds, Step reveals one immediately,
 * Reveal-all shows everything. The consensus verdict + tally only appears
 * after all four agents have spoken. Opens via `alpha-debate-replay-open`.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, Gavel, Lock, Play, SkipForward, Swords, Users, X } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { AgentOpinion, DebateResult } from "@/lib/alpha/mutations";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface DebateReplayState {
  open: boolean;
  selectedKey: string | null;
  revealed: number;
  setOpen: (open: boolean) => void;
  select: (key: string) => void;
  revealOne: () => void;
  revealAll: () => void;
}

const AGENT_ORDER = ["architect", "developer", "critic", "optimizer"] as const;
const REVEAL_TOTAL = AGENT_ORDER.length;

const useDebateStore = create<DebateReplayState>((set) => ({
  open: false,
  selectedKey: null,
  revealed: 0,
  setOpen: (open) => set({ open }),
  select: (key) => set({ selectedKey: key, revealed: 0 }),
  revealOne: () => set((s) => ({ revealed: Math.min(s.revealed + 1, REVEAL_TOTAL) })),
  revealAll: () => set({ revealed: REVEAL_TOTAL }),
}));

// ---------------------------------------------------------------------------
// Persistence — older debates survive reloads via localStorage
// ---------------------------------------------------------------------------

const LS_KEY = "alpha-n:debates";
const LS_CAP = 50;

interface ReplayDebate extends DebateResult {
  key: string;
}

function debateKey(d: DebateResult): string {
  return `${d.time}|${d.consensus}|${d.proposal.slice(0, 64)}`;
}

function readArchive(): DebateResult[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DebateResult[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => d && typeof d.proposal === "string" && Array.isArray(d.opinions));
  } catch {
    return [];
  }
}

function writeArchive(debates: ReplayDebate[]): void {
  try {
    const slim = debates.slice(0, LS_CAP).map(({ key: _key, ...rest }) => rest);
    window.localStorage.setItem(LS_KEY, JSON.stringify(slim));
  } catch {
    // storage may be unavailable (private mode / quota) — replay still works
  }
}

/** Merge live + archived debates, deduped, newest first. */
function mergeDebates(live: DebateResult[], archive: DebateResult[]): ReplayDebate[] {
  const seen = new Set<string>();
  const merged: ReplayDebate[] = [];
  for (const d of [...live, ...archive]) {
    const key = debateKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...d, key });
  }
  return merged.sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------------------
// Agent panel metadata
// ---------------------------------------------------------------------------

const AGENT_META: Record<(typeof AGENT_ORDER)[number], { name: string; accent: string; chip: string }> = {
  architect: { name: "Architect", accent: "text-(--ae-amethyst)", chip: "border-(--ae-amethyst)/30 bg-(--ae-amethyst)/10" },
  developer: { name: "Developer", accent: "text-(--ae-cyan)", chip: "border-(--ae-cyan)/30 bg-(--ae-cyan)/10" },
  critic: { name: "Critic", accent: "text-(--ae-rose)", chip: "border-(--ae-rose)/30 bg-(--ae-rose)/10" },
  optimizer: { name: "Optimizer", accent: "text-(--ae-gold)", chip: "border-(--ae-gold)/30 bg-(--ae-gold)/10" },
};

const VERDICT_STYLE: Record<AgentOpinion["verdict"], string> = {
  PROCEED: "border-(--ae-emerald)/40 bg-(--ae-emerald)/10 text-(--ae-emerald)",
  REVISE: "border-(--ae-gold)/40 bg-(--ae-gold)/10 text-(--ae-gold)",
  REJECT: "border-(--ae-rose)/40 bg-(--ae-rose)/10 text-(--ae-rose)",
};

function opinionFor(debate: ReplayDebate, role: (typeof AGENT_ORDER)[number]): AgentOpinion | null {
  const roleLower = role.toLowerCase();
  return (
    debate.opinions.find((o) => o.agent.toLowerCase().includes(roleLower)) ??
    debate.opinions.find((o) => roleLower.includes(o.agent.toLowerCase())) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DebateReplay(): React.ReactElement {
  const open = useDebateStore((s) => s.open);
  const selectedKey = useDebateStore((s) => s.selectedKey);
  const revealed = useDebateStore((s) => s.revealed);
  const setOpen = useDebateStore((s) => s.setOpen);
  const select = useDebateStore((s) => s.select);
  const revealOne = useDebateStore((s) => s.revealOne);
  const revealAll = useDebateStore((s) => s.revealAll);
  const [archive, setArchive] = useState<DebateResult[]>([]);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const playTimer = useRef<number | null>(null);

  const debateResults = useEvolution((s) => s.debateResults);

  const clearPlayTimer = () => {
    if (playTimer.current !== null) {
      window.clearTimeout(playTimer.current);
      playTimer.current = null;
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  // Hydrate the archive in a microtask — never synchronously inside the effect.
  useEffect(() => {
    Promise.resolve().then(() => setArchive(readArchive()));
  }, []);

  useEffect(() => {
    const onOpen = () => {
      clearPlayTimer();
      useDebateStore.setState({ open: true, revealed: 0 });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useDebateStore.getState().open) setOpen(false);
    };
    window.addEventListener("alpha-debate-replay-open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("alpha-debate-replay-open", onOpen);
      window.removeEventListener("keydown", onKey);
      clearPlayTimer();
    };
  }, [setOpen]);

  const debates = useMemo(() => mergeDebates(debateResults, archive), [debateResults, archive]);

  // Archive anything new (side effect only — no state updates here).
  useEffect(() => {
    if (debates.length === 0) return;
    writeArchive(debates);
  }, [debates]);

  // Effective selection: explicit pick, else the newest debate.
  const debate: ReplayDebate | null = useMemo(() => {
    if (debates.length === 0) return null;
    return debates.find((d) => d.key === selectedKey) ?? debates[0];
  }, [debates, selectedKey]);

  const allRevealed = revealed >= REVEAL_TOTAL;

  const startPlay = () => {
    clearPlayTimer();
    const tick = () => {
      useDebateStore.getState().revealOne();
      if (useDebateStore.getState().revealed < REVEAL_TOTAL) {
        playTimer.current = window.setTimeout(tick, 2000);
      } else {
        playTimer.current = null;
      }
    };
    playTimer.current = window.setTimeout(tick, 2000);
  };

  const stepOnce = () => {
    clearPlayTimer();
    revealOne();
  };

  const revealEverything = () => {
    clearPlayTimer();
    revealAll();
  };

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="debate-backdrop"
          className="fixed inset-0 z-[9350] flex items-center justify-center bg-black/65 p-5 backdrop-blur-[4px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="glass-strong font-mono-ae flex h-[82vh] w-[min(1040px,95vw)] overflow-hidden rounded-2xl border-(--ae-amethyst)/20 shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* sidebar */}
            <aside className="flex w-[280px] shrink-0 flex-col border-r border-white/8">
              <header className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
                <Swords className="h-4 w-4 text-(--ae-amethyst)" />
                <p className="text-xs font-semibold text-zinc-100">Debate Log</p>
                <span className="ml-auto rounded bg-white/8 px-1.5 py-0.5 text-[9px] text-zinc-400">
                  {debates.length}
                </span>
              </header>
              <div className="scroll-ae flex-1 overflow-y-auto p-2">
                {debates.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[10px] leading-relaxed text-zinc-600">
                    No debates recorded yet. The council convenes when the AI proposes a risky change.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {debates.map((d) => (
                      <li key={d.key}>
                        <button
                          type="button"
                          onClick={() => select(d.key)}
                          className={cn(
                            "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                            debate && d.key === debate.key
                              ? "border-(--ae-amethyst)/35 bg-(--ae-amethyst)/10"
                              : "border-transparent hover:bg-white/5"
                          )}
                        >
                          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-200">{d.proposal}</p>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded border px-1 py-px text-[8px] font-bold tracking-wide",
                                VERDICT_STYLE[d.consensus]
                              )}
                            >
                              {d.consensus}
                            </span>
                            <span className="text-[9px] text-zinc-500">
                              {new Date(d.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            {/* main panel */}
            <section className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-start gap-3 border-b border-white/8 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">council proposal</p>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-100">
                    {debate ? debate.proposal : "No debate selected"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={startPlay}
                    disabled={!debate || allRevealed}
                    className="flex items-center gap-1.5 rounded-lg border border-(--ae-emerald)/35 bg-(--ae-emerald)/10 px-2.5 py-1.5 text-[10px] text-(--ae-emerald) transition-colors hover:bg-(--ae-emerald)/20 disabled:opacity-35"
                  >
                    <Play className="h-3 w-3" />
                    play
                  </button>
                  <button
                    type="button"
                    onClick={stepOnce}
                    disabled={!debate || allRevealed}
                    className="flex items-center gap-1.5 rounded-lg border border-(--ae-cyan)/35 bg-(--ae-cyan)/10 px-2.5 py-1.5 text-[10px] text-(--ae-cyan) transition-colors hover:bg-(--ae-cyan)/20 disabled:opacity-35"
                  >
                    <SkipForward className="h-3 w-3" />
                    step
                  </button>
                  <button
                    type="button"
                    onClick={revealEverything}
                    disabled={!debate || allRevealed}
                    className="flex items-center gap-1.5 rounded-lg border border-(--ae-gold)/35 bg-(--ae-gold)/10 px-2.5 py-1.5 text-[10px] text-(--ae-gold) transition-colors hover:bg-(--ae-gold)/20 disabled:opacity-35"
                  >
                    <Eye className="h-3 w-3" />
                    reveal all
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                    aria-label="Close debate replay"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {debates.length === 0 || !debate ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <Users className="h-10 w-10 text-zinc-700" />
                  <p className="eyebrow">no debates yet</p>
                  <p className="max-w-[320px] text-xs text-zinc-500">
                    When the AI proposes a consequential change, the four-agent council debates it here —
                    verdicts, opinions and the final tally.
                  </p>
                </div>
              ) : (
                <div className="scroll-ae flex-1 overflow-y-auto p-5">
                  {/* agent panels */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {AGENT_ORDER.map((role, idx) => {
                      const meta = AGENT_META[role];
                      const revealedNow = idx < revealed;
                      const opinion = opinionFor(debate, role);
                      return (
                        <motion.article
                          key={role}
                          initial={false}
                          animate={{ opacity: revealedNow ? 1 : 0.55 }}
                          className={cn(
                            "rounded-xl border p-3.5 transition-colors",
                            revealedNow ? cn("bg-white/[0.03]", meta.chip) : "border-white/8 bg-white/[0.01]"
                          )}
                        >
                          <header className="flex items-center gap-2">
                            <span className={cn("text-[11px] font-bold uppercase tracking-wider", meta.accent)}>
                              {meta.name}
                            </span>
                            {revealedNow && opinion ? (
                              <span
                                className={cn(
                                  "ml-auto rounded border px-1.5 py-px text-[9px] font-bold",
                                  VERDICT_STYLE[opinion.verdict]
                                )}
                              >
                                {opinion.verdict}
                              </span>
                            ) : (
                              <Lock className="ml-auto h-3 w-3 text-zinc-600" />
                            )}
                          </header>
                          <p
                            className={cn(
                              "mt-2 text-[11px] leading-relaxed text-zinc-300",
                              !revealedNow && "select-none blur-[5px]"
                            )}
                          >
                            {revealedNow
                              ? (opinion?.opinion ?? "No opinion recorded from this agent for this debate.")
                              : "The agent's reasoning stays sealed until it is this agent's turn to speak."}
                          </p>
                        </motion.article>
                      );
                    })}
                  </div>

                  {/* consensus — only after all agents revealed */}
                  <AnimatePresence>
                    {allRevealed && (
                      <motion.div
                        key="consensus"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <header className="flex items-center gap-2">
                          <Gavel className="h-3.5 w-3.5 text-(--ae-gold)" />
                          <p className="eyebrow">council consensus</p>
                        </header>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs font-bold tracking-wide",
                              VERDICT_STYLE[debate.consensus]
                            )}
                          >
                            {debate.consensus}
                          </span>
                          <span className="rounded-lg border border-(--ae-emerald)/30 bg-(--ae-emerald)/10 px-2 py-1 text-[10px] text-(--ae-emerald)">
                            proceed {debate.tally.proceed}
                          </span>
                          <span className="rounded-lg border border-(--ae-gold)/30 bg-(--ae-gold)/10 px-2 py-1 text-[10px] text-(--ae-gold)">
                            revise {debate.tally.revise}
                          </span>
                          <span className="rounded-lg border border-(--ae-rose)/30 bg-(--ae-rose)/10 px-2 py-1 text-[10px] text-(--ae-rose)">
                            reject {debate.tally.reject}
                          </span>
                          <span className="ml-auto text-[9px] text-zinc-500">
                            {new Date(debate.time).toLocaleString()}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portal
  );
}

export default DebateReplay;
