/**
 * shortcuts-overlay.tsx — the keyboard cheat sheet.
 *
 * Pressing `?` (Shift + /) anywhere outside a text field opens a glass
 * overlay listing every OS shortcut grouped by domain (Window / Desktop /
 * AI / System). The KEYBOARD_SHORTCUTS array is exported so the keyboard
 * manager and docs can consume the same source of truth. Esc or a
 * click on the backdrop closes. Also opens via `alpha-shortcuts-open`.
 */
"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Keyboard, Layers, Monitor, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ShortcutsState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const useShortcutsStore = create<ShortcutsState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

// ---------------------------------------------------------------------------
// Shortcut data — single source of truth shared with the keyboard manager.
// ---------------------------------------------------------------------------

export interface ShortcutEntry {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  accent: string;
  entries: ShortcutEntry[];
}

export const KEYBOARD_SHORTCUTS: ShortcutGroup[] = [
  {
    id: "window",
    title: "Window",
    accent: "text-[--ae-cyan]",
    entries: [
      { keys: ["Alt", "Tab"], description: "Cycle focus through open windows" },
      { keys: ["Alt", "F4"], description: "Close the focused window" },
      { keys: ["Cmd", "W"], description: "Close the focused window" },
      { keys: ["Win", "←"], description: "Snap window to left half" },
      { keys: ["Win", "→"], description: "Snap window to right half" },
      { keys: ["Win", "↑"], description: "Maximize window" },
      { keys: ["Win", "↓"], description: "Minimize / restore window" },
      { keys: ["Win", "D"], description: "Show desktop (minimize all)" },
    ],
  },
  {
    id: "desktop",
    title: "Desktop",
    accent: "text-[--ae-amethyst]",
    entries: [
      { keys: ["Ctrl", "1…4"], description: "Switch to desktop 1–4" },
      { keys: ["Win", "Ctrl", "←"], description: "Move window to previous desktop" },
      { keys: ["Win", "Ctrl", "→"], description: "Move window to next desktop" },
    ],
  },
  {
    id: "ai",
    title: "AI",
    accent: "text-[--ae-emerald]",
    entries: [
      { keys: ["Cmd", "Shift", "E"], description: "Trigger an AI evolution cycle" },
      { keys: ["Cmd", "Shift", "C"], description: "Toggle the AI chat panel" },
      { keys: ["Cmd", "Shift", "G"], description: "Open the evolution graph" },
      { keys: ["Cmd", "Shift", "R"], description: "Open council debate replay" },
    ],
  },
  {
    id: "system",
    title: "System",
    accent: "text-[--ae-gold]",
    entries: [
      { keys: ["Cmd", "K"], description: "Open the command palette" },
      { keys: ["Cmd", "Shift", "F"], description: "Open universal system search" },
      { keys: ["?"], description: "Show this shortcut cheat sheet" },
      { keys: ["F8"], description: "Toggle the notification center" },
      { keys: ["Esc"], description: "Close the active overlay" },
    ],
  },
];

/** True when the keystroke lands in a text-entry surface. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShortcutsOverlay(): React.ReactElement {
  const open = useShortcutsStore((s) => s.open);
  const setOpen = useShortcutsStore((s) => s.setOpen);
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && useShortcutsStore.getState().open) {
        setOpen(false);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("alpha-shortcuts-open", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("alpha-shortcuts-open", onOpenEvent);
    };
  }, [setOpen]);

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="shortcuts-backdrop"
          className="fixed inset-0 z-[9300] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="glass-strong font-mono-ae flex max-h-[82vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-2xl border-[--ae-amethyst]/20 shadow-2xl"
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3.5">
              <Keyboard className="h-4 w-4 text-[--ae-amethyst]" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</p>
                <p className="eyebrow mt-0.5">press esc or click outside to close</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                aria-label="Close shortcuts overlay"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* groups */}
            <div className="scroll-ae grid grid-cols-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
              {KEYBOARD_SHORTCUTS.map((group) => (
                <section key={group.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5">
                  <header className="mb-2.5 flex items-center gap-2">
                    {group.id === "window" && <Layers className={cn("h-3.5 w-3.5", group.accent)} />}
                    {group.id === "desktop" && <Monitor className={cn("h-3.5 w-3.5", group.accent)} />}
                    {group.id === "ai" && <Bot className={cn("h-3.5 w-3.5", group.accent)} />}
                    {group.id === "system" && <Keyboard className={cn("h-3.5 w-3.5", group.accent)} />}
                    <p className={cn("eyebrow", group.accent)}>{group.title}</p>
                  </header>
                  <ul className="space-y-1.5">
                    {group.entries.map((entry) => (
                      <li
                        key={entry.keys.join("+") + entry.description}
                        className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/5"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{entry.description}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {entry.keys.map((k) => (
                            <kbd
                              key={k}
                              className="rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {/* footer */}
            <div className="border-t border-white/8 px-5 py-2.5 text-[10px] text-zinc-500">
              {KEYBOARD_SHORTCUTS.reduce((n, g) => n + g.entries.length, 0)} shortcuts · Alpha-OS shell
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portal
  );
}

export default ShortcutsOverlay;
