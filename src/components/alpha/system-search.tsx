/**
 * system-search.tsx — universal search over the whole OS (Cmd+Shift+F).
 *
 * On open it prefetches in parallel: directory listings from the files API
 * (src, src/components/alpha, src/lib/alpha, src/app/api/alpha) and Akasha
 * memories — both fail gracefully offline. In-memory sources (dock apps,
 * live windows, AI chat, plans, goals) are searched directly from the
 * stores. The query is debounced 300ms; results are grouped into seven
 * categories and flattened for arrow-key navigation. Opens via
 * `alpha-system-search-open`, closes with Esc or a click outside.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  Brain,
  CornerDownLeft,
  FileText,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  Search,
  Target,
  X,
} from "lucide-react";
import { DOCK_APPS } from "@/lib/alpha/os-types";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SearchState {
  open: boolean;
  query: string;
  debounced: string;
  selected: number;
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  setDebounced: (q: string) => void;
  move: (delta: number) => void;
}

const useSearchStore = create<SearchState>((set) => ({
  open: false,
  query: "",
  debounced: "",
  selected: 0,
  setOpen: (open) => set({ open, query: "", debounced: "", selected: 0 }),
  setQuery: (query) => set({ query, selected: 0 }),
  setDebounced: (debounced) => set({ debounced, selected: 0 }),
  move: (delta) => set((s) => ({ selected: s.selected + delta })),
}));

// ---------------------------------------------------------------------------
// Prefetched remote sources
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface MemoryEntry {
  text: string;
  kind: string;
}

const PREFETCH_DIRS = ["src", "src/components/alpha", "src/lib/alpha", "src/app/api/alpha"];

async function fetchDir(dir: string): Promise<FileEntry[]> {
  const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(dir)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { type?: string; entries?: { name: string; isDir: boolean }[] };
  if (data.type !== "dir" || !Array.isArray(data.entries)) return [];
  return data.entries.map((e) => ({ name: e.name, path: `${dir}/${e.name}`, isDir: e.isDir }));
}

async function fetchMemories(): Promise<MemoryEntry[]> {
  const res = await fetch("/api/alpha/akasha");
  if (!res.ok) return [];
  const data = (await res.json()) as { memory?: { text?: string; kind?: string }[] };
  if (!Array.isArray(data.memory)) return [];
  return data.memory
    .filter((m) => typeof m.text === "string")
    .map((m) => ({ text: m.text as string, kind: m.kind ?? "fact" }));
}

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string;
  label: string;
  detail: string;
  run: () => void;
}

interface ResultGroup {
  id: string;
  label: string;
  icon: React.ReactNode;
  accent: string;
  items: SearchResult[];
}

const GROUP_ORDER = ["apps", "windows", "files", "memories", "chat", "plans", "goals"] as const;

function matches(haystacks: (string | undefined)[], q: string): boolean {
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SystemSearch(): React.ReactElement {
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const debounced = useSearchStore((s) => s.debounced);
  const selected = useSearchStore((s) => s.selected);
  const setOpen = useSearchStore((s) => s.setOpen);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setDebounced = useSearchStore((s) => s.setDebounced);
  const move = useSearchStore((s) => s.move);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);

  const windows = useOS((s) => s.windows);
  const chat = useEvolution((s) => s.chat);
  const plans = useEvolution((s) => s.plans);
  const goals = useEvolution((s) => s.goals);

  useEffect(() => {
    Promise.resolve().then(() => setPortal(document.body));
  }, []);

  // Hotkey (Cmd/Ctrl+Shift+F) + open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && useSearchStore.getState().open) setOpen(false);
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("alpha-system-search-open", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("alpha-system-search-open", onOpenEvent);
    };
  }, [setOpen]);

  // Prefetch remote sources every time the palette opens (parallel, fault-tolerant).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([Promise.allSettled(PREFETCH_DIRS.map(fetchDir)), fetchMemories().catch(() => [])])
      .then(([dirResults, mems]) => {
        if (cancelled) return;
        const flat: FileEntry[] = [];
        dirResults.forEach((r) => {
          if (r.status === "fulfilled") flat.push(...r.value);
        });
        setFiles(flat);
        setMemories(mems);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 300ms debounce from the raw query onto the filtering query.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 300);
    return () => window.clearTimeout(t);
  }, [query, setDebounced]);

  // Focus input on open (DOM side effect).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const groups: ResultGroup[] = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const evolution = useEvolution.getState();
    const all: ResultGroup[] = [
      {
        id: "apps",
        label: "Apps",
        icon: <AppWindow className="h-3.5 w-3.5" />,
        accent: "text-[--ae-cyan]",
        items: DOCK_APPS.filter((a) => matches([a.label, a.kind, a.title], q)).slice(0, 8).map((a) => ({
          id: `app-${a.kind}`,
          label: a.label,
          detail: `App · ${a.title}`,
          run: () => useOS.getState().openApp(a.kind),
        })),
      },
      {
        id: "windows",
        label: "Windows",
        icon: <Layers className="h-3.5 w-3.5" />,
        accent: "text-[--ae-amethyst]",
        items: windows
          .filter((w) => matches([w.title, w.kind, String(w.desktop)], q))
          .slice(0, 8)
          .map((w) => ({
            id: `win-${w.id}`,
            label: w.title,
            detail: `Window · desktop ${w.desktop}${w.minimized ? " · minimized" : ""}`,
            run: () => useOS.getState().focusWindow(w.id),
          })),
      },
      {
        id: "files",
        label: "Files",
        icon: <FileText className="h-3.5 w-3.5" />,
        accent: "text-[--ae-emerald]",
        items: files
          .filter((f) => matches([f.name, f.path], q))
          .slice(0, 10)
          .map((f) => ({
            id: `file-${f.path}`,
            label: f.name,
            detail: f.isDir ? `Directory · ${f.path}` : f.path,
            run: () => useOS.getState().openApp("editor", { data: { path: f.path } }),
          })),
      },
      {
        id: "memories",
        label: "Memories",
        icon: <Brain className="h-3.5 w-3.5" />,
        accent: "text-[--ae-gold]",
        items: memories
          .filter((m) => matches([m.text, m.kind], q))
          .slice(0, 8)
          .map((m, i) => ({
            id: `mem-${i}`,
            label: m.text.length > 72 ? `${m.text.slice(0, 71)}…` : m.text,
            detail: `Akasha memory · ${m.kind}`,
            run: () => useOS.getState().openApp("memory"),
          })),
      },
      {
        id: "chat",
        label: "Chat",
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        accent: "text-[--ae-cyan]",
        items: chat
          .filter((c) => matches([c.content, c.displayContent, c.reasoning], q))
          .slice(0, 8)
          .map((c) => ({
            id: `chat-${c.id}`,
            label: (c.displayContent ?? c.content).replace(/\s+/g, " ").slice(0, 80),
            detail: `Chat · ${c.role === "ai" ? "Alpha" : "you"}`,
            run: () => evolution.toggleChat(),
          })),
      },
      {
        id: "plans",
        label: "Plans",
        icon: <ListChecks className="h-3.5 w-3.5" />,
        accent: "text-[--ae-amethyst]",
        items: plans
          .filter((p) => matches([p.goal, p.rationale], q))
          .slice(0, 8)
          .map((p) => ({
            id: `plan-${p.id}`,
            label: p.goal,
            detail: `Plan · ${p.steps.filter((s) => s.done).length}/${p.steps.length} steps · ${p.status}`,
            run: () => useOS.getState().openApp("evolution"),
          })),
      },
      {
        id: "goals",
        label: "Goals",
        icon: <Target className="h-3.5 w-3.5" />,
        accent: "text-[--ae-emerald]",
        items: goals
          .filter((g) => matches([g.text, g.level], q))
          .slice(0, 8)
          .map((g) => ({
            id: `goal-${g.id}`,
            label: g.text,
            detail: `Goal · ${g.level}-term`,
            run: () => useOS.getState().openApp("evolution"),
          })),
      },
    ];
    // With an empty query show only the launchable surface (apps + windows).
    return all.filter((g) => (q ? g.items.length > 0 : g.id === "apps" || g.id === "windows"));
  }, [debounced, files, memories, windows, chat, plans, goals]);

  const flat = useMemo(() => groups.flatMap((g) => g.items.map((item) => ({ group: g, item }))), [groups]);
  const clamped = Math.max(0, Math.min(selected, flat.length - 1));
  const active = flat[clamped] ?? null;

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${clamped}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [clamped, flat.length]);

  const execute = () => {
    if (!active) return;
    setOpen(false);
    active.item.run();
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
      execute();
    }
  };

  if (!portal) return <></>;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="search-backdrop"
          className="fixed inset-0 z-[9250] flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => setOpen(false)}
          onKeyDown={onKeyDown}
        >
          <motion.div
            className="glass-strong font-mono-ae flex max-h-[72vh] w-[min(680px,94vw)] flex-col overflow-hidden rounded-2xl border-[--ae-cyan]/20 shadow-2xl"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 440, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* input row */}
            <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-[--ae-cyan]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps, windows, files, memories, chat…"
                className="font-mono-ae flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                spellCheck={false}
              />
              {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[--ae-cyan]" />}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200"
                aria-label="Close search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* results */}
            <div ref={listRef} className="scroll-ae flex-1 overflow-y-auto p-2">
              {flat.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-12 text-center">
                  <Search className="h-6 w-6 text-zinc-600" />
                  <p className="eyebrow">{loading ? "indexing system…" : "nothing found"}</p>
                  <p className="max-w-[280px] text-xs text-zinc-500">
                    {loading
                      ? "Fetching files and memories — one moment."
                      : "Search apps, windows, files, memories, chat, plans and goals."}
                  </p>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.id} className="mb-2">
                    <p className={cn("eyebrow flex items-center gap-1.5 px-2 py-1", g.accent)}>
                      {g.icon}
                      {g.label}
                      <span className="ml-auto text-zinc-600">{g.items.length}</span>
                    </p>
                    {g.items.map((item) => {
                      const flatIdx = flat.findIndex((f) => f.item.id === item.id && f.group.id === g.id);
                      const isActive = flatIdx === clamped;
                      return (
                        <button
                          key={`${g.id}-${item.id}`}
                          type="button"
                          data-idx={flatIdx}
                          onMouseEnter={() => {
                            if (flatIdx >= 0 && flatIdx !== clamped) {
                              useSearchStore.setState({ selected: flatIdx });
                            }
                          }}
                          onClick={() => {
                            setOpen(false);
                            item.run();
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                            isActive ? "bg-[--ae-cyan]/10" : "hover:bg-white/5"
                          )}
                        >
                          <span className={cn("shrink-0", g.accent)}>{g.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-zinc-200">{item.label}</span>
                            <span className="block truncate text-[10px] text-zinc-500">{item.detail}</span>
                          </span>
                          {isActive && <CornerDownLeft className="h-3 w-3 shrink-0 text-[--ae-cyan]" />}
                        </button>
                      );
                    })}
                  </section>
                ))
              )}
            </div>

            {/* footer */}
            <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2 text-[10px] text-zinc-500">
              <span>{flat.length} results</span>
              <span className="text-zinc-600">↑↓ navigate · enter open · esc close</span>
              <span className="ml-auto flex items-center gap-1 text-zinc-600">
                <AppWindow className="h-3 w-3" />
                {PREFETCH_DIRS.length} dirs indexed
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portal
  );
}

export default SystemSearch;
