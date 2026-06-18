/**
 * clipboard-app.tsx — clipboard history manager.
 *
 * Features:
 * - Reads `navigator.clipboard.readText()` on window focus + on a manual
 *   "Capture" button (requires clipboard-read permission, may prompt the user)
 * - Stores the last 50 unique clipboard entries with timestamps
 * - Click any entry to copy it back to the system clipboard
 * - Pin important clips (pinned entries stay at the top)
 * - Search filter, "Clear all" button
 * - Persists to localStorage so history survives reloads
 *
 * Browser compatibility notes:
 * - `navigator.clipboard.readText()` requires HTTPS, a secure context, and the
 *   clipboard-read permission. In some browsers (e.g. Firefox) it always
 *   prompts; in others (Chrome) it silently succeeds after permission grant.
 * - Safari requires a user gesture for clipboard reads; the manual Capture
 *   button satisfies that.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pin, PinOff, Search, Trash2, Clipboard, ClipboardCheck, X, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ClipboardAppProps {
  windowId?: string;
}

interface ClipEntry {
  id: string;
  text: string;
  time: number;
  pinned: boolean;
}

const STORAGE_KEY = "alpha-clipboard-history";
const MAX_ENTRIES = 50;

/** Load persisted clipboard history from localStorage. */
function loadHistory(): ClipEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClipEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Persist history to localStorage. */
function persistHistory(entries: ClipEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable — non-fatal
  }
}

/** Format timestamp as a relative "5s ago / 3m ago / 2h ago" string. */
function relativeTime(t: number): string {
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * ClipboardApp — capture, browse, search, pin, and replay clipboard history.
 */
export function ClipboardApp({ windowId: _windowId }: ClipboardAppProps = {}) {
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState | "unknown" | "unsupported">("unknown");
  const [captureFlash, setCaptureFlash] = useState(false);

  // Load history + check clipboard-read permission on mount. Wrapped in a
  // microtask so the setState calls are not synchronous in the effect body.
  useEffect(() => {
    Promise.resolve().then(() => {
      setHistory(loadHistory());
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        setPermission("unsupported");
        return;
      }
      if (navigator.permissions) {
        navigator.permissions
          .query({ name: "clipboard-read" as PermissionName })
          .then((p) => {
            setPermission(p.state);
            p.onchange = () => setPermission(p.state);
          })
          .catch(() => setPermission("unknown"));
      }
    });
  }, []);

  /** Persist whenever history changes. */
  useEffect(() => {
    persistHistory(history);
  }, [history]);

  /**
   * Capture the current system clipboard content. If it's new (different from
   * the most recent entry), prepend it. Requires a secure context + permission.
   */
  const captureClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      setPermission("unsupported");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      setHistory((prev) => {
        if (prev.length > 0 && prev[0].text === text && !prev[0].pinned) {
          // bump timestamp on the most-recent entry
          return [{ ...prev[0], time: Date.now() }, ...prev.slice(1)];
        }
        const entry: ClipEntry = {
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text,
          time: Date.now(),
          pinned: false,
        };
        // de-dupe by content (preserve most-recent)
        const deduped = prev.filter((e) => e.text !== text);
        return [entry, ...deduped].slice(0, MAX_ENTRIES);
      });
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 800);
    } catch {
      // permission denied or non-secure context — nothing we can do
      setPermission("denied");
    }
  }, []);

  // Auto-capture on window focus (most browsers allow this once permission is granted)
  useEffect(() => {
    const onFocus = () => { void captureClipboard(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void captureClipboard();
    });
    return () => window.removeEventListener("focus", onFocus);
  }, [captureClipboard]);

  /** Copy an entry back to the system clipboard. */
  const copyBack = useCallback(async (entry: ClipEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
    } catch {
      // Fallback: legacy execCommand. Best-effort, may not work everywhere.
      try {
        const ta = document.createElement("textarea");
        ta.value = entry.text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopiedId(entry.id);
        setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
      } catch {
        // copy failed entirely — ignore
      }
    }
  }, []);

  /** Toggle the pinned state of an entry. Pinned entries float to the top. */
  const togglePin = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e));
      // sort: pinned first (preserve relative order), then by time desc
      return updated.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.time - a.time;
      });
    });
  }, []);

  /** Delete a single entry. */
  const deleteEntry = useCallback((id: string) => {
    setHistory((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /** Clear all non-pinned entries. Pinned entries are preserved. */
  const clearAll = useCallback(() => {
    setHistory((prev) => prev.filter((e) => e.pinned));
  }, []);

  /** Clear absolutely everything including pinned entries. */
  const clearEverything = useCallback(() => {
    setHistory([]);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return history;
    const q = query.toLowerCase();
    return history.filter((e) => e.text.toLowerCase().includes(q));
  }, [history, query]);

  const pinnedCount = history.filter((e) => e.pinned).length;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clipboard className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
            <h3 className="font-mono-ae text-sm font-semibold">Clipboard History</h3>
          </div>
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
            {history.length} / {MAX_ENTRIES} · {pinnedCount} pinned
          </span>
        </div>

        {/* Search + actions */}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clips…"
              className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={captureClipboard}
            className={cn(
              "h-8 px-2.5 font-mono-ae text-xs",
              captureFlash && "border-[oklch(0.7_0.18_145)] text-[oklch(0.7_0.18_145)]"
            )}
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", captureFlash && "animate-spin")} />
            Capture
          </Button>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={pinnedCount > 0 ? clearAll : clearEverything}
              className="h-8 px-2.5 font-mono-ae text-xs text-muted-foreground hover:text-[oklch(0.7_0.2_15)]"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {pinnedCount > 0 ? "Clear" : "Clear all"}
            </Button>
          )}
        </div>

        {/* Permission warning */}
        {permission === "denied" && (
          <p className="mt-2 font-mono-ae text-[0.6rem] text-[oklch(0.7_0.2_15)]/80">
            Clipboard read permission denied. Click "Capture" to retry — your browser may prompt again.
          </p>
        )}
        {permission === "unsupported" && (
          <p className="mt-2 font-mono-ae text-[0.6rem] text-[oklch(0.85_0.16_85)]/80">
            Clipboard reading is not supported in this browser. Use a Chromium-based or Firefox browser over HTTPS.
          </p>
        )}
      </header>

      {/* History list */}
      <ScrollArea className="flex-1">
        <ul className="space-y-1.5 p-3">
          {filtered.length === 0 ? (
            <li className="flex flex-col items-center gap-2 py-12 text-muted-foreground/60">
              <Clipboard className="h-8 w-8 opacity-40" />
              <p className="font-mono-ae text-xs">
                {history.length === 0 ? "No clips yet — copy something & click Capture." : "No matches."}
              </p>
            </li>
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn(
                    "group rounded-md border bg-card/30 p-2.5 transition-all",
                    entry.pinned
                      ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/[0.04]"
                      : "border-border/40 hover:border-border/70"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono-ae text-[0.55rem] text-muted-foreground/70">
                      {relativeTime(entry.time)}
                      {entry.pinned && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[oklch(0.85_0.16_85)]">
                          <Pin className="h-2.5 w-2.5" />
                          pinned
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => togglePin(entry.id)}
                        title={entry.pinned ? "Unpin" : "Pin"}
                        className={cn(
                          "rounded p-1 text-muted-foreground hover:bg-card/60 hover:text-foreground",
                          entry.pinned && "text-[oklch(0.85_0.16_85)]"
                        )}
                      >
                        {entry.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        title="Delete"
                        className="rounded p-1 text-muted-foreground hover:bg-card/60 hover:text-[oklch(0.7_0.2_15)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => copyBack(entry)}
                    className="block w-full text-left"
                    title="Click to copy"
                  >
                    <pre className="scroll-ae max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono-ae text-xs text-foreground/85">
                      {entry.text}
                    </pre>
                  </button>
                  <div className="mt-1.5 flex items-center justify-end">
                    {copiedId === entry.id ? (
                      <span className="font-mono-ae flex items-center gap-1 text-[0.6rem] text-[oklch(0.7_0.18_145)]">
                        <ClipboardCheck className="h-3 w-3" />
                        copied
                      </span>
                    ) : (
                      <span className="font-mono-ae flex items-center gap-1 text-[0.6rem] text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <Copy className="h-3 w-3" />
                        click to copy
                      </span>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}

export default ClipboardApp;
