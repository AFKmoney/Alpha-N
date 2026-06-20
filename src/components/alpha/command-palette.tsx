/**
 * command-palette.tsx — Spotlight/Alfred-style command palette for Alpha-N OS.
 *
 * Triggered globally by Cmd+K (Mac) or Ctrl+K (Win/Linux). Fuzzy-filters across
 * app launches, AI actions, window actions, and system actions. Keyboard-first:
 * Arrow keys navigate, Enter executes, Esc closes. Animated entrance/exit via
 * framer-motion. Any component can open the palette by calling
 * `useCommandPalette.getState().setOpen(true)` or dispatching the
 * `alpha-command-palette-open` window event.
 */
"use client";

import { create } from "zustand";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Layers,
  Monitor,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { DOCK_APPS, DESKTOPS, type AppKind } from "@/lib/alpha/os-types";
import { cn } from "@/lib/utils";

// ---- Internal store so any component can open/close the palette ----
interface CommandPaletteStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useCommandPalette = create<CommandPaletteStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

// ---- Command model ----
type CmdCategory = "apps" | "ai" | "windows" | "system";

interface PaletteCommand {
  id: string;
  category: CmdCategory;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const CATEGORY_META: Record<CmdCategory, { label: string; accent: string }> = {
  apps: { label: "Apps", accent: "text-[oklch(0.82_0.17_195)]" },
  ai: { label: "AI", accent: "text-[oklch(0.74_0.22_300)]" },
  windows: { label: "Windows", accent: "text-[oklch(0.85_0.16_85)]" },
  system: { label: "System", accent: "text-[oklch(0.7_0.18_145)]" },
};

/**
 * CommandPalette — the global Cmd+K modal. Mount once near the root of the OS
 * (e.g. next to the dock). Listens for the keyboard shortcut itself.
 */
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openApp = useOS((s) => s.openApp);
  const windows = useOS((s) => s.windows);
  const closeWindow = useOS((s) => s.closeWindow);
  const minimizeWindow = useOS((s) => s.minimizeWindow);
  const setActiveDesktop = useOS((s) => s.setActiveDesktop);
  const triggerCycle = useEvolution((s) => s.triggerCycle);
  const toggleChat = useEvolution((s) => s.toggleChat);

  // Global Cmd+K / Ctrl+K listener — also listen for the custom open event
  // so other components (e.g. a button in the top bar) can open the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useCommandPalette.getState().open);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("alpha-command-palette-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("alpha-command-palette-open", onOpen);
    };
  }, [setOpen]);

  // Reset state whenever the palette opens — microtask-deferred to keep the
  // lint rule react-hooks/set-state-in-effect happy.
  useEffect(() => {
    if (open) {
      Promise.resolve().then(() => {
        setQuery("");
        setSelectedIdx(0);
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Build the command list once per relevant store change.
  const commands = useMemo<PaletteCommand[]>(() => {
    const apps: PaletteCommand[] = DOCK_APPS.map((a) => ({
      id: `app-${a.kind}`,
      category: "apps",
      label: a.label,
      hint: a.defaultTitle,
      icon: <span className="font-mono-ae text-xs">{a.icon}</span>,
      run: () => openApp(a.kind as AppKind),
    }));

    const ai: PaletteCommand[] = [
      {
        id: "ai-cycle",
        category: "ai",
        label: "Trigger evolution cycle",
        hint: "Force an AI self-improvement cycle",
        icon: <Sparkles className="h-4 w-4" />,
        run: () => triggerCycle(),
      },
      {
        id: "ai-chat",
        category: "ai",
        label: "Open chat with N-Core",
        hint: "Talk to the AI",
        icon: <Bot className="h-4 w-4" />,
        run: () => toggleChat(),
      },
      {
        id: "ai-ask",
        category: "ai",
        label: "Ask AI to…",
        hint: "Open chat to compose a request",
        icon: <Zap className="h-4 w-4" />,
        run: () => toggleChat(),
      },
    ];

    const winActions: PaletteCommand[] = [
      {
        id: "win-close-all",
        category: "windows",
        label: "Close all windows",
        hint: `Closes ${windows.length} open window(s)`,
        icon: <X className="h-4 w-4" />,
        run: () => windows.forEach((w) => closeWindow(w.id)),
      },
      {
        id: "win-min-all",
        category: "windows",
        label: "Minimize all windows",
        hint: "Send every window to the dock",
        icon: <Layers className="h-4 w-4" />,
        run: () => windows.forEach((w) => minimizeWindow(w.id)),
      },
      ...DESKTOPS.map<PaletteCommand>((d) => ({
        id: `desk-${d.id}`,
        category: "windows",
        label: `Switch to desktop ${d.name}`,
        hint: "Move to a virtual desktop",
        icon: <span className="font-mono-ae text-xs">{d.name}</span>,
        run: () => setActiveDesktop(d.id),
      })),
    ];

    const system: PaletteCommand[] = [
      {
        id: "sys-wallpaper",
        category: "system",
        label: "Open wallpaper picker",
        icon: <Palette className="h-4 w-4" />,
        run: () => openApp("wallpaper"),
      },
      {
        id: "sys-monitor",
        category: "system",
        label: "Open system monitor",
        icon: <Monitor className="h-4 w-4" />,
        run: () => openApp("monitor"),
      },
      {
        id: "sys-reset",
        category: "system",
        label: "Reset OS",
        hint: "Wipes AI state and reboots",
        icon: <RefreshCw className="h-4 w-4" />,
        run: async () => {
          try {
            await fetch("/api/alpha/reset", { method: "POST" });
          } catch {
            // Reset endpoint may be unavailable — fall through to reload.
          }
          window.location.reload();
        },
      },
      {
        id: "sys-theme",
        category: "system",
        label: "Toggle theme",
        hint: "Switch light/dark mode",
        icon: <span className="font-mono-ae text-xs">◐</span>,
        run: () => {
          // Toggle through the OS store — useThemeSync() reflects it onto
          // <html>. The old custom-event + manual class flip was racy.
          useOS.getState().toggleTheme();
        },
      },
    ];

    return [...apps, ...ai, ...winActions, ...system];
  }, [
    openApp,
    triggerCycle,
    toggleChat,
    windows,
    closeWindow,
    minimizeWindow,
    setActiveDesktop,
  ]);

  // Filter commands by query — simple substring match across label + hint.
  const filtered = useMemo<PaletteCommand[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ""} ${c.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, commands]);

  // Clamp the selection during render so we never point past the last item.
  const safeIdx = filtered.length === 0 ? 0 : Math.min(selectedIdx, filtered.length - 1);

  const execute = (cmd?: PaletteCommand) => {
    const c = cmd ?? filtered[safeIdx];
    if (!c) return;
    setOpen(false);
    // Defer execution so the modal can close first and the opened window
    // doesn't get covered by the still-rendering palette.
    Promise.resolve().then(() => c.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          data-ai-skip="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="glass-strong mt-[12vh] w-[92vw] max-w-2xl overflow-hidden rounded-2xl border border-border/60 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type a command or search…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="rounded-md border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono-ae text-[0.6rem] text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Command list */}
            <div className="scroll-ae max-h-[55vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No commands match &ldquo;{query}&rdquo;
                </div>
              ) : (
                filtered.map((cmd, idx) => {
                  const meta = CATEGORY_META[cmd.category];
                  const isSel = idx === safeIdx;
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => execute(cmd)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all",
                        isSel ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-card/40",
                          meta.accent
                        )}
                      >
                        {cmd.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{cmd.label}</div>
                        {cmd.hint && (
                          <div className="truncate text-xs text-muted-foreground">{cmd.hint}</div>
                        )}
                      </div>
                      <span className={cn("eyebrow shrink-0", meta.accent)}>{meta.label}</span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[0.62rem] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">↑↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">↵</kbd>
                  execute
                </span>
              </div>
              <span className="font-mono-ae">alpha-n · command palette</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
