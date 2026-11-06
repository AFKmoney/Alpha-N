/**
 * real-code-editor.tsx — reads ACTUAL project files via /api/alpha/files.
 * File-tree sidebar (expandable directories) + real source with syntax
 * tinting, auto-refreshing every 3s so AI write_file mutations show up
 * live. The AI reads and writes real disk — this shows the truth.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileEntry {
  name: string;
  isDir: boolean;
}

function tintLine(line: string): string {
  if (/^\s*(\/\/|\/\*|\*|#)/.test(line)) return "text-zinc-500";
  if (/\b(import|export|function|return|const|let|async|await|class)\b/.test(line)) return "text-[--ae-cyan]";
  if (/\b(if|else|for|while|switch|case|break|try|catch)\b/.test(line)) return "text-[--ae-amethyst]";
  return "text-zinc-300";
}

export function RealCodeEditor(): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [openDirs, setOpenDirs] = useState<Record<string, FileEntry[]>>({ "src/": [] });
  const [selected, setSelected] = useState<string>("src/app/page.tsx");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const listDir = useCallback(async (path: string): Promise<FileEntry[]> => {
    try {
      const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
      const data = (await res.json()) as { type?: string; entries?: FileEntry[] };
      return data.type === "dir" ? (data.entries ?? []) : [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(async () => {
      const root = await listDir("src");
      setTree(root);
    });
  }, [listDir]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(selected)}`);
        const data = (await res.json()) as { type?: string; content?: string; error?: string };
        if (alive) setContent(data.type === "file" ? (data.content ?? "") : (data.error ?? ""));
      } catch {
        if (alive) setContent("// read failed");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selected]);

  const toggleDir = useCallback(
    async (path: string) => {
      if (openDirs[path]) {
        const next = { ...openDirs };
        delete next[path];
        setOpenDirs(next);
        return;
      }
      const entries = await listDir(path);
      setOpenDirs((prev) => ({ ...prev, [path]: entries }));
    },
    [openDirs, listDir]
  );

  const renderEntries = (entries: FileEntry[], parent: string, depth: number): React.ReactNode =>
    entries.map((entry) => {
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      return (
        <div key={path}>
          <button
            type="button"
            onClick={() => (entry.isDir ? void toggleDir(path) : setSelected(path))}
            className={cn(
              "font-mono-ae flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] hover:bg-white/6",
              selected === path ? "bg-[--ae-cyan]/12 text-[--ae-cyan]" : "text-zinc-400"
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {entry.isDir ? (
              <>
                {openDirs[path] ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <Folder className="h-3 w-3 shrink-0 text-[--ae-gold]/80" />
              </>
            ) : (
              <FileIcon className="ml-3.5 h-3 w-3 shrink-0 opacity-60" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.isDir && openDirs[path] && renderEntries(openDirs[path], path, depth + 1)}
        </div>
      );
    });

  const lines = content.split("\n");

  return (
    <div className="flex h-full">
      <div className="scroll-ae w-52 shrink-0 overflow-y-auto border-r border-white/8 p-2">
        <p className="eyebrow mb-1.5 px-1">project tree</p>
        {renderEntries(tree, "", 0)}
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
          <span className="font-mono-ae truncate text-[11px] text-zinc-300">{selected}</span>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500" data-ai-skip>
            {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
            <span className="text-[--ae-emerald]">live · 3s</span>
          </div>
        </div>
        <div className="scroll-ae font-mono-ae flex-1 overflow-auto p-3 text-[11px] leading-5">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="mr-3 w-8 shrink-0 select-none text-right text-zinc-600">{i + 1}</span>
              <span className={cn("whitespace-pre-wrap break-all", tintLine(line))}>{line || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RealCodeEditor;
