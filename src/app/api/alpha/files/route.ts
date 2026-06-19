/**
 * /api/alpha/files — read/write real files inside the project root.
 *
 * Security:
 *   • All paths resolved through resolveSafe() (paths.ts) — traversal-proof
 *     across Windows/Linux/macOS via path.relative escape detection.
 *   • Kernel paths (kernel/, prisma/schema.prisma, .env, Caddyfile) are
 *     write-protected regardless of autonomy level.
 *   • Symlinks are resolved and re-checked: a symlink that points outside
 *     the project is rejected on read AND write.
 *
 * Reads (GET) return file contents or directory listings.
 * Writes (POST) handle: write contents, mkdir, touch, move, copy.
 * DELETE removes a file or directory (recursive).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { PROJECT_ROOT, resolveSafe } from "@/lib/alpha/paths";

export const runtime = "nodejs";

// Paths the AI must NEVER write to (mirrors the kernel SECURITY_FOUNDATION).
// These are sacred even in yolo autonomy mode.
const PROTECTED_PATHS = [
  "kernel/",
  "prisma/schema.prisma",
  ".env",
  "Caddyfile",
  ".git/",
];

function isProtected(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  return PROTECTED_PATHS.some((p) => norm === p || norm.startsWith(p));
}

/**
 * Resolve a user-supplied path AND verify the real on-disk target (after
 * symlink resolution) is still inside the project. Returns null if the path
 * escapes the root or is otherwise unsafe.
 */
async function resolveAndVerify(relPath: string): Promise<string | null> {
  const full = resolveSafe(relPath);
  if (!full) return null;
  try {
    // If the file/dir already exists, resolve symlinks and re-check containment.
    const real = await fs.realpath(full);
    const rel = path.relative(PROJECT_ROOT, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return full;
  } catch {
    // Doesn't exist yet (write path) — the lexical resolveSafe check is enough.
    return full;
  }
}

// GET — read a file's contents
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const relPath = searchParams.get("path");
  if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });

  const full = await resolveAndVerify(relPath);
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
    // Cap read size to avoid loading huge files into context.
    if (stat.size > 2_000_000) {
      return NextResponse.json({
        type: "file",
        path: relPath,
        content: `(file too large: ${(stat.size / 1024).toFixed(0)}KB — truncated)`,
        size: stat.size,
        truncated: true,
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
      const fullFrom = await resolveAndVerify(from);
      const fullTo = await resolveAndVerify(to);
      if (!fullFrom || !fullTo) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(path.dirname(fullTo), { recursive: true });
      await fs.rename(fullFrom, fullTo);
      return NextResponse.json({ ok: true, from, to });
    }

    // ---- COPY ----
    if (action === "copy") {
      const { from, to } = body as { from: string; to: string };
      if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 });
      if (isProtected(from) || isProtected(to)) {
        return NextResponse.json({ error: "SECURITY: protected path. Copy blocked." }, { status: 403 });
      }
      const fullFrom = await resolveAndVerify(from);
      const fullTo = await resolveAndVerify(to);
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
      const full = await resolveAndVerify(relPath);
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
      const full = await resolveAndVerify(relPath);
      if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, "", "utf-8");
      return NextResponse.json({ ok: true, path: relPath, created: "vector" });
    }

    // ---- DEFAULT: write file contents (create/update vector) ----
    const { path: relPath, content } = body as { path: string; content: string };
    if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }
    if (content.length > 5_000_000) {
      return NextResponse.json({ error: "content too large (max 5MB)" }, { status: 413 });
    }

    if (isProtected(relPath)) {
      return NextResponse.json(
        { error: `SECURITY: ${relPath} is a protected kernel file. Write blocked.` },
        { status: 403 }
      );
    }

    const full = await resolveAndVerify(relPath);
    if (!full) return NextResponse.json({ error: "path traversal blocked" }, { status: 403 });

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
    return NextResponse.json({ ok: true, path: relPath, bytes: content.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — delete a sector (directory, recursive) or vector (file).
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

    const full = await resolveAndVerify(relPath);
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
