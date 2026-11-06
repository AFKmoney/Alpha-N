/**
 * toast-system.tsx — the OS notification toasts.
 *
 * A tiny zustand store (`addToast` / `dismissToast`) drives a bottom-right
 * stack. Any module can fire one without React context:
 *   addToast({ type: "success", title: "Saved", message: "ok" })
 * or through the window event `alpha-toast` with detail
 *   { type, title, message }
 * Auto-dismiss defaults to 4000ms; pass duration 0 for a sticky toast.
 * `useToast()` exposes the newest toast plus its dismiss handler for
 * consumers that want to render a single inline toast.
 */
"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  time: number;
}

interface ToastStoreState {
  toasts: ToastItem[];
  addToast: (t: { type: ToastType; title: string; message: string; duration?: number }) => string;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION = 4000;
let toastSeq = 0;

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  addToast: ({ type, title, message, duration }) => {
    const id = `toast-${Date.now()}-${++toastSeq}`;
    const life = duration ?? DEFAULT_DURATION;
    set((s) => ({
      // keep the stack small — oldest toasts drop off the bottom
      toasts: [...s.toasts, { id, type, title, message, time: Date.now() }].slice(-5),
    }));
    if (life > 0) {
      window.setTimeout(() => get().dismissToast(id), life);
    }
    return id;
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React callers: fire-and-forget a toast. */
export function addToast(t: { type: ToastType; title: string; message: string; duration?: number }): string {
  return useToastStore.getState().addToast(t);
}

/** Hook form: the newest toast and its dismiss handler. */
export function useToast(): { toast: ToastItem | null; dismiss: () => void } {
  const toast = useToastStore((s) => s.toasts[s.toasts.length - 1] ?? null);
  const dismiss = () => {
    const last = useToastStore.getState().toasts[useToastStore.getState().toasts.length - 1];
    if (last) useToastStore.getState().dismissToast(last.id);
  };
  return { toast, dismiss };
}

// ---------------------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------------------

const TOAST_STYLE: Record<ToastType, { icon: React.ReactNode; ring: string; bar: string }> = {
  success: {
    icon: <CheckCircle2 className="h-4 w-4 text-(--ae-emerald)" />,
    ring: "border-(--ae-emerald)/35",
    bar: "bg-(--ae-emerald)",
  },
  error: {
    icon: <AlertCircle className="h-4 w-4 text-(--ae-rose)" />,
    ring: "border-(--ae-rose)/35",
    bar: "bg-(--ae-rose)",
  },
  info: {
    icon: <Info className="h-4 w-4 text-zinc-300" />,
    ring: "border-white/15",
    bar: "bg-zinc-400",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4 text-(--ae-gold)" />,
    ring: "border-(--ae-gold)/35",
    bar: "bg-(--ae-gold)",
  },
};

function ToastCard({ toast }: { toast: ToastItem }): React.ReactElement {
  const style = TOAST_STYLE[toast.type];
  return (
    <motion.div
      layout
      key={toast.id}
      initial={{ opacity: 0, x: 72, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 72, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn("glass-strong pointer-events-auto relative flex w-[320px] gap-3 overflow-hidden rounded-xl p-3 shadow-2xl", style.ring)}
    >
      <span className={cn("absolute left-0 top-0 h-full w-[3px]", style.bar)} />
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-zinc-100">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-zinc-400">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => useToastStore.getState().dismissToast(toast.id)}
        className="shrink-0 self-start rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
        aria-label="Dismiss notification"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

/**
 * ToastViewport — mounts once; renders the live stack and bridges the
 * window-event API into the store.
 */
export function ToastSystem(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: ToastType; title?: string; message?: string }>).detail;
      useToastStore.getState().addToast({
        type: detail?.type ?? "info",
        title: detail?.title ?? "Alpha-OS",
        message: detail?.message ?? "",
      });
    };
    window.addEventListener("alpha-toast", onToast);
    return () => window.removeEventListener("alpha-toast", onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-[9500] flex flex-col-reverse gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ToastSystem;
