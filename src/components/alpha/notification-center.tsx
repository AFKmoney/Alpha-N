/**
 * notification-center.tsx — slide-in panel from the right edge of the screen.
 *
 * Aggregates recent system events (security violations, mutations, rollbacks,
 * compile results, reactive events), active AI plans, and active goals. Each
 * section is independently scrollable. The unread badge count is computed from
 * items that arrived after `lastSeenAt` (so opening the panel marks everything
 * seen). The Clear-all button advances `lastSeenAt` and marks reactive events
 * handled.
 *
 * The panel is controlled by an internal Zustand store `useNotificationCenter`
 * so any component (e.g. a bell icon in the top bar) can open it. It also
 * listens for the `alpha-notification-center-toggle` window event so global
 * hotkeys (F8) can toggle it without importing the store.
 */
"use client";

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertOctagon,
  Bell,
  Bug,
  CheckCheck,
  GitCommit,
  Goal,
  ListChecks,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";

// ---- Internal store ----
interface NotificationCenterStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  lastSeenAt: number;
  markAllSeen: () => void;
}

export const useNotificationCenter = create<NotificationCenterStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
  lastSeenAt: Date.now(),
  markAllSeen: () => set({ lastSeenAt: Date.now() }),
}));

// ---- Unified event model ----
type NotificationKind =
  | "security"
  | "mutation"
  | "rollback"
  | "compile"
  | "event";

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  time: number;
}

const KIND_CONFIG: Record<
  NotificationKind,
  { icon: typeof ShieldAlert; color: string; label: string }
> = {
  security: {
    icon: ShieldAlert,
    color: "text-[oklch(0.65_0.24_25)]",
    label: "Security",
  },
  mutation: {
    icon: GitCommit,
    color: "text-[oklch(0.7_0.18_145)]",
    label: "Mutation",
  },
  rollback: {
    icon: RotateCcw,
    color: "text-[oklch(0.85_0.16_85)]",
    label: "Rollback",
  },
  compile: {
    icon: Bug,
    color: "text-[oklch(0.82_0.17_195)]",
    label: "Compile",
  },
  event: {
    icon: AlertOctagon,
    color: "text-[oklch(0.74_0.22_300)]",
    label: "Event",
  },
};

// ---- Helpers ----
function relativeTime(ts: number, mounted: boolean): string {
  if (!mounted) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * NotificationCenter — the slide-in panel. Mount once near the OS root.
 */
export function NotificationCenter() {
  const open = useNotificationCenter((s) => s.open);
  const setOpen = useNotificationCenter((s) => s.setOpen);
  const markAllSeen = useNotificationCenter((s) => s.markAllSeen);
  const lastSeenAt = useNotificationCenter((s) => s.lastSeenAt);

  const mounted = useMounted();

  // Subscribe to all the data sources.
  const eventQueue = useEvolution((s) => s.eventQueue);
  const mutationStream = useEvolution((s) => s.mutationStream);
  const compileResults = useEvolution((s) => s.compileResults);
  const plans = useEvolution((s) => s.plans);
  const goals = useEvolution((s) => s.goals);
  const markEventHandled = useEvolution((s) => s.markEventHandled);

  const violationAttempts = useOS((s) => s.violationAttempts);
  const rollbackEvents = useOS((s) => s.rollbackEvents);

  // Listen for the toggle window event (so the F8 hotkey can open it).
  useEffect(() => {
    const onToggle = () => useNotificationCenter.getState().toggle();
    const onOpen = () => useNotificationCenter.getState().setOpen(true);
    window.addEventListener("alpha-notification-center-toggle", onToggle);
    window.addEventListener("alpha-notification-center-open", onOpen);
    return () => {
      window.removeEventListener("alpha-notification-center-toggle", onToggle);
      window.removeEventListener("alpha-notification-center-open", onOpen);
    };
  }, []);

  // Build a unified, sorted event list (newest first).
  const items = useMemo<NotificationItem[]>(() => {
    const security: NotificationItem[] = violationAttempts.map((v) => ({
      id: `viol-${v.time}-${v.path}`,
      kind: "security",
      title: `Blocked: ${v.path}`,
      description: v.reason,
      time: v.time,
    }));

    const mutations: NotificationItem[] = mutationStream.map((m) => ({
      id: m.id,
      kind: "mutation",
      title: m.kind,
      description: m.description,
      time: m.time,
    }));

    const rollbacks: NotificationItem[] = rollbackEvents.map((r) => ({
      id: r.id,
      kind: "rollback",
      title: `Rolled back to ${r.snapshotLabel}`,
      description: r.reason,
      time: r.time,
    }));

    const compiles: NotificationItem[] = compileResults.map((c) => ({
      id: `compile-${c.time}`,
      kind: "compile",
      title: `${c.check} ${c.ok ? "passed" : "failed"}`,
      description: c.tscOutput?.slice(0, 120) ?? c.eslintOutput?.slice(0, 120) ?? "OK",
      time: c.time,
    }));

    const events: NotificationItem[] = eventQueue.map((e) => ({
      id: e.id,
      kind: "event",
      title: e.type,
      description: e.content,
      time: e.time,
    }));

    return [...security, ...mutations, ...rollbacks, ...compiles, ...events].sort(
      (a, b) => b.time - a.time
    );
  }, [violationAttempts, mutationStream, rollbackEvents, compileResults, eventQueue]);

  // Unread = items that arrived after the last "seen" timestamp.
  const unreadCount = useMemo(
    () => items.filter((i) => i.time > lastSeenAt).length,
    [items, lastSeenAt]
  );

  // Active plans + goals (only active plans; all goals are "active").
  const activePlans = useMemo(() => plans.filter((p) => p.status === "active"), [plans]);

  // Clear-all: advance the seen timestamp and mark all reactive events handled.
  const onClearAll = () => {
    markAllSeen();
    eventQueue.forEach((e) => {
      if (!e.handled) markEventHandled(e.id);
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — click to close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/30"
            onClick={() => setOpen(false)}
            data-ai-skip="true"
          />

          {/* Panel — slides in from the right */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
            className="glass-strong fixed right-0 top-0 z-50 flex h-full w-[min(92vw,420px)] flex-col border-l border-border/60 shadow-2xl"
          >
            {/* Header */}
            <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Bell className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[oklch(0.65_0.24_25)] px-1 font-mono-ae text-[0.55rem] font-bold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="font-mono-ae text-sm font-semibold text-foreground">
                    Notifications
                  </h2>
                  <p className="eyebrow">
                    {unreadCount > 0 ? `${unreadCount} new` : "all caught up"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={onClearAll}
                  className="flex items-center gap-1 rounded-md border border-border/60 bg-card/40 px-2 py-1 text-[0.62rem] text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground"
                  title="Mark all as seen"
                >
                  <CheckCheck className="h-3 w-3" />
                  <span className="font-mono-ae">clear</span>
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground transition-all hover:bg-foreground/[0.06] hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Body — three scrollable sections */}
            <div className="scroll-ae flex-1 overflow-y-auto">
              {/* Section: System Events */}
              <Section
                title="System Events"
                icon={<AlertOctagon className="h-3 w-3" />}
                count={items.length}
              >
                {items.length === 0 ? (
                  <EmptyRow label="No events yet" />
                ) : (
                  items.slice(0, 40).map((item) => {
                    const cfg = KIND_CONFIG[item.kind];
                    const Icon = cfg.icon;
                    const isUnread = item.time > lastSeenAt;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "flex gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                          isUnread ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.02]"
                        )}
                      >
                        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", cfg.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono-ae text-[0.7rem] font-medium text-foreground">
                              {item.title}
                            </span>
                            <span className="shrink-0 font-mono-ae text-[0.55rem] text-muted-foreground">
                              {relativeTime(item.time, mounted)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                        {isUnread && (
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[oklch(0.85_0.16_85)]" />
                        )}
                      </div>
                    );
                  })
                )}
              </Section>

              {/* Section: Active Plans */}
              <Section
                title="Active Plans"
                icon={<ListChecks className="h-3 w-3" />}
                count={activePlans.length}
              >
                {activePlans.length === 0 ? (
                  <EmptyRow label="No active plans — the AI is not pursuing anything long-horizon right now" />
                ) : (
                  activePlans.map((plan) => {
                    const done = plan.steps.filter((s) => s.done).length;
                    const pct = plan.steps.length === 0 ? 0 : (done / plan.steps.length) * 100;
                    return (
                      <div
                        key={plan.id}
                        className="rounded-lg border border-border/40 bg-card/30 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">
                            {plan.goal}
                          </span>
                          <span className="shrink-0 font-mono-ae text-[0.55rem] text-muted-foreground">
                            {done}/{plan.steps.length}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[0.65rem] text-muted-foreground">
                          {plan.rationale}
                        </p>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10">
                          <div
                            className="h-full rounded-full bg-[oklch(0.82_0.17_195)] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </Section>

              {/* Section: Goals */}
              <Section
                title="Active Goals"
                icon={<Goal className="h-3 w-3" />}
                count={goals.length}
              >
                {goals.length === 0 ? (
                  <EmptyRow label="No goals set" />
                ) : (
                  goals.slice(0, 12).map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          g.level === "long"
                            ? "bg-[oklch(0.85_0.16_85)]"
                            : g.level === "medium"
                              ? "bg-[oklch(0.82_0.17_195)]"
                              : "bg-[oklch(0.7_0.18_145)]"
                        )}
                      />
                      <span className="flex-1 truncate text-xs text-foreground/90">
                        {g.text}
                      </span>
                      <span className="shrink-0 font-mono-ae text-[0.55rem] uppercase text-muted-foreground">
                        {g.level}
                      </span>
                    </div>
                  ))
                )}
              </Section>
            </div>

            {/* Footer */}
            <footer className="border-t border-border/60 px-4 py-2 text-[0.6rem] text-muted-foreground">
              <span className="font-mono-ae">alpha-n · notification center</span>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ---- Sub-components ----
function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/40 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="eyebrow">{title}</h3>
        <span className="ml-auto rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono-ae text-[0.55rem] text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="scroll-ae flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
        {children}
      </div>
    </section>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-center text-[0.7rem] text-muted-foreground">
      {label}
    </div>
  );
}
