/**
 * /api/alpha/files — read/write real files inside the project root.
 * Reads (GET) return file contents or directory listings. Writes (POST)
 * are blocked for protected paths (kernel/, prisma/schema.prisma, .env,
 * Caddyfile) and path-traversal attempts. This is how the AI inspects
 * and modifies its own source.
 */
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

// POST — multi-purpose write/create endpoint.
// Body fields:
//   { path, content }              → write file contents (create vector)
//   { path, action: "mkdir" }      → create a sector (directory)
//   { path, action: "touch" }      → create an empty vector (file)
//   { from, to, action: "move" }   → move/rename a sector or vector
//   { from, to, action: "copy" }   → copy a sector or vector
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string | undefined;

    // ---- MOVE / RENAME ----
    if (action === "move") {
      const { from, to } = body as { from: string; to: string };
      if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 });
      if (isProtected(from) || isProtected(to)) {
        return NextResponse.json({ error: "SECURITY: protected path. Move blocked." }, { status: 403 });
      }
      const fullFrom = resolveSafe(from);
      const fullTo = resolveSafe(to);
      if (!fullFrom || !fullTo) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(path.dirname(fullTo), { recursive: true });
      await fs.rename(fullFrom, fullTo);
      return NextResponse.json({ ok: true, from, to });
    }

    // ---- COPY ----
    if (action === "copy") {
      const { from, to } = body as { from: string; to: string };
      if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 });
      if (isProtected(from)) {
        return NextResponse.json({ error: "SECURITY: protected path. Copy blocked." }, { status: 403 });
      }
      const fullFrom = resolveSafe(from);
      const fullTo = resolveSafe(to);
      if (!fullFrom || !fullTo) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(path.dirname(fullTo), { recursive: true });
      await fs.copyFile(fullFrom, fullTo);
      return NextResponse.json({ ok: true, from, to });
    }

    // ---- MKDIR (create sector) ----
    if (action === "mkdir") {
      const { path: relPath } = body as { path: string };
      if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });
      if (isProtected(relPath)) {
        return NextResponse.json({ error: "SECURITY: protected path. Sector creation blocked." }, { status: 403 });
      }
      const full = resolveSafe(relPath);
      if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(full, { recursive: true });
      return NextResponse.json({ ok: true, path: relPath, created: "sector" });
    }

    // ---- TOUCH (create empty vector) ----
    if (action === "touch") {
      const { path: relPath } = body as { path: string };
      if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });
      if (isProtected(relPath)) {
        return NextResponse.json({ error: "SECURITY: protected path. Vector creation blocked." }, { status: 403 });
      }
      const full = resolveSafe(relPath);
      if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, "", "utf-8");
      return NextResponse.json({ ok: true, path: relPath, created: "vector" });
    }

    // ---- DEFAULT: write file contents (create/update vector) ----
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

    // ensure parent sector exists
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
    return NextResponse.json({ ok: true, path: relPath, bytes: content.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — delete a sector (directory, recursive) or vector (file).
// Query: ?path=<relPath>
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const relPath = searchParams.get("path");
    if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });

    if (isProtected(relPath)) {
      return NextResponse.json(
        { error: `SECURITY: ${relPath} is a protected kernel file. Deletion blocked.` },
        { status: 403 }
      );
    }

    const full = resolveSafe(relPath);
    if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });

    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await fs.rm(full, { recursive: true });
    } else {
      await fs.unlink(full);
    }
    return NextResponse.json({ ok: true, deleted: relPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
