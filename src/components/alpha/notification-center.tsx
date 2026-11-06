/**
 * notification-center.tsx — the OS notification center (F8 / bell icon).
 *
 * A right-edge slide-in panel that aggregates everything worth knowing
 * about into one unified, newest-first stream:
 *   · security violations (os-store violationAttempts)
 *   · applied mutations (evolution-store mutationStream)
 *   · rollbacks (os-store rollbackEvents)
 *   · compile checks (evolution-store compileResults)
 *   · reactive events (evolution-store eventQueue)
 * Unread state is tracked with `lastSeenAt`; "clear all" advances it and
 * marks every unhandled event as handled. Below the stream: live System
 * Events, Active Plans (with progress bars) and Active Goals color-coded
 * by horizon. Opens via `alpha-notification-center-open` / `-toggle`.
 */
"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  History,
  Inbox,
  ListChecks,
  Radio,
  ShieldAlert,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { AppliedMutation, CompileResult } from "@/lib/alpha/mutations";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Store — open state + unread watermark
// ---------------------------------------------------------------------------

interface NotificationCenterState {
  open: boolean;
  lastSeenAt: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  markSeen: () => void;
}

const useNotificationCenterStore = create<NotificationCenterState>((set) => ({
  open: false,
  lastSeenAt: 0,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  markSeen: () => set({ lastSeenAt: Date.now() }),
}));

// ---------------------------------------------------------------------------
// Unified notification model
// ---------------------------------------------------------------------------

type NotifCategory = "security" | "mutation" | "rollback" | "compile" | "event";

interface NotificationItem {
  id: string;
  category: NotifCategory;
  title: string;
  detail: string;
  time: number;
  icon: React.ReactNode;
  tone: string;
}

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fromViolations(entries: { path: string; reason: string; time: number }[]): NotificationItem[] {
  return entries.map((v, i) => ({
    id: `sec-${v.time}-${i}`,
    category: "security",
    title: "Security violation",
    detail: `${v.path} — ${v.reason}`,
    time: v.time,
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    tone: "text-[--ae-rose]",
  }));
}

function fromMutations(entries: AppliedMutation[]): NotificationItem[] {
  return entries.map((m) => ({
    id: `mut-${m.id}`,
    category: "mutation",
    title: `Mutation · ${m.kind}`,
    detail: m.description,
    time: m.time,
    icon: <Sparkles className="h-3.5 w-3.5" />,
    tone: "text-[--ae-cyan]",
  }));
}

function fromRollbacks(entries: { id: string; snapshotLabel: string; reason: string; time: number }[]): NotificationItem[] {
  return entries.map((r) => ({
    id: `rb-${r.id}`,
    category: "rollback",
    title: `Rollback → ${r.snapshotLabel}`,
    detail: r.reason,
    time: r.time,
    icon: <History className="h-3.5 w-3.5" />,
    tone: "text-[--ae-gold]",
  }));
}

function fromCompiles(entries: CompileResult[]): NotificationItem[] {
  return entries.map((c, i) => ({
    id: `cmp-${c.time}-${i}`,
    category: "compile",
    title: `Compile check · ${c.check}`,
    detail: c.ok
      ? "Type check and lint passed."
      : ((c.tscOutput ?? c.eslintOutput ?? "Errors found.").split("\n")[0] || "Errors found."),
    time: c.time,
    icon: c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />,
    tone: c.ok ? "text-[--ae-emerald]" : "text-[--ae-rose]",
  }));
}

function fromEvents(entries: { id: string; type: string; content: string; time: number }[]): NotificationItem[] {
  return entries
    .slice()
    .reverse()
    .map((e) => ({
      id: `evt-${e.id}`,
      category: "event",
      title: `Event · ${e.type}`,
      detail: e.content,
      time: e.time,
      icon: <Radio className="h-3.5 w-3.5" />,
      tone: "text-[--ae-amethyst]",
    }));
}

const GOAL_TONE: Record<string, string> = {
  long: "border-[--ae-cyan]/30 bg-[--ae-cyan]/5 text-[--ae-cyan]",
  medium: "border-[--ae-gold]/30 bg-[--ae-gold]/5 text-[--ae-gold]",
  short: "border-[--ae-emerald]/30 bg-[--ae-emerald]/5 text-[--ae-emerald]",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationCenter(): React.ReactElement {
  const open = useNotificationCenterStore((s) => s.open);
  const lastSeenAt = useNotificationCenterStore((s) => s.lastSeenAt);
  const markSeen = useNotificationCenterStore((s) => s.markSeen);
  const setOpen = useNotificationCenterStore((s) => s.setOpen);
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  const violationAttempts = useOS((s) => s.violationAttempts);
  const rollbackEvents = useOS((s) => s.rollbackEvents);
  const mutationStream = useEvolution((s) => s.mutationStream);
  const compileResults = useEvolution((s) => s.compileResults);
  const eventQueue = useEvolution((s) => s.eventQueue);
  const plans = useEvolution((s) => s.plans);
  const goals = useEvolution((s) => s.goals);

  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onToggle = () => useNotificationCenterStore.getState().toggle();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useNotificationCenterStore.getState().open) setOpen(false);
    };
    window.addEventListener("alpha-notification-center-open", onOpen);
    window.addEventListener("alpha-notification-center-toggle", onToggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("alpha-notification-center-open", onOpen);
      window.removeEventListener("alpha-notification-center-toggle", onToggle);
      window.removeEventListener("keydown", onKey);
    };
  }, [setOpen]);

  const notifications: NotificationItem[] = [
    ...fromViolations(violationAttempts),
    ...fromMutations(mutationStream),
    ...fromRollbacks(rollbackEvents),
    ...fromCompiles(compileResults),
    ...fromEvents(eventQueue),
  ].sort((a, b) => b.time - a.time);

  const unread = notifications.filter((n) => n.time > lastSeenAt).length;
  const unhandledEvents = eventQueue.filter((e) => !e.handled);

  const clearAll = () => {
    unhandledEvents.forEach((e) => useEvolution.getState().markEventHandled(e.id));
    markSeen();
  };

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="nc-backdrop"
          className="fixed inset-0 z-[9100] bg-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
          <motion.aside
            key="nc-panel"
            className="glass-strong font-mono-ae fixed inset-y-0 right-0 z-[9150] flex w-[min(400px,94vw)] flex-col border-l border-white/10 shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
              <span className="relative">
                <Bell className={cn("h-4 w-4", unread > 0 ? "text-[--ae-gold]" : "text-zinc-400")} />
                {unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[--ae-rose] px-1 text-[9px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-100">Notifications</p>
                <p className="eyebrow mt-0.5">
                  {unread} new · {notifications.length} total
                </p>
              </div>
              <button
                type="button"
                onClick={clearAll}
                disabled={unread === 0 && unhandledEvents.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <CheckCheck className="h-3 w-3" />
                clear all
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                aria-label="Close notification center"
              >
                <BellOff className="h-4 w-4" />
              </button>
            </header>

            <div className="scroll-ae flex-1 overflow-y-auto">
              {/* unified stream */}
              <div className="p-3">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Inbox className="h-8 w-8 text-zinc-600" />
                    <p className="eyebrow">all quiet</p>
                    <p className="max-w-[240px] text-xs text-zinc-500">
                      Violations, mutations, rollbacks, compiles and OS events land here.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {notifications.slice(0, 60).map((n) => (
                      <li
                        key={n.id}
                        className={cn(
                          "flex items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                          n.time > lastSeenAt
                            ? "border-[--ae-cyan]/25 bg-[--ae-cyan]/[0.06]"
                            : "border-white/8 bg-white/[0.02]"
                        )}
                      >
                        <span className={cn("mt-0.5 shrink-0", n.tone)}>{n.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-[11px] font-semibold text-zinc-200">{n.title}</p>
                            <span className="shrink-0 text-[9px] text-zinc-500">{timeLabel(n.time)}</span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-zinc-400">{n.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* system events */}
              <section className="border-t border-white/8 px-3 py-3">
                <p className="eyebrow mb-2">system events</p>
                {eventQueue.length === 0 ? (
                  <p className="px-1 text-[10px] text-zinc-600">No reactive events in the queue.</p>
                ) : (
                  <ul className="scroll-ae max-h-36 space-y-1 overflow-y-auto pr-1">
                    {eventQueue
                      .slice()
                      .reverse()
                      .map((e) => (
                        <li key={e.id} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1.5">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              e.handled ? "bg-zinc-600" : "bg-[--ae-amethyst] glow-amethyst"
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-300" title={e.content}>
                            <span className="text-zinc-500">[{e.type}]</span> {e.content}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>

              {/* active plans */}
              <section className="border-t border-white/8 px-3 py-3">
                <p className="eyebrow mb-2">active plans</p>
                {plans.filter((p) => p.status === "active").length === 0 ? (
                  <p className="px-1 text-[10px] text-zinc-600">No active plans.</p>
                ) : (
                  <ul className="space-y-2">
                    {plans
                      .filter((p) => p.status === "active")
                      .map((p) => {
                        const done = p.steps.filter((s) => s.done).length;
                        const pct = p.steps.length > 0 ? Math.round((done / p.steps.length) * 100) : 0;
                        return (
                          <li key={p.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate text-[11px] text-zinc-200" title={p.goal}>
                                {p.goal}
                              </p>
                              <span className="shrink-0 text-[9px] text-zinc-500">
                                {done}/{p.steps.length}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
                              <div
                                className="h-full rounded-full bg-[--ae-cyan] transition-[width] duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </section>

              {/* active goals */}
              <section className="border-t border-white/8 px-3 py-3">
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  <Target className="h-3 w-3" />
                  active goals
                </p>
                {goals.length === 0 ? (
                  <p className="px-1 text-[10px] text-zinc-600">No goals set — the AI will form its own.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {goals.slice(0, 8).map((g) => (
                      <li key={g.id} className={cn("rounded-lg border px-2.5 py-1.5 text-[10px]", GOAL_TONE[g.level] ?? "border-white/10")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate" title={g.text}>
                            {g.text}
                          </span>
                          <span className="shrink-0 opacity-70">{g.level}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* footer */}
            <footer className="flex items-center gap-2 border-t border-white/8 px-4 py-2 text-[9px] text-zinc-600">
              <ListChecks className="h-3 w-3" />
              {unhandledEvents.length} unhandled events · last seen{" "}
              {lastSeenAt === 0 ? "never" : timeLabel(lastSeenAt)}
            </footer>
          </motion.aside>
      )}
    </AnimatePresence>,
    portal
  );
}

export default NotificationCenter;
