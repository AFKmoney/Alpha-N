/**
 * system-search.tsx — universal search overlay for Alpha-N OS.
 *
 * Triggered globally by Cmd+Shift+F (or by opening via the internal store /
 * the `alpha-system-search-open` window event). Searches across every kind of
 * data the OS knows about:
 *   - Memories (Akasha)        → GET /api/alpha/akasha
 *   - Files                    → GET /api/alpha/files?path=… (directory listings)
 *   - Apps                     → DOCK_APPS (in-memory)
 *   - Open windows             → useOS.windows
 *   - Chat messages            → useEvolution.chat
 *   - Plans / Goals            → useEvolution.plans / goals
 *
 * Results are grouped by category. Clicking a result opens the relevant app or
 * focuses the relevant window. Search input is debounced 300ms to avoid
 * re-filtering on every keystroke.
 */
"use client";

import { create } from "zustand";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  FileText,
  Folder,
  Goal,
  ListChecks,
  Monitor,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { DOCK_APPS, type AppKind } from "@/lib/alpha/os-types";
import { useMounted } from "@/lib/alpha/use-mounted";
import { cn } from "@/lib/utils";

// ---- Internal store ----
interface SystemSearchStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useSystemSearch = create<SystemSearchStore>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

// ---- Result model ----
type ResultCategory = "apps" | "windows" | "files" | "memories" | "chat" | "plans" | "goals";

interface SearchResult {
  id: string;
  category: ResultCategory;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const CATEGORY_META: Record<ResultCategory, { label: string; accent: string; icon: typeof FileText }> = {
  apps: { label: "Apps", accent: "text-[oklch(0.82_0.17_195)]", icon: Monitor },
  windows: { label: "Windows", accent: "text-[oklch(0.85_0.16_85)]", icon: Monitor },
  files: { label: "Files", accent: "text-[oklch(0.74_0.22_300)]", icon: FileText },
  memories: { label: "Memories", accent: "text-[oklch(0.7_0.18_145)]", icon: Sparkles },
  chat: { label: "Chat", accent: "text-[oklch(0.74_0.22_300)]", icon: Bot },
  plans: { label: "Plans", accent: "text-[oklch(0.82_0.17_195)]", icon: ListChecks },
  goals: { label: "Goals", accent: "text-[oklch(0.85_0.16_85)]", icon: Goal },
};

const CATEGORY_ORDER: ResultCategory[] = [
  "apps",
  "windows",
  "files",
  "memories",
  "chat",
  "plans",
  "goals",
];

// ---- File index (fetched on open) ----
interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

const FILE_SCAN_PATHS = [
  "src",
  "src/components/alpha",
  "src/lib/alpha",
  "src/app/api/alpha",
];

interface AkashaResponse {
  memory?: { id: string; text: string; kind: string; time: number }[];
  intentions?: unknown[];
  plans?: { id: string; goal: string; rationale: string; status: string; steps: { text: string; done: boolean }[]; time: number }[];
  goals?: { id: string; text: string; level: "long" | "medium" | "short"; time: number }[];
  events?: unknown[];
}

interface FilesResponse {
  type: "dir" | "file";
  path: string;
  entries?: { name: string; isDir: boolean }[];
}

/**
 * SystemSearch — the universal search overlay. Mount once near the OS root.
 */
export function SystemSearch() {
  const open = useSystemSearch((s) => s.open);
  const setOpen = useSystemSearch((s) => s.setOpen);

  const mounted = useMounted();

  const openApp = useOS((s) => s.openApp);
  const focusWindow = useOS((s) => s.focusWindow);
  const windows = useOS((s) => s.windows);

  const chat = useEvolution((s) => s.chat);
  const plans = useEvolution((s) => s.plans);
  const goals = useEvolution((s) => s.goals);
  const toggleChat = useEvolution((s) => s.toggleChat);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [memories, setMemories] = useState<{ id: string; text: string; kind: string; time: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+Shift+F listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(!useSystemSearch.getState().open);
      } else if (e.key === "Escape" && useSystemSearch.getState().open) {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("alpha-system-search-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("alpha-system-search-open", onOpen);
    };
  }, [setOpen]);

  // Reset state + prefetch data when opening.
  useEffect(() => {
    if (!open) return;
    Promise.resolve().then(() => {
      setQuery("");
      setDebounced("");
      setSelectedIdx(0);
      inputRef.current?.focus();
    });
    // Prefetch files + memories in parallel.
    let cancelled = false;
    Promise.resolve().then(() => setLoading(true));
    Promise.all([
      ...FILE_SCAN_PATHS.map(async (p): Promise<FileEntry[]> => {
        try {
          const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(p)}`);
          if (!res.ok) return [];
          const data = (await res.json()) as FilesResponse;
          if (!data.entries) return [];
          return data.entries.map((e) => ({ name: e.name, path: `${p}/${e.name}`, isDir: e.isDir }));
        } catch {
          return [];
        }
      }),
      (async (): Promise<{ id: string; text: string; kind: string; time: number }[]> => {
        try {
          const res = await fetch("/api/alpha/akasha");
          if (!res.ok) return [];
          const data = (await res.json()) as AkashaResponse;
          return data.memory ?? [];
        } catch {
          return [];
        }
      })(),
    ])
      .then((results) => {
        if (cancelled) return;
        const allFiles = results.slice(0, -1).flat() as FileEntry[];
        const mem = results[results.length - 1] as { id: string; text: string; kind: string; time: number }[];
        setFiles(allFiles);
        setMemories(mem);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounce the query — 300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Build the full result set (unfiltered — we filter by `debounced` next).
  const allResults = useMemo<SearchResult[]>(() => {
    const results: SearchResult[] = [];

    // Apps
    for (const a of DOCK_APPS) {
      results.push({
        id: `app-${a.kind}`,
        category: "apps",
        title: a.label,
        subtitle: a.defaultTitle,
        icon: <span className="font-mono-ae text-xs">{a.icon}</span>,
        onClick: () => openApp(a.kind as AppKind),
      });
    }

    // Open windows
    for (const w of windows) {
      results.push({
        id: `win-${w.id}`,
        category: "windows",
        title: w.title,
        subtitle: `desktop ${w.desktop + 1}${w.minimized ? " · minimized" : ""}`,
        icon: <span className="font-mono-ae text-xs">{w.icon}</span>,
        onClick: () => focusWindow(w.id),
      });
    }

    // Files
    for (const f of files) {
      results.push({
        id: `file-${f.path}`,
        category: "files",
        title: f.name,
        subtitle: f.path,
        icon: f.isDir ? <Folder className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />,
        onClick: () => openApp("editor", { data: { path: f.path }, title: f.name }),
      });
    }

    // Memories
    for (const m of memories) {
      results.push({
        id: `mem-${m.id}`,
        category: "memories",
        title: m.text.slice(0, 80),
        subtitle: `akasha · ${m.kind}`,
        icon: <Sparkles className="h-3.5 w-3.5" />,
        onClick: () => openApp("memory"),
      });
    }

    // Chat
    for (const msg of chat) {
      results.push({
        id: `chat-${msg.id}`,
        category: "chat",
        title: msg.content.slice(0, 80),
        subtitle: `${msg.role} · ${mounted ? new Date(msg.time).toLocaleTimeString() : "—"}`,
        icon: <Bot className="h-3.5 w-3.5" />,
        onClick: () => toggleChat(),
      });
    }

    // Plans
    for (const p of plans) {
      const done = p.steps.filter((s) => s.done).length;
      results.push({
        id: `plan-${p.id}`,
        category: "plans",
        title: p.goal,
        subtitle: `${p.status} · ${done}/${p.steps.length} steps`,
        icon: <ListChecks className="h-3.5 w-3.5" />,
        onClick: () => openApp("evolution"),
      });
    }

    // Goals
    for (const g of goals) {
      results.push({
        id: `goal-${g.id}`,
        category: "goals",
        title: g.text,
        subtitle: `goal · ${g.level}-term`,
        icon: <Goal className="h-3.5 w-3.5" />,
        onClick: () => openApp("evolution"),
      });
    }

    return results;
  }, [windows, files, memories, chat, plans, goals, openApp, focusWindow, toggleChat, mounted]);

  // Filter by debounced query.
  const filtered = useMemo<SearchResult[]>(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return allResults.slice(0, 50); // show first 50 by default
    return allResults
      .filter((r) => {
        const hay = `${r.title} ${r.subtitle ?? ""} ${r.category}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 80);
  }, [debounced, allResults]);

  // Group filtered results by category (preserving CATEGORY_ORDER).
  const grouped = useMemo(() => {
    const map = new Map<ResultCategory, SearchResult[]>();
    for (const r of filtered) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return CATEGORY_ORDER
      .map((cat) => ({ cat, items: map.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  // Flat index for keyboard navigation across all visible groups.
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);
  const safeIdx = flat.length === 0 ? 0 : Math.min(selectedIdx, flat.length - 1);

  // Clamp selection when the result set changes.
  useEffect(() => {
    Promise.resolve().then(() => {
      if (selectedIdx >= flat.length) setSelectedIdx(0);
    });
  }, [flat.length, selectedIdx]);

  const execute = (r?: SearchResult) => {
    const target = r ?? flat[safeIdx];
    if (!target) return;
    setOpen(false);
    Promise.resolve().then(() => target.onClick());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, flat.length - 1));
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

  // Helper: is this result currently selected?
  const isSelected = (r: SearchResult) => flat[safeIdx]?.id === r.id;

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
            className="glass-strong mt-[8vh] w-[92vw] max-w-3xl overflow-hidden rounded-2xl border border-border/60 shadow-2xl"
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
                placeholder="Search apps, files, memories, chat, plans, goals…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                spellCheck={false}
                autoComplete="off"
              />
              {loading && (
                <span className="font-mono-ae text-[0.6rem] text-muted-foreground">indexing…</span>
              )}
              <kbd className="rounded-md border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono-ae text-[0.6rem] text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="scroll-ae max-h-[65vh] overflow-y-auto p-2">
              {flat.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {debounced
                    ? `No results for "${debounced}"`
                    : "Start typing to search across the entire OS…"}
                </div>
              ) : (
                grouped.map((group) => {
                  const meta = CATEGORY_META[group.cat];
                  const GIcon = meta.icon;
                  return (
                    <div key={group.cat} className="mb-2">
                      {/* Group header */}
                      <div className="flex items-center gap-2 px-3 py-1.5">
                        <GIcon className={cn("h-3 w-3", meta.accent)} />
                        <span className={cn("eyebrow", meta.accent)}>{meta.label}</span>
                        <span className="ml-auto font-mono-ae text-[0.55rem] text-muted-foreground">
                          {group.items.length}
                        </span>
                      </div>
                      {/* Items */}
                      {group.items.map((r) => {
                        const sel = isSelected(r);
                        return (
                          <button
                            key={r.id}
                            onMouseEnter={() => {
                              const i = flat.findIndex((f) => f.id === r.id);
                              if (i >= 0) setSelectedIdx(i);
                            }}
                            onClick={() => execute(r)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all",
                              sel ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-card/40",
                                meta.accent
                              )}
                            >
                              {r.icon}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-foreground">{r.title}</div>
                              {r.subtitle && (
                                <div className="truncate font-mono-ae text-[0.65rem] text-muted-foreground">
                                  {r.subtitle}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
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
                  open
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  <kbd className="rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono-ae">⇧⌘F</kbd>
                  toggle
                </span>
              </div>
              <span className="font-mono-ae">
                {flat.length} result{flat.length === 1 ? "" : "s"}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
