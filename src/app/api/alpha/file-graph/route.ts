/**
 * /api/alpha/file-graph — builds a real-time dependency graph of the OS source.
 *
 * The OS IS the AI's context. Instead of loading every file into the LLM's
 * context window, the AI navigates this graph: it sees the structure, picks
 * a node (file), reads its contents, follows edges (imports) to related files,
 * and modifies only what it needs. This keeps the context tiny while giving
 * the AI total awareness of the entire OS.
 *
 * GET /api/alpha/file-graph
 *   Returns { nodes: [{id, path, kind, size, lines}], edges: [{from, to, type}] }
 *
 * GET /api/alpha/file-graph?path=src/lib/alpha/os-store.ts
 *   Returns the same graph but scoped to the imports of one file (the AI
 *   "zooms in" on a node and sees its neighbourhood).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { PROJECT_ROOT } from "@/lib/alpha/paths";

export const runtime = "nodejs";

const SCAN_DIRS = ["src", "mini-services", "prisma"];

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

/** Extract import paths from source code (TS/TSX/JS). */
function parseImports(content: string): string[] {
  const imports: string[] = [];
  const re = /(?:import\s+[^;]+?\s+from\s+|import\s+|require\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/** Resolve an import specifier to a relative file path. */
function resolveImport(spec: string, fromFile: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".") && !spec.startsWith("/")) {
    return null;
  }
  let resolved = spec;
  if (spec.startsWith("@/")) {
    resolved = "src/" + spec.slice(2);
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    resolved = path.join(path.dirname(fromFile), spec);
  }
  return resolved;
}

/** Recursively scan a directory and build the node list. */
async function scanDir(
  dir: string,
  relBase: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>
): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const node: GraphNode = { id: relPath, path: relPath, kind: "dir", ext: "", lines: 0, size: 0 };
      nodes.push(node);
      nodeMap.set(relPath, node);
      await scanDir(fullPath, relPath, nodes, edges, nodeMap);
    } else {
      const ext = path.extname(entry.name);
      if (![".ts", ".tsx", ".js", ".jsx", ".rs", ".prisma", ".css", ".json", ".md"].includes(ext)) continue;

      let content = "";
      let stat;
      try {
        stat = await fs.stat(fullPath);
        content = await fs.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n").length;
      const node: GraphNode = { id: relPath, path: relPath, kind: "file", ext, lines, size: stat.size };
      nodes.push(node);
      nodeMap.set(relPath, node);

      if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        const imports = parseImports(content);
        for (const imp of imports) {
          const resolved = resolveImport(imp, relPath);
          if (resolved) {
            edges.push({ from: relPath, to: resolved, type: "import" });
          }
        }
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const focusPath = searchParams.get("path");

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();

  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    await scanDir(fullPath, dir, nodes, edges, nodeMap);
  }

  let resultNodes = nodes;
  let resultEdges = edges;
  if (focusPath) {
    const neighbors = new Set<string>([focusPath]);
    for (const e of edges) {
      if (e.from === focusPath) neighbors.add(e.to);
      if (e.to === focusPath) neighbors.add(e.from);
    }
    resultNodes = nodes.filter((n) => neighbors.has(n.id));
    resultEdges = edges.filter((e) => neighbors.has(e.from) && neighbors.has(e.to));
  }

  const totalLines = nodes.reduce((sum, n) => sum + n.lines, 0);

  const graph: FileGraph = {
    nodes: resultNodes,
    edges: resultEdges,
    stats: {
      totalFiles: nodes.filter((n) => n.kind === "file").length,
      totalDirs: nodes.filter((n) => n.kind === "dir").length,
      totalLines,
      totalEdges: edges.length,
    },
  };

  return NextResponse.json(graph);
}
