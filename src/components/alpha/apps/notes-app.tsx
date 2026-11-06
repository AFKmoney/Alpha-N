/**
 * notes-app.tsx — Alpha-OS Markdown Notes.
 *
 * Purpose: a self-contained markdown notes app — hand-rolled markdown renderer
 * (headings, bold/italic, inline code, fenced code, links, ordered/unordered
 * lists, blockquotes, hr, paragraphs — NO parser dependency), note list with
 * search, split editor with live preview, create/rename/delete/export, and a
 * 400ms debounced auto-save to localStorage with a "saved" flash.
 *
 * Browser-API compatibility:
 *  - localStorage wrapped in try/catch (falls back to in-memory session).
 *  - Export uses Blob + object URL (universal); everything else needs nothing
 *    beyond the DOM.
 */
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Plus, Search, Trash2, Download, PencilLine, Eye, Columns2, FileText, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// ============================ MARKDOWN RENDERER =============================

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" }
  | { kind: "p"; text: string };

/** Parse markdown into block tokens (line-based, hand-rolled). */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    // paragraph: fold consecutive plain lines together
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

/** Render inline markdown (code / bold / italic / links) as React nodes. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <code key={`${keyBase}c${idx}`} className="rounded bg-[--ae-cyan]/10 px-1 py-0.5 font-mono-ae text-[0.85em] text-[--ae-cyan]">
          {m[1]}
        </code>
      );
    } else if (m[2] !== undefined) {
      out.push(
        <strong key={`${keyBase}b${idx}`} className="font-semibold text-zinc-100">
          {m[2]}
        </strong>
      );
    } else if (m[3] !== undefined) {
      out.push(
        <em key={`${keyBase}i${idx}`} className="text-zinc-300">
          {m[3]}
        </em>
      );
    } else if (m[4] !== undefined && m[5] !== undefined) {
      out.push(
        <a
          key={`${keyBase}a${idx}`}
          href={m[5]}
          target="_blank"
          rel="noreferrer"
          className="text-[--ae-cyan] underline decoration-[--ae-cyan]/40 underline-offset-2 hover:text-glow-cyan"
        >
          {m[4]}
        </a>
      );
    }
    last = m.index + m[0].length;
    idx += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Presentational markdown viewer (module-level component — never re-created). */
function MarkdownView({ md }: { md: string }) {
  const blocks = parseBlocks(md);
  if (!blocks.length) {
    return <p className="text-xs italic text-zinc-500">Nothing to preview yet — start writing.</p>;
  }
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-zinc-300">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "heading": {
            const sizes = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-xs"];
            return (
              <div
                key={k}
                className={cn(
                  "font-semibold text-zinc-100",
                  sizes[b.level - 1],
                  "first:mt-0",
                  b.level <= 2 && "border-b border-white/10 pb-1"
                )}
              >
                {renderInline(b.text, k)}
              </div>
            );
          }
          case "code":
            return (
              <pre
                key={k}
                className="scroll-ae overflow-x-auto rounded-lg border border-[--ae-amethyst]/20 bg-black/40 p-2.5 font-mono-ae text-[11px] leading-relaxed text-[--ae-amethyst]"
              >
                {b.lang ? <span className="mb-1 block text-[9px] uppercase tracking-widest text-zinc-500">{b.lang}</span> : null}
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={k} className="border-l-2 border-[--ae-gold]/50 bg-[--ae-gold]/5 px-3 py-1.5 text-zinc-300">
                {b.lines.map((l, j) => (
                  <p key={j}>{renderInline(l, `${k}q${j}`)}</p>
                ))}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={k} className="ml-4 list-disc space-y-1 marker:text-[--ae-cyan]">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `${k}u${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="ml-4 list-decimal space-y-1 marker:text-[--ae-cyan]">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `${k}o${j}`)}</li>
                ))}
              </ol>
            );
          case "hr":
            return <hr key={k} className="border-white/10" />;
          case "p":
          default:
            return (
              <p key={k}>
                {renderInline(b.text, k)}
              </p>
            );
        }
      })}
    </div>
  );
}

// ================================= DATA TYPES ================================

type Note = { id: string; title: string; content: string; createdAt: number; updatedAt: number };

const NOTES_KEY = "alpha-os:notes:v1";
const ACTIVE_KEY = "alpha-os:notes:active";

function loadNotes(): Note[] {
  try {
    const raw = window.localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is Note =>
        typeof n === "object" && n !== null &&
        typeof (n as Note).id === "string" &&
        typeof (n as Note).content === "string"
    );
  } catch {
    return [];
  }
}

/** Title fallback: first non-empty markdown line, stripped of # and markup. */
function deriveTitle(note: Note): string {
  if (note.title.trim()) return note.title.trim();
  const first = note.content.split("\n").find((l) => l.trim());
  const clean = (first ?? "").replace(/^#{1,6}\s*/, "").replace(/[*`[\]]/g, "").trim();
  return clean.slice(0, 48) || "Untitled";
}

function preview(note: Note): string {
  const body = note.content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const text = (body[0] ?? note.content).replace(/[*`>#]/g, "").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "Empty note";
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ================================== THE APP ==================================

type ViewMode = "edit" | "preview" | "split";

export function NotesApp({ windowId: _windowId }: { windowId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("split");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Deferred hydration (never setState synchronously in effect).
  useEffect(() => {
    Promise.resolve().then(() => {
      const stored = loadNotes();
      setNotes(stored);
      try {
        const savedActive = window.localStorage.getItem(ACTIVE_KEY);
        if (savedActive && stored.some((n) => n.id === savedActive)) setActiveId(savedActive);
        else setActiveId(stored[0]?.id ?? null);
      } catch {
        setActiveId(stored[0]?.id ?? null);
      }
      setHydrated(true);
    });
  }, []);

  // Debounced auto-save (400ms) once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        window.localStorage.setItem(ACTIVE_KEY, activeId ?? "");
        setSavedAt(Date.now());
      } catch {
        /* ignore quota errors */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [notes, activeId, hydrated]);

  // Auto-clear the "saved" flash shortly after it appears.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 1400);
    return () => clearTimeout(t);
  }, [savedAt]);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const filtered = notes
    .filter((n) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        deriveTitle(n).toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const createNote = () => {
    const now = Date.now();
    const note: Note = { id: newId(), title: "", content: "", createdAt: now, updatedAt: now };
    setNotes((p) => [note, ...p]);
    setActiveId(note.id);
    setConfirmDelete(false);
    setMode("edit");
  };

  const patchNote = (id: string, patch: Partial<Note>) => {
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)));
  };

  const deleteNote = (id: string) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
      return;
    }
    const rest = notes.filter((n) => n.id !== id);
    setNotes(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
    setConfirmDelete(false);
  };

  const exportNote = () => {
    if (!active) return;
    try {
      const title = deriveTitle(active);
      const body = `# ${title}\n\n${active.content}`;
      const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "note"}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable — ignore */
    }
  };

  return (
    <div className="flex h-full bg-[--ae-obsidian-deep]">
      {/* sidebar */}
      <aside className="glass flex w-56 shrink-0 flex-col rounded-none border-y-0 border-l-0">
        <div className="space-y-2 border-b border-white/10 p-2.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Notes</span>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={createNote}
              className="flex items-center gap-1 rounded-full border border-[--ae-cyan]/30 bg-[--ae-cyan]/10 px-2 py-0.5 text-[10px] text-[--ae-cyan] transition-colors hover:bg-[--ae-cyan]/20"
            >
              <Plus className="h-3 w-3" /> new
            </motion.button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="h-7 border-white/10 bg-white/[0.04] pl-7 text-xs"
            />
          </div>
        </div>
        <div className="scroll-ae min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="whitespace-pre-line px-2 py-6 text-center text-[10px] leading-relaxed text-zinc-500">
              {notes.length === 0 ? "No notes yet.\nCreate your first one." : "No matches."}
            </p>
          )}
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setActiveId(n.id);
                setConfirmDelete(false);
              }}
              className={cn(
                "block w-full rounded-lg border px-2 py-1.5 text-left transition-colors",
                n.id === activeId
                  ? "border-[--ae-cyan]/30 bg-[--ae-cyan]/10"
                  : "border-transparent hover:bg-white/5"
              )}
            >
              <span className="block truncate text-xs font-medium text-zinc-200">{deriveTitle(n)}</span>
              <span className="block truncate text-[10px] leading-snug text-zinc-500">{preview(n)}</span>
              <span className="mt-0.5 block font-mono-ae text-[9px] text-zinc-600">
                {format(n.updatedAt, "MMM d · HH:mm")}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* editor / preview */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-500">
            <FileText className="h-8 w-8 text-zinc-700" />
            <p className="text-xs">Select or create a note.</p>
            <p className="text-[10px] text-zinc-600">Markdown supported · autosaves locally</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Input
                value={active.title}
                onChange={(e) => patchNote(active.id, { title: e.target.value })}
                placeholder={deriveTitle({ ...active, title: "" })}
                className="h-7 flex-1 border-transparent bg-transparent text-sm font-semibold focus-visible:border-white/10"
              />
              <AnimatePresence>
                {savedAt !== null && (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-[10px] text-[--ae-emerald]"
                  >
                    <Check className="h-3 w-3" /> saved
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-0.5 rounded-full border border-white/10 p-0.5">
                {(
                  [
                    { m: "edit" as ViewMode, icon: PencilLine },
                    { m: "split" as ViewMode, icon: Columns2 },
                    { m: "preview" as ViewMode, icon: Eye },
                  ]
                ).map(({ m, icon: Icon }) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    aria-label={`${m} view`}
                    className={cn(
                      "rounded-full p-1 transition-colors",
                      mode === m ? "bg-[--ae-amethyst]/20 text-[--ae-amethyst]" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={exportNote}
                aria-label="Export as .md"
                className="rounded-full p-1 text-zinc-500 transition-colors hover:text-[--ae-gold]"
              >
                <Download className="h-3.5 w-3.5" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => deleteNote(active.id)}
                aria-label="Delete note"
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  confirmDelete
                    ? "border-[--ae-rose]/50 bg-[--ae-rose]/15 text-[--ae-rose]"
                    : "border-transparent text-zinc-500 hover:border-[--ae-rose]/30 hover:text-[--ae-rose]"
                )}
              >
                <Trash2 className="h-3 w-3" />
                {confirmDelete ? "sure?" : ""}
              </motion.button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
              {mode !== "preview" && (
                <textarea
                  value={active.content}
                  onChange={(e) => patchNote(active.id, { content: e.target.value })}
                  spellCheck={false}
                  placeholder={"# Hello\n\nWrite **markdown** here…"}
                  className={cn(
                    "scroll-ae min-h-32 w-full resize-none bg-transparent p-3 font-mono-ae text-xs leading-relaxed text-zinc-300 placeholder:text-zinc-600 focus:outline-none",
                    mode === "split" && "border-r border-white/10"
                  )}
                />
              )}
              {mode !== "edit" && (
                <div className="scroll-ae min-h-0 overflow-y-auto p-3">
                  <MarkdownView md={active.content} />
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default NotesApp;
