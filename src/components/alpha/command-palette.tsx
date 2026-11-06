/**
 * command-palette.tsx — the OS-wide action launcher (Cmd+K / Ctrl+K).
 *
 * A single fuzzy-ish substring filter over every action the desktop offers:
 * dock apps, AI actions, window management and system utilities. Fully
 * keyboard driven: arrows navigate, Enter executes, Esc dismisses. The
 * selected index is clamped during render (never patched from an effect).
 * Also opens via the `alpha-command-palette-open` window event.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Command,
  CornerDownLeft,
  Layers,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Moon,
  Minimize2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { DOCK_APPS, DESKTOPS, type AppKind, type DockApp } from "@/lib/alpha/os-types";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Internal store — open state, query and keyboard selection live here so any
// part of the OS can open the palette without prop drilling.
// ---------------------------------------------------------------------------

interface PaletteState {
  open: boolean;
  query: string;
  selected: number;
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  move: (delta: number) => void;
  reset: () => void;
}

const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  query: "",
  selected: 0,
  setOpen: (open) => set({ open, query: "", selected: 0 }),
  setQuery: (query) => set({ query, selected: 0 }),
  move: (delta) => set((s) => ({ selected: s.selected + delta })),
  reset: () => set({ query: "", selected: 0 }),
}));

// ---------------------------------------------------------------------------
// Command model
// ---------------------------------------------------------------------------

type CommandCategory = "Apps" | "AI" | "Windows" | "System";

interface PaletteCommand {
  id: string;
  label: string;
  category: CommandCategory;
  icon: React.ReactNode;
  keywords: string;
  accent: string;
  run: () => void;
}

const CATEGORY_ICON: Record<CommandCategory, React.ReactNode> = {
  Apps: <LayoutGrid className="h-3 w-3" />,
  AI: <Sparkles className="h-3 w-3" />,
  Windows: <Layers className="h-3 w-3" />,
  System: <Monitor className="h-3 w-3" />,
};

function appCommand(app: DockApp): PaletteCommand {
  return {
    id: `app-${app.kind}`,
    label: `Open ${app.label}`,
    category: "Apps",
    icon: <span className="w-4 text-center text-[11px] leading-4">{app.icon}</span>,
    keywords: `${app.kind} ${app.title} launch app`,
    accent: "text-(--ae-cyan)",
    run: () => useOS.getState().openApp(app.kind),
  };
}

function buildCommands(): PaletteCommand[] {
  const ai = useEvolution.getState();
  const os = useOS.getState();
  const commands: PaletteCommand[] = DOCK_APPS.map(appCommand);

  commands.push(
    {
      id: "ai-cycle",
      label: "Trigger AI evolution cycle",
      category: "AI",
      icon: <Bot className="h-4 w-4" />,
      keywords: "evolve think run nucleus autonomous force",
      accent: "text-(--ae-amethyst)",
      run: () => ai.triggerCycle(),
    },
    {
      id: "ai-chat",
      label: "Open AI chat",
      category: "AI",
      icon: <MessageSquare className="h-4 w-4" />,
      keywords: "talk ask assistant conversation nucleus",
      accent: "text-(--ae-cyan)",
      run: () => ai.toggleChat(),
    },
    {
      id: "win-close-all",
      label: "Close all windows",
      category: "Windows",
      icon: <Trash2 className="h-4 w-4" />,
      keywords: "kill quit purge cleanup desktop",
      accent: "text-(--ae-rose)",
      run: () => {
        useOS.getState().windows.forEach((w) => useOS.getState().closeWindow(w.id));
      },
    },
    {
      id: "win-minimize-all",
      label: "Minimize all windows",
      category: "Windows",
      icon: <Minimize2 className="h-4 w-4" />,
      keywords: "hide show desktop clear",
      accent: "text-(--ae-gold)",
      run: () => os.minimizeAll(),
    }
  );

  for (let d = 1; d <= DESKTOPS; d++) {
    commands.push({
      id: `desktop-${d}`,
      label: `Switch to Desktop ${d}`,
      category: "Windows",
      icon: <span className="w-4 text-center text-[11px] leading-4">{d}</span>,
      keywords: `workspace space move go ${d}`,
      accent: "text-(--ae-cyan)",
      run: () => useOS.getState().setActiveDesktop(d),
    });
  }

  commands.push(
    {
      id: "sys-theme",
      label: "Toggle dark / light theme",
      category: "System",
      icon: <Moon className="h-4 w-4" />,
      keywords: "appearance light dark mode switch sun",
      accent: "text-(--ae-gold)",
      run: () => useOS.getState().toggleTheme(),
    },
    {
      id: "sys-monitor",
      label: "Open system monitor",
      category: "System",
      icon: <Monitor className="h-4 w-4" />,
      keywords: "cpu ram metrics stats health",
      accent: "text-(--ae-emerald)",
      run: () => useOS.getState().openApp("monitor" as AppKind),
    },
    {
      id: "sys-reset",
      label: "Reset Alpha-OS (factory wipe)",
      category: "System",
      icon: <RotateCcw className="h-4 w-4" />,
      keywords: "reboot factory wipe clean restart danger",
      accent: "text-(--ae-rose)",
      run: () => {
        void fetch("/api/alpha/reset", { method: "POST" })
          .catch(() => undefined)
          .then(() => window.location.reload());
      },
    }
  );

  return commands;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette(): React.ReactElement {
  const open = usePaletteStore((s) => s.open);
  const query = usePaletteStore((s) => s.query);
  const selected = usePaletteStore((s) => s.selected);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const move = usePaletteStore((s) => s.move);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  // Defer the portal target to a microtask — no synchronous setState in a
  // mount effect. AnimatePresence stays mounted so exit springs can play.
  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  // Global hotkey (Cmd/Ctrl+K) + open event listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!usePaletteStore.getState().open);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("alpha-command-palette-open", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("alpha-command-palette-open", onOpenEvent);
    };
  }, [setOpen]);

  // Focus the input whenever the palette appears (effects may touch the DOM).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commands = useMemo(() => buildCommands(), [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords} ${c.category}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Clamp during render — never fight the effect system for this.
  const clamped = Math.max(0, Math.min(selected, filtered.length - 1));
  const active = filtered[clamped] ?? null;

  // Keep the selected row visible while arrowing through long lists.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${clamped}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [clamped, filtered.length]);

  const execute = (cmd: PaletteCommand | null) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(active);
    }
  };

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette-backdrop"
          className="fixed inset-0 z-[9200] flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => setOpen(false)}
          onKeyDown={onKeyDown}
        >
          <motion.div
            className="glass-strong font-mono-ae w-[min(620px,92vw)] overflow-hidden rounded-2xl border-(--ae-cyan)/20 shadow-2xl"
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* input row */}
            <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-(--ae-cyan)" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search…"
                className="font-mono-ae flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                aria-label="Close palette"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* results */}
            <div ref={listRef} className="scroll-ae max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                  <Command className="h-6 w-6 text-zinc-600" />
                  <p className="eyebrow">no matching commands</p>
                  <p className="text-xs text-zinc-500">Try &quot;desktop&quot;, &quot;theme&quot; or an app name.</p>
                </div>
              ) : (
                filtered.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => {
                      if (idx !== clamped) {
                        // hover re-targets without disturbing keyboard state
                        usePaletteStore.setState({ selected: idx });
                      }
                    }}
                    onClick={() => execute(cmd)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                      idx === clamped ? "bg-(--ae-cyan)/10" : "hover:bg-white/5"
                    )}
                  >
                    <span className={cn("shrink-0", cmd.accent)}>{cmd.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-zinc-200">{cmd.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-500">
                      {CATEGORY_ICON[cmd.category]}
                      {cmd.category}
                    </span>
                    {idx === clamped && <CornerDownLeft className="h-3 w-3 shrink-0 text-(--ae-cyan)" />}
                  </button>
                ))
              )}
            </div>

            {/* footer hints */}
            <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" />
                navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" />
                run
              </span>
              <span>esc dismiss</span>
              <span className="ml-auto text-zinc-600">
                {filtered.length} / {commands.length} commands
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portal
  );
}

export default CommandPalette;
