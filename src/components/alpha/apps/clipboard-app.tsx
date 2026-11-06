/**
 * clipboard-app.tsx — Alpha-OS Clipboard History.
 *
 * Purpose: captures clipboard text via navigator.clipboard.readText() on
 * window focus + a manual "Capture" button, keeps the last 50 unique entries,
 * supports pin-to-top, search, one-click copy-back (with execCommand fallback)
 * and localStorage persistence.
 *
 * Browser-API compatibility:
 *  - navigator.clipboard.readText() is Chromium/Safari-only and requires a
 *    focused document + permission → denial/unsupported states show a guidance
 *    panel instead of failing silently.
 *  - Copy-back uses navigator.clipboard.writeText() with a
 *    document.execCommand("copy") fallback for non-secure contexts.
 *  - localStorage wrapped in try/catch.
 */
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ClipboardPaste, ClipboardCheck, Pin, PinOff, Search, Trash2, AlertCircle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ================================= DATA TYPES ================================

type ClipEntry = { id: string; text: string; ts: number; pinned: boolean };

type CaptureStatus = "idle" | "ok" | "denied" | "unsupported" | "empty";

const KEY = "alpha-os:clipboard:v1";
const MAX_ENTRIES = 50;

function loadEntries(): ClipEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ClipEntry =>
          typeof e === "object" && e !== null &&
          typeof (e as ClipEntry).text === "string"
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Legacy copy fallback for non-secure contexts / missing async clipboard. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ================================== THE APP ==================================

export function ClipboardApp({ windowId: _windowId }: { windowId?: string }) {
  const [entries, setEntries] = useState<ClipEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Deferred hydration from localStorage.
  useEffect(() => {
    Promise.resolve().then(() => {
      setEntries(loadEntries());
      setHydrated(true);
    });
  }, []);

  // Persist whenever entries change.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* ignore quota errors */
    }
  }, [entries, hydrated]);

  const addEntry = (text: string) => {
    setEntries((prev) => {
      const existing = prev.find((e) => e.text === text);
      const rest = prev.filter((e) => e.text !== text);
      const entry: ClipEntry = {
        id: existing?.id ?? newId(),
        text,
        ts: Date.now(),
        pinned: existing?.pinned ?? false,
      };
      return [entry, ...rest].slice(0, MAX_ENTRIES);
    });
  };

  /** Try to read the clipboard; classify the outcome for the guidance UI. */
  const capture = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      setStatus("unsupported");
      return;
    }
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text.trim()) {
          setStatus("empty");
          return;
        }
        addEntry(text);
        setStatus("ok");
      })
      .catch(() => setStatus("denied"));
  };

  // Auto-capture on window focus, plus one attempt shortly after mount.
  useEffect(() => {
    const onFocus = () => capture();
    window.addEventListener("focus", onFocus);
    Promise.resolve().then(() => capture());
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Clear the "copied" flash.
  useEffect(() => {
    if (copiedId === null) return;
    const t = setTimeout(() => setCopiedId(null), 1200);
    return () => clearTimeout(t);
  }, [copiedId]);

  const copyBack = (entry: ClipEntry) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(entry.text)
        .then(() => setCopiedId(entry.id))
        .catch(() => {
          if (legacyCopy(entry.text)) setCopiedId(entry.id);
        });
    } else if (legacyCopy(entry.text)) {
      setCopiedId(entry.id);
    }
  };

  const togglePin = (id: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e)));
  };

  const clearUnpinned = () => setEntries((prev) => prev.filter((e) => e.pinned));

  const visible = entries
    .filter((e) => {
      const q = query.trim().toLowerCase();
      return !q || e.text.toLowerCase().includes(q);
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts);

  const pinnedCount = entries.filter((e) => e.pinned).length;

  return (
    <div className="flex h-full flex-col gap-2 bg-(--ae-obsidian-deep) p-2.5">
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Clipboard History</span>
        <div className="flex items-center gap-1.5">
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={capture}
            className="flex items-center gap-1.5 rounded-full border border-(--ae-cyan)/30 bg-(--ae-cyan)/10 px-3 py-1 text-[11px] text-(--ae-cyan) transition-colors hover:bg-(--ae-cyan)/20"
          >
            <ClipboardPaste className="h-3 w-3" /> Capture
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={clearUnpinned}
            disabled={entries.length === pinnedCount}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-(--ae-rose)/40 hover:text-(--ae-rose) disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-zinc-400"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </motion.button>
        </div>
      </div>

      {/* status / guidance */}
      <AnimatePresence mode="wait" initial={false}>
        {status === "unsupported" && (
          <motion.div
            key="unsupported"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2 rounded-lg border border-(--ae-gold)/30 bg-(--ae-gold)/10 px-3 py-2 text-[11px] leading-relaxed text-(--ae-gold)">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This browser does not expose <code className="font-mono-ae">navigator.clipboard.readText()</code>. Copy as
                usual — entries you add here persist, but automatic capture is unavailable.
              </span>
            </div>
          </motion.div>
        )}
        {status === "denied" && (
          <motion.div
            key="denied"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2 rounded-lg border border-(--ae-rose)/30 bg-(--ae-rose)/10 px-3 py-2 text-[11px] leading-relaxed text-(--ae-rose)">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Clipboard read was blocked. Browsers require the page to be focused and the clipboard-read permission —
                click <strong>Capture</strong> to grant it, or paste manually and try again.
              </span>
            </div>
          </motion.div>
        )}
        {status !== "unsupported" && status !== "denied" && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 px-0.5 text-[10px] text-zinc-500"
          >
            <Info className="h-3 w-3 shrink-0" />
            <span>
              Auto-captures on window focus · {status === "ok" ? "last capture succeeded" : status === "empty" ? "clipboard was empty" : "grant clipboard-read on first Capture"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entries…"
          className="h-8 border-white/10 bg-white/[0.04] pl-8 text-xs"
        />
      </div>

      {/* entries */}
      <div className="scroll-ae min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
            <ClipboardPaste className="h-8 w-8 text-zinc-700" />
            <p className="text-xs">{entries.length === 0 ? "Nothing captured yet." : "No matching entries."}</p>
            <p className="text-[10px] text-zinc-600">Copy text anywhere, then return to this window.</p>
          </div>
        )}
        {visible.map((e) => (
          <motion.div
            key={e.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "group relative cursor-pointer rounded-lg border px-2.5 py-2 transition-colors",
              e.pinned
                ? "border-(--ae-gold)/30 bg-(--ae-gold)/[0.06]"
                : "border-white/10 bg-white/[0.03] hover:border-(--ae-cyan)/30 hover:bg-(--ae-cyan)/[0.05]"
            )}
            onClick={() => copyBack(e)}
          >
            <p className="scroll-ae max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono-ae text-[11px] leading-relaxed text-zinc-300">
              {e.text}
            </p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono-ae text-[9px] text-zinc-600">{format(e.ts, "MMM d · HH:mm:ss")}</span>
              <div className="flex items-center gap-1">
                <AnimatePresence>
                  {copiedId === e.id && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-0.5 text-[9px] text-(--ae-emerald)"
                    >
                      <ClipboardCheck className="h-3 w-3" /> copied
                    </motion.span>
                  )}
                </AnimatePresence>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    togglePin(e.id);
                  }}
                  aria-label={e.pinned ? "Unpin" : "Pin"}
                  className={cn(
                    "rounded p-0.5 transition-colors",
                    e.pinned ? "text-(--ae-gold)" : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-(--ae-gold)"
                  )}
                >
                  {e.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center justify-between font-mono-ae text-[9px] text-zinc-600">
        <span>{entries.length} / {MAX_ENTRIES} entries</span>
        <span>{pinnedCount} pinned · pinned survive Clear</span>
      </div>
    </div>
  );
}

export default ClipboardApp;
