import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

// The project root — the AI can read/write files within this boundary.
const PROJECT_ROOT = "/home/z/my-project";

// Paths the AI must NEVER write to (security foundation mirror).
const PROTECTED_PATHS = [
  "kernel/",
  "prisma/schema.prisma",
  ".env",
  "Caddyfile",
];

function isProtected(relPath: string): boolean {
  return PROTECTED_PATHS.some((p) => relPath.startsWith(p) || relPath === p);
}

function resolveSafe(relPath: string): string | null {
  // Normalize and prevent path traversal
  const cleaned = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(PROJECT_ROOT, cleaned);
  // ensure it's within the project root
  if (!full.startsWith(PROJECT_ROOT)) return null;
  return full;
}

// GET — read a file's contents
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const relPath = searchParams.get("path");
  if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });

  const full = resolveSafe(relPath);
  if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });

  try {
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(full, { withFileTypes: true });
      return NextResponse.json({
        type: "dir",
        path: relPath,
        entries: entries.map((e) => ({ name: e.name, isDir: e.isDirectory() })),
      });
    }
    const content = await fs.readFile(full, "utf-8");
    return NextResponse.json({
      type: "file",
      path: relPath,
      content,
      size: stat.size,
    });
  } catch {
    return NextResponse.json({ error: "file not found", path: relPath }, { status: 404 });
  }
}

// POST — write a file's contents (with security checks)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { path: relPath, content } = body as { path: string; content: string };
    if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });

    if (isProtected(relPath)) {
      return NextResponse.json(
        { error: `SECURITY: ${relPath} is a protected kernel file. Write blocked.` },
        { status: 403 }
      );
    }

    const full = resolveSafe(relPath);
    if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });

    // ensure parent dir exists
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
    return NextResponse.json({ ok: true, path: relPath, bytes: content.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
