/**
 * shortcuts-overlay.tsx — keyboard shortcuts help overlay for Alpha-N OS.
 *
 * Listens for the `?` key (Shift+/) when no input/textarea/contenteditable
 * element is focused. Shows a centered modal listing every keyboard shortcut
 * grouped by category. Each shortcut is rendered as styled `<kbd>` keys plus
 * a short description. Closes on Esc or by clicking the backdrop.
 *
 * The shortcut list is exported as `KEYBOARD_SHORTCUTS` so other components
 * (e.g. the top bar's help button) can reuse the same data source.
 */
"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Internal store so any component can open the overlay ----
interface ShortcutsOverlayStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useShortcutsOverlay = create<ShortcutsOverlayStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

// ---- Shortcut data ----
export interface ShortcutEntry {
  keys: string[]; // each key rendered as its own <kbd>
  description: string;
}

export interface ShortcutGroup {
  category: string;
  accent: string; // tailwind text color class
  entries: ShortcutEntry[];
}

// Single source of truth for all OS-wide keyboard shortcuts.
export const KEYBOARD_SHORTCUTS: ShortcutGroup[] = [
  {
    category: "Window",
    accent: "text-[oklch(0.82_0.17_195)]",
    entries: [
      { keys: ["Alt", "Tab"], description: "Cycle through open windows" },
      { keys: ["Cmd", "W"], description: "Close the active window" },
      { keys: ["Win", "←"], description: "Snap window to the left half" },
      { keys: ["Win", "→"], description: "Snap window to the right half" },
      { keys: ["Win", "↑"], description: "Maximize the active window" },
      { keys: ["Win", "↓"], description: "Restore / minimize the active window" },
      { keys: ["Win", "D"], description: "Show desktop (minimize everything)" },
    ],
  },
  {
    category: "Desktop",
    accent: "text-[oklch(0.85_0.16_85)]",
    entries: [
      { keys: ["Ctrl", "1"], description: "Switch to desktop 1" },
      { keys: ["Ctrl", "2"], description: "Switch to desktop 2" },
      { keys: ["Ctrl", "3"], description: "Switch to desktop 3" },
      { keys: ["Ctrl", "4"], description: "Switch to desktop 4" },
      { keys: ["Cmd", "K"], description: "Open the command palette" },
      { keys: ["Cmd", "Shift", "F"], description: "Open universal system search" },
      { keys: ["?"], description: "Toggle this shortcuts overlay" },
    ],
  },
  {
    category: "AI",
    accent: "text-[oklch(0.74_0.22_300)]",
    entries: [
      { keys: ["Cmd", "↵"], description: "Trigger an AI evolution cycle" },
      { keys: ["Esc"], description: "Interrupt the running AI cycle" },
      { keys: ["Cmd", "B"], description: "Open chat with N-Core" },
    ],
  },
  {
    category: "System",
    accent: "text-[oklch(0.7_0.18_145)]",
    entries: [
      { keys: ["F8"], description: "Open the notification center" },
      { keys: ["F2"], description: "Rename the active window" },
      { keys: ["F11"], description: "Toggle fullscreen" },
    ],
  },
];

// ---- Helpers ----
const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!t || typeof t !== "object") return false;
  const el = t as HTMLElement;
  if (INPUT_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * ShortcutsOverlay — the help modal. Mount once near the OS root.
 */
export function ShortcutsOverlay() {
  const open = useShortcutsOverlay((s) => s.open);
  const setOpen = useShortcutsOverlay((s) => s.setOpen);

  // Listen for `?` (Shift+/) when no input is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isEditableTarget(e)) {
        e.preventDefault();
        setOpen(!useShortcutsOverlay.getState().open);
      } else if (e.key === "Escape" && useShortcutsOverlay.getState().open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

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
            className="glass-strong w-[92vw] max-w-3xl overflow-hidden rounded-2xl border border-border/60 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Keyboard className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
                <div>
                  <h2 className="font-mono-ae text-sm font-semibold text-foreground">
                    Keyboard Shortcuts
                  </h2>
                  <p className="eyebrow">every key the OS responds to</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-all hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close shortcuts"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Grid of groups */}
            <div className="scroll-ae grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              {KEYBOARD_SHORTCUTS.map((group) => (
                <div
                  key={group.category}
                  className="rounded-xl border border-border/40 bg-card/30 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full bg-current", group.accent)} />
                    <h3 className={cn("font-mono-ae text-xs font-semibold uppercase tracking-wider", group.accent)}>
                      {group.category}
                    </h3>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {group.entries.map((entry, i) => (
                      <li
                        key={`${group.category}-${i}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-xs text-foreground/85">
                          {entry.description}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {entry.keys.map((k, j) => (
                            <kbd
                              key={`${i}-${j}`}
                              className="rounded-md border border-border/60 bg-card/70 px-1.5 py-0.5 font-mono-ae text-[0.62rem] text-foreground/80 shadow-[0_1px_0_0_oklch(0.4_0_0/0.4)]"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border/60 px-5 py-2.5 text-[0.62rem] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">Esc</kbd>
                or click outside to close
              </span>
              <span className="font-mono-ae">alpha-n · {KEYBOARD_SHORTCUTS.reduce((n, g) => n + g.entries.length, 0)} shortcuts</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
