/**
 * notes-app.tsx — a markdown notes editor with live preview.
 *
 * Features:
 * - Left sidebar: list of notes (title + preview + timestamp), search filter
 * - Right pane: textarea editor with live markdown preview (split view)
 * - Create / rename / delete notes
 * - Auto-save to localStorage (debounced)
 * - Export the current note as a `.md` file download
 *
 * The markdown renderer is a tiny hand-rolled implementation (headings,
 * bold/italic, inline code, fenced code blocks, links, lists, blockquotes,
 * horizontal rules). It is intentionally minimal — sufficient for personal
 * notes without pulling in a full markdown parser dependency.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FilePlus, Trash2, Download, Search, X, FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface NotesAppProps {
  windowId?: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  createdAt: number;
}

const STORAGE_KEY = "alpha-notes";
const SAVE_DEBOUNCE_MS = 400;

/** Load notes from localStorage. Returns [] on any error. */
function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Note[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Escape HTML special characters. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a small subset of markdown to HTML.
 * Supported: headings (#..######), bold **..**, italic *..* / _.._, inline code
 * `..`, fenced code blocks ```..```, links [text](url), unordered lists (- / *),
 * ordered lists (1.), blockquotes (>), horizontal rules (---), paragraphs.
 */
function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join(" ");
    out.push(`<p>${inline(text)}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  /** Inline markdown: bold, italic, code, links. */
  function inline(s: string): string {
    let r = escapeHtml(s);
    // inline code first (so its content isn't re-processed)
    r = r.replace(/`([^`]+)`/g, (_m, c) => `<code class="rounded bg-card/60 px-1 py-0.5 font-mono-ae text-[0.85em] text-[oklch(0.82_0.17_195)]">${c}</code>`);
    // bold
    r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    r = r.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    // italic
    r = r.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    r = r.replace(/_([^_]+)_/g, "<em>$1</em>");
    // links
    r = r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" class="text-[oklch(0.82_0.17_195)] underline underline-offset-2" target="_blank" rel="noreferrer noopener">$1</a>');
    return r;
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (!inCode) {
        flushPara();
        closeList();
        inCode = true;
        codeBuf = [];
      } else {
        out.push(`<pre class="my-2 overflow-x-auto rounded-md border border-border/50 bg-card/60 p-3 font-mono-ae text-xs text-foreground/90"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
        codeBuf = [];
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr class="my-3 border-border/50" />');
      i++;
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      const sizes = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-xs"];
      out.push(`<h${level} class="mt-3 mb-1 font-semibold ${sizes[level - 1]}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      const q = line.replace(/^>\s?/, "");
      out.push(`<blockquote class="my-2 border-l-2 border-[oklch(0.85_0.16_85)]/60 pl-3 italic text-muted-foreground">${inline(q)}</blockquote>`);
      i++;
      continue;
    }
    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push('<ul class="my-1 ml-5 list-disc space-y-0.5">');
        listType = "ul";
      }
      const item = line.replace(/^\s*[-*]\s+/, "");
      out.push(`<li>${inline(item)}</li>`);
      i++;
      continue;
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push('<ol class="my-1 ml-5 list-decimal space-y-0.5">');
        listType = "ol";
      }
      const item = line.replace(/^\s*\d+\.\s+/, "");
      out.push(`<li>${inline(item)}</li>`);
      i++;
      continue;
    }
    // blank line → paragraph break
    if (line.trim() === "") {
      flushPara();
      closeList();
      i++;
      continue;
    }
    // paragraph accumulator
    paraBuf.push(line);
    i++;
  }
  flushPara();
  closeList();
  if (inCode && codeBuf.length > 0) {
    out.push(`<pre class="my-2 overflow-x-auto rounded-md border border-border/50 bg-card/60 p-3 font-mono-ae text-xs"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}

/** Build a preview snippet (first ~80 chars of plain content). */
function previewOf(content: string): string {
  const plain = content.replace(/[#*`>_~\-\[\]()]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain || "Empty note";
}

/** Derive a default title from the first non-empty markdown line. */
function titleFromContent(content: string): string {
  const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return "Untitled";
  return firstLine.replace(/^#+\s*/, "").replace(/[*_`~]/g, "").slice(0, 60) || "Untitled";
}

/**
 * NotesApp — markdown notes editor with live preview + persistence.
 */
export function NotesApp({ windowId: _windowId }: NotesAppProps = {}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load — wrapped in a microtask so the setState call is not
  // synchronous inside the effect body (lint-clean).
  useEffect(() => {
    Promise.resolve().then(() => {
      const loaded = loadNotes();
      setNotes(loaded);
      if (loaded.length > 0) setActiveId(loaded[0].id);
    });
  }, []);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId]
  );

  // Persist notes (debounced auto-save)
  const persist = useCallback((next: Note[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
      } catch {
        // storage full — non-fatal
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /** Create a new empty note and focus it. */
  const createNote = useCallback(() => {
    const now = Date.now();
    const note: Note = {
      id: `note-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: "Untitled",
      content: "# Untitled\n\nStart writing…\n",
      createdAt: now,
      updatedAt: now,
    };
    const next = [note, ...notes];
    setNotes(next);
    setActiveId(note.id);
    persist(next);
  }, [notes, persist]);

  /** Update the active note's content (auto-derives title if user hasn't set one). */
  const updateContent = useCallback((content: string) => {
    if (!activeId) return;
    const next = notes.map((n) =>
      n.id === activeId
        ? {
            ...n,
            content,
            title: editingTitle ? n.title : titleFromContent(content),
            updatedAt: Date.now(),
          }
        : n
    );
    setNotes(next);
    persist(next);
  }, [activeId, notes, persist, editingTitle]);

  /** Delete the active note. */
  const deleteNote = useCallback((id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    persist(next);
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null);
    }
  }, [notes, activeId, persist]);

  /** Rename the active note. */
  const commitTitle = useCallback(() => {
    if (!activeId) return;
    const trimmed = titleDraft.trim() || "Untitled";
    const next = notes.map((n) =>
      n.id === activeId ? { ...n, title: trimmed, updatedAt: Date.now() } : n
    );
    setNotes(next);
    persist(next);
    setEditingTitle(false);
  }, [activeId, notes, persist, titleDraft]);

  /** Export the active note as a `.md` download. */
  const exportNote = useCallback((note: Note) => {
    const safeName = note.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "note";
    const blob = new Blob([note.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return notes;
    const q = query.toLowerCase();
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
    );
  }, [notes, query]);

  const previewHtml = useMemo(
    () => (activeNote ? renderMarkdown(activeNote.content) : ""),
    [activeNote]
  );

  return (
    <div className="flex h-full flex-col bg-background lg:flex-row">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border/50 bg-card/20 lg:w-72 lg:border-b-0 lg:border-r">
        <div className="border-b border-border/50 p-2.5">
          <Button
            onClick={createNote}
            size="sm"
            className="w-full bg-[oklch(0.82_0.17_195)] text-background hover:bg-[oklch(0.82_0.17_195)]/80"
          >
            <FilePlus className="mr-1.5 h-3.5 w-3.5" />
            New Note
          </Button>
        </div>
        <div className="border-b border-border/50 p-2.5">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <ul className="p-2">
            {filtered.length === 0 ? (
              <li className="px-2 py-6 text-center font-mono-ae text-xs text-muted-foreground/50">
                {notes.length === 0 ? "No notes yet." : "No matches."}
              </li>
            ) : (
              filtered.map((note) => (
                <li key={note.id}>
                  <button
                    onClick={() => setActiveId(note.id)}
                    className={cn(
                      "group mb-1 w-full rounded-md border px-2.5 py-2 text-left transition-all",
                      activeId === note.id
                        ? "border-[oklch(0.82_0.17_195)]/40 bg-card/60"
                        : "border-transparent hover:border-border/60 hover:bg-card/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 shrink-0 text-[oklch(0.85_0.16_85)]" />
                      <span className="font-mono-ae truncate text-xs font-medium text-foreground">
                        {note.title}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono-ae truncate text-[0.65rem] text-muted-foreground/70">
                      {previewOf(note.content)}
                    </div>
                    <div className="mt-0.5 font-mono-ae text-[0.55rem] text-muted-foreground/50">
                      {new Date(note.updatedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </aside>

      {/* Editor + preview */}
      <section className="flex min-h-0 flex-1 flex-col">
        {activeNote ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
              {editingTitle ? (
                <Input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  className="h-7 font-mono-ae text-sm"
                />
              ) : (
                <button
                  onClick={() => {
                    setTitleDraft(activeNote.title);
                    setEditingTitle(true);
                  }}
                  className="font-mono-ae truncate text-sm font-medium text-foreground hover:text-[oklch(0.82_0.17_195)]"
                >
                  {activeNote.title}
                </button>
              )}
              <AnimatePresence>
                {savedFlash && (
                  <motion.span
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="font-mono-ae flex items-center gap-1 text-[0.6rem] text-[oklch(0.7_0.18_145)]"
                  >
                    <Check className="h-3 w-3" />
                    saved
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportNote(activeNote)}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-[oklch(0.82_0.17_195)]"
                >
                  <Download className="mr-1 h-3 w-3" />
                  Export
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteNote(activeNote.id)}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-[oklch(0.7_0.2_15)]"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              </div>
            </div>

            {/* Split editor / preview */}
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
              <textarea
                value={activeNote.content}
                onChange={(e) => updateContent(e.target.value)}
                spellCheck={false}
                placeholder="# My note\n\nWrite markdown here…"
                className="scroll-ae min-h-0 w-full resize-none border-r border-border/50 bg-background/60 p-4 font-mono-ae text-sm leading-relaxed text-foreground/90 focus:outline-none"
              />
              <ScrollArea className="min-h-0 bg-card/10">
                <div
                  className="prose-ae p-4 font-sans text-sm leading-relaxed text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </ScrollArea>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="font-mono-ae text-sm">No note selected.</p>
            <Button
              onClick={createNote}
              size="sm"
              className="bg-[oklch(0.82_0.17_195)] text-background hover:bg-[oklch(0.82_0.17_195)]/80"
            >
              <FilePlus className="mr-1.5 h-3.5 w-3.5" />
              Create your first note
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

export default NotesApp;
