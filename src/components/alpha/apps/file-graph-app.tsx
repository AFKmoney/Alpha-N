/**
 * file-graph-app.tsx — the OS file graph explorer.
 *
 * The OS IS the AI's context. This app visualizes the entire OS source as an
 * interactive graph: nodes = files/sectors, edges = import dependencies.
 * The AI (and the user) can navigate this graph, click any node to read/edit
 * the file, and see how everything connects.
 *
 * By navigating the graph instead of loading every file, the AI never exceeds
 * its context window — it only loads what it's looking at right now.
 */
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, X, Search, FileCode, Folder, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

interface GraphNode {
  id: string;
  path: string;
  kind: "file" | "dir";
  ext: string;
  lines: number;
  size: number;
}

interface GraphEdge {
  from: string;
  to: string;
  type: "import" | "contains";
}

interface FileGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalFiles: number;
    totalDirs: number;
    totalLines: number;
    totalEdges: number;
  };
}

// Color map by file extension
const EXT_COLORS: Record<string, string> = {
  ".ts": "oklch(0.82 0.17 195)",
  ".tsx": "oklch(0.82 0.17 195)",
  ".js": "oklch(0.85 0.16 85)",
  ".jsx": "oklch(0.85 0.16 85)",
  ".rs": "oklch(0.74 0.22 300)",
  ".prisma": "oklch(0.7 0.18 145)",
  ".css": "oklch(0.7 0.22 15)",
  ".json": "oklch(0.65 0.02 265)",
  ".md": "oklch(0.6 0.02 265)",
};

export function FileGraphApp({ windowId: _windowId }: { windowId?: string } = {}) {
  const [graph, setGraph] = useState<FileGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch the file graph
  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const url = focusPath
        ? `/api/alpha/file-graph?path=${encodeURIComponent(focusPath)}`
        : "/api/alpha/file-graph";
      const res = await fetch(url);
      const data = (await res.json()) as FileGraph;
      setGraph(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [focusPath]);

  useEffect(() => {
    Promise.resolve().then(() => loadGraph());
  }, [loadGraph]);

  // Listen for file changes (after AI writes/creates files)
  useEffect(() => {
    const onFileChange = () => loadGraph();
    window.addEventListener("alpha-files-refresh", onFileChange);
    return () => window.removeEventListener("alpha-files-refresh", onFileChange);
  }, [loadGraph]);

  // Read a file's contents when a node is clicked
  const openFile = useCallback(async (path: string) => {
    setViewingFile(path);
    setFileContent(null);
    try {
      const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.type === "file") {
        setFileContent(data.content || "");
      }
    } catch {
      setFileContent("Failed to load file.");
    }
  }, []);

  // Compute node positions in a radial layout
  const positioned = computeLayout(graph);

  // Filter by search
  const filteredNodes = search
    ? positioned.nodes.filter((n) => n.path.toLowerCase().includes(search.toLowerCase()))
    : positioned.nodes;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="font-mono-ae text-xs font-semibold text-[oklch(0.82_0.17_195)]">OS Graph</span>
        {focusPath && (
          <span className="truncate font-mono-ae text-[0.65rem] text-muted-foreground">
            focus: {focusPath}
          </span>
        )}
        <div className="flex-1" />
        {graph && (
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
            {graph.stats.totalFiles} files · {graph.stats.totalLines} lines · {graph.stats.totalEdges} edges
          </span>
        )}
        <button
          onClick={() => loadGraph()}
          className="rounded p-1 text-muted-foreground hover:bg-foreground/10"
          title="Refresh graph"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="flex-1 bg-transparent font-mono-ae text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        {focusPath && (
          <button
            onClick={() => setFocusPath(null)}
            className="font-mono-ae text-[0.6rem] text-muted-foreground hover:text-foreground"
          >
            clear focus
          </button>
        )}
      </div>

      {/* Main area: graph + file viewer */}
      <div className="flex min-h-0 flex-1">
        {/* Graph visualization */}
        <div className="relative flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <svg
              ref={svgRef}
 className="h-full w-full"
              viewBox="0 0 1000 700"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Edges */}
              {positioned.edges.map((e, i) => {
                const from = positioned.nodes.find((n) => n.id === e.from);
                const to = positioned.nodes.find((n) => n.id === e.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={i}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="oklch(0.5 0.02 265 / 0.15)"
                    strokeWidth={0.5}
                  />
                );
              })}

              {/* Nodes */}
              {filteredNodes.map((n) => {
                const color = n.kind === "dir" ? "oklch(0.65 0.02 265)" : (EXT_COLORS[n.ext] ?? "oklch(0.7 0.02 265)");
                const isFocus = focusPath === n.id;
                return (
                  <g key={n.id} className="cursor-pointer" onClick={() => openFile(n.id)}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={isFocus ? 8 : n.kind === "dir" ? 5 : 4}
                      fill={color}
                      opacity={isFocus ? 1 : 0.7}
                      stroke={isFocus ? "oklch(0.95 0.02 265)" : "none"}
                      strokeWidth={isFocus ? 1 : 0}
                    >
                      <title>{n.path} ({n.lines} lines)</title>
                    </circle>
                    {(isFocus || n.lines > 100) && (
                      <text
                        x={n.x + 8}
                        y={n.y + 3}
                        className="font-mono-ae"
                        fontSize={6}
                        fill="oklch(0.7 0.02 265)"
                      >
                        {n.path.split("/").pop()}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {/* Legend */}
          <div className="absolute bottom-2 left-2 flex gap-3 rounded-lg border border-border/40 bg-card/60 p-2 font-mono-ae text-[0.55rem]">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: EXT_COLORS[".tsx"] }} /> tsx
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: EXT_COLORS[".rs"] }} /> rust
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: EXT_COLORS[".css"] }} /> css
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.02_265)]" /> dir
            </span>
          </div>
        </div>

        {/* File viewer sidebar */}
        <AnimatePresence>
          {viewingFile && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "45%", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex min-w-0 flex-col border-l border-border/50"
            >
              <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
                {viewingFile.endsWith("/") || !viewingFile.includes(".") ? (
                  <Folder className="h-3.5 w-3.5 text-[oklch(0.65_0.02_265)]" />
                ) : (
                  <FileCode className="h-3.5 w-3.5 text-[oklch(0.82_0.17_195)]" />
                )}
                <span className="truncate font-mono-ae text-[0.65rem] text-foreground">{viewingFile}</span>
                <div className="flex-1" />
                <button
                  onClick={() => setFocusPath(viewingFile)}
                  className="rounded p-1 text-muted-foreground hover:bg-foreground/10"
                  title="Focus graph on this file"
                >
                  <Eye className="h-3 w-3" />
                </button>
                <button
                  onClick={() => { setViewingFile(null); setFileContent(null); }}
                  className="rounded p-1 text-muted-foreground hover:bg-foreground/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="scroll-ae min-h-0 flex-1 overflow-auto p-2">
                {fileContent === null ? (
                  <div className="flex h-full items-center justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <pre className="font-mono-ae text-[0.65rem] leading-relaxed text-foreground/70 whitespace-pre-wrap break-all">
                    {fileContent.slice(0, 20000)}
                  </pre>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---- Layout: radial tree by directory depth ----
interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

function computeLayout(graph: FileGraph | null): { nodes: PositionedNode[]; edges: GraphEdge[] } {
  if (!graph) return { nodes: [], edges: [] };

  const nodes: PositionedNode[] = [];
  const cx = 500;
  const cy = 350;

  // Group by depth (directory nesting level)
  const byDepth = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const depth = n.path.split("/").length;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(n);
  }

  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  const maxDepth = depths[depths.length - 1] ?? 1;

  for (const depth of depths) {
    const group = byDepth.get(depth)!;
    const radius = (depth / maxDepth) * 280;
    const angleStep = (Math.PI * 2) / group.length;
    group.forEach((n, i) => {
      const angle = i * angleStep + depth * 0.3;
      nodes.push({
        ...n,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
  }

  return { nodes, edges: graph.edges };
}
