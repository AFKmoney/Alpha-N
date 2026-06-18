/**
 * toast-system.tsx — global toast notification system for Alpha-N OS.
 *
 * Exposes a Zustand store `useToastStore` with `addToast`, `dismissToast`,
 * `clearToasts`, and a convenience hook `useToast()` returning
 * `{ toast, dismiss }`. Any component can fire a toast imperatively:
 *
 *   import { useToastStore } from "@/components/alpha/toast-system";
 *   useToastStore.getState().addToast({ type: "success", title: "Saved" });
 *
 * Or by dispatching a window CustomEvent — useful for non-React code:
 *
 *   window.dispatchEvent(
 *     new CustomEvent("alpha-toast", {
 *       detail: { type: "info", title: "Hello", message: "World" },
 *     })
 *   );
 *
 * Toasts appear in the bottom-right corner, stacked vertically, and auto-dismiss
 * after 4 seconds (configurable per-toast with `duration: 0` for sticky). Types:
 * success (emerald), error (red), info (zinc), warning (amber).
 */
"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Toast model ----
export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  type: ToastType;
  title: string;
  message?: string;
  action?: ToastAction;
  duration?: number; // ms; 0 = sticky (no auto-dismiss). Default 4000.
}

export interface Toast extends ToastInput {
  id: string;
  createdAt: number;
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

let toastId = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  addToast: (input) => {
    const id = `toast-${toastId++}`;
    const duration = input.duration ?? 4000;
    const toast: Toast = { ...input, id, duration, createdAt: Date.now() };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (duration > 0) {
      // Schedule auto-dismiss. Stored on the store so it survives re-renders.
      setTimeout(() => get().dismissToast(id), duration);
    }
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}));

/**
 * useToast — convenience hook for components that prefer a hooky API.
 * Returns `{ toast, dismiss }` where `toast` is `addToast` renamed.
 */
export function useToast() {
  const toast = useToastStore((s) => s.addToast);
  const dismiss = useToastStore((s) => s.dismissToast);
  return { toast, dismiss };
}

// ---- Per-type visual config ----
const TYPE_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle2; color: string; border: string; bg: string }
> = {
  success: {
    icon: CheckCircle2,
    color: "text-[oklch(0.7_0.18_145)]",
    border: "border-[oklch(0.7_0.18_145)]/40",
    bg: "bg-[oklch(0.7_0.18_145)]/[0.06]",
  },
  error: {
    icon: AlertCircle,
    color: "text-[oklch(0.65_0.24_25)]",
    border: "border-[oklch(0.65_0.24_25)]/40",
    bg: "bg-[oklch(0.65_0.24_25)]/[0.06]",
  },
  info: {
    icon: Info,
    color: "text-foreground/80",
    border: "border-border/60",
    bg: "bg-card/60",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-[oklch(0.85_0.16_85)]",
    border: "border-[oklch(0.85_0.16_85)]/40",
    bg: "bg-[oklch(0.85_0.16_85)]/[0.06]",
  },
};

/**
 * ToastSystem — mount once near the OS root. Listens for the
 * `alpha-toast` window CustomEvent so any code (including non-React
 * mini-services) can fire toasts without importing the store.
 */
export function ToastSystem() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);

  // Subscribe to window-dispatched `alpha-toast` events.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastInput>).detail;
      if (!detail || !detail.type) return;
      useToastStore.getState().addToast(detail);
    };
    window.addEventListener("alpha-toast", handler);
    return () => window.removeEventListener("alpha-toast", handler);
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
      data-ai-skip="true"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const cfg = TYPE_CONFIG[t.type];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={cn(
                "glass-strong pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-xl",
                cfg.border,
                cfg.bg
              )}
              onClick={() => dismiss(t.id)}
              role="status"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.color)} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t.title}</div>
                {t.message && (
                  <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {t.message}
                  </div>
                )}
                {t.action && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className={cn(
                      "mt-2 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[0.65rem] font-medium transition-all hover:bg-card/80",
                      cfg.color
                    )}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-all hover:bg-foreground/[0.05] hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
