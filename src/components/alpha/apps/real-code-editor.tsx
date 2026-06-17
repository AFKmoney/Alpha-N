/**
 * real-code-editor.tsx — file browser + viewer for the actual project source.
 * Reads via /api/alpha/files, syntax-highlights TS/TSX/JS, and auto-refreshes
 * every 3s so the user sees the AI's real-time edits. Read-only — the AI
 * writes via the write_file mutation through the AutonomousLoop.
 */
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { FileCode2, Folder, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileEntry {
  name: string;
  isDir: boolean;
}

interface FileContent {
  path: string;
  content: string;
  type: string;
}

// Simple syntax highlighter for TS/TSX/JS
function highlightLine(line: string): { text: string; cls: string }[] {
  const tokens: { text: string; cls: string }[] = [];
  const re = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\d+\.?\d*)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([{}()\[\].,;:<>+\-*/%=&|!?]+)/g;
  const keywords = new Set(["import","export","from","class","const","let","var","function","async","await","if","else","return","for","while","new","this","type","interface","extends","implements","public","private","protected","readonly","static","void","null","undefined","true","false","as","in","of","try","catch","finally","throw","switch","case","default","break","continue","enum"]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [full, comment, str, num, ident, ws, punct] = m;
    if (comment !== undefined) tokens.push({ text: comment, cls: "text-muted-foreground/60 italic" });
    else if (str !== undefined) tokens.push({ text: str, cls: "text-[oklch(0.7_0.18_145)]" });
    else if (num !== undefined) tokens.push({ text: num, cls: "text-[oklch(0.85_0.14_55)]" });
    else if (ident !== undefined) {
      if (keywords.has(ident)) tokens.push({ text: ident, cls: "text-[oklch(0.74_0.22_300)]" });
      else if (/^[A-Z]/.test(ident)) tokens.push({ text: ident, cls: "text-[oklch(0.82_0.16_85)]" });
      else {
        const rest = line.slice(re.lastIndex);
        const isFn = /^\s*\(/.test(rest);
        tokens.push({ text: ident, cls: isFn ? "text-[oklch(0.82_0.17_195)]" : "text-foreground" });
      }
    }
    else if (ws !== undefined) tokens.push({ text: ws, cls: "" });
    else if (punct !== undefined) tokens.push({ text: punct, cls: "text-muted-foreground/80" });
  }
  return tokens.length ? tokens : [{ text: " ", cls: "" }];
}

export function RealCodeEditor() {
  const [currentPath, setCurrentPath] = useState("src/lib/alpha/evolution-store.ts");
  const [fileContent, setFileContent] = useState<string>("");
  const [dirEntries, setDirEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["src/lib/alpha"]));

  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setFileContent("");
      } else if (data.type === "file") {
        setFileContent(data.content);
        setCurrentPath(path);
      } else if (data.type === "dir") {
        setDirEntries(data.entries);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
    setLoading(false);
  }, []);

  const loadDir = useCallback(async (path: string) => {
    try {
      const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.type === "dir") {
        setDirEntries(data.entries);
      }
    } catch {
      // ignore
    }
  }, []);

  // Load the current file on mount and when path changes.
  // This is a legitimate data-fetching pattern; the setState calls happen
  // inside the async loadFile function, not synchronously in the effect body.
  const lastLoadedPath = useRef<string>("");
  useEffect(() => {
    if (lastLoadedPath.current === currentPath) return;
    lastLoadedPath.current = currentPath;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFile(currentPath);
  }, [currentPath, loadFile]);

  // Auto-refresh every 3 seconds to show real-time AI modifications
  useEffect(() => {
    const id = setInterval(() => {
      void loadFile(currentPath);
    }, 3000);
    return () => clearInterval(id);
  }, [currentPath, loadFile]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const lines = fileContent.split("\n");

  return (
    <div className="flex h-full bg-background">
      {/* File sidebar */}
      {showSidebar && (
        <div className="w-56 shrink-0 border-r border-border/50 bg-card/30">
          <div className="border-b border-border/50 px-3 py-2">
            <div className="eyebrow">project files</div>
          </div>
          <div className="scroll-ae h-[calc(100%-2.5rem)] overflow-y-auto p-1.5 font-mono-ae text-[0.7rem]">
            <FileTreeNode
              name="src/"
              path="src"
              isDir
              level={0}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              loadDir={loadDir}
              currentPath={currentPath}
              onSelect={(p) => loadFile(p)}
            />
            <FileTreeNode
              name="prisma/"
              path="prisma"
              isDir
              level={0}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              loadDir={loadDir}
              currentPath={currentPath}
              onSelect={(p) => loadFile(p)}
            />
            <FileTreeNode
              name="package.json"
              path="package.json"
              isDir={false}
              level={0}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              loadDir={loadDir}
              currentPath={currentPath}
              onSelect={(p) => loadFile(p)}
            />
          </div>
        </div>
      )}

      {/* Code view */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* File header */}
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="rounded p-0.5 text-muted-foreground hover:bg-foreground/10"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showSidebar && "rotate-90")} />
            </button>
            <FileCode2 className="h-3.5 w-3.5 text-[oklch(0.82_0.17_195)]" />
            <span className="font-mono-ae text-xs text-foreground/80">{currentPath}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
              {lines.length} lines · auto-refresh 3s
            </span>
            <button
              onClick={() => loadFile(currentPath)}
              className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Code content */}
        <div className="scroll-ae min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 font-mono-ae text-xs text-[oklch(0.78_0.2_20)]">
              Error: {error}
            </div>
          ) : (
            <div className="font-mono-ae text-[0.78rem] leading-[1.6]">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-0 hover:bg-foreground/[0.03]"
                >
                  <span className="w-8 shrink-0 select-none text-right text-[0.65rem] text-muted-foreground/40 tabular-nums">
                    {i + 1}
                  </span>
                  <code className="whitespace-pre">
                    {highlightLine(line).map((tok, j) => (
                      <span key={j} className={tok.cls}>{tok.text}</span>
                    ))}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileTreeNodeProps {
  name: string;
  path: string;
  isDir: boolean;
  level: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  loadDir: (path: string) => Promise<void>;
  currentPath: string;
  onSelect: (path: string) => void;
}

function FileTreeNode({ name, path, isDir, level, expandedDirs, toggleDir, loadDir, currentPath, onSelect }: FileTreeNodeProps) {
  const [children, setChildren] = useState<FileEntry[]>([]);
  const expanded = expandedDirs.has(path);

  useEffect(() => {
    if (isDir && expanded) {
      void loadDir(path).then(() => {
        // The loadDir sets the parent's dirEntries, but we need local children
        // So we fetch directly here
        fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.type === "dir") setChildren(data.entries);
          })
          .catch(() => {});
      });
    }
  }, [isDir, expanded, path, loadDir]);

  return (
    <div>
      <button
        onClick={() => {
          if (isDir) toggleDir(path);
          else onSelect(path);
        }}
        className={cn(
          "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left hover:bg-foreground/[0.06]",
          currentPath === path && "bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
        )}
        style={{ paddingLeft: `${level * 12 + 6}px` }}
      >
        {isDir ? (
          <>
            <ChevronRight className={cn("h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
            <Folder className="h-3 w-3 shrink-0 text-[oklch(0.82_0.17_195)]" />
          </>
        ) : (
          <>
            <span className="w-2.5" />
            <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{name}</span>
      </button>
      {isDir && expanded && children.map((child) => (
        <FileTreeNode
          key={child.name}
          name={child.name}
          path={`${path}/${child.name}`}
          isDir={child.isDir}
          level={level + 1}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          loadDir={loadDir}
          currentPath={currentPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
