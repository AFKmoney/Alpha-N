/**
 * /api/alpha/files — real filesystem access for the AI and the Files app.
 *
 * GET  ?path=            → read a file (content) or list a directory (entries)
 * POST {path, content}   → write a file (security-checked)
 * POST {path, action}    → mkdir | touch
 *
 * The Security Foundation is enforced server-side: kernel/ paths can never
 * be read or written through this route.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const PROJECT_ROOT = process.cwd();

function resolveSafe(rawPath: string): string | null {
  const clean = (rawPath || "").replace(/^\/+/, "");
  if (!clean) return PROJECT_ROOT;
  const abs = path.resolve(PROJECT_ROOT, clean);
  if (!abs.startsWith(PROJECT_ROOT)) return null;
  if (/(^|\/)kernel(\/|$)/.test(clean) && !clean.startsWith("src/kernel-")) return null;
  return abs;
}

async function logSecurityEvent(path: string, reason: string) {
  try {
    await db.systemEvent.create({
      data: { type: "security", content: JSON.stringify({ path, reason, time: Date.now() }) },
    });
  } catch {
    // security logging must never throw
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path") ?? "";
  const abs = resolveSafe(raw);
  if (abs === null) {
    return NextResponse.json({ error: `SECURITY: '${raw}' is a protected kernel path.` }, { status: 403 });
  }
  try {
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      const dirents = await fs.readdir(abs, { withFileTypes: true });
      return NextResponse.json({
        type: "dir",
        path: raw || ".",
        entries: dirents
          .filter((d) => !d.name.startsWith(".") && d.name !== "node_modules" && d.name !== ".next")
          .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
          .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)),
      });
    }
    const content = await fs.readFile(abs, "utf8");
    return NextResponse.json({ type: "file", path: raw, content: content.slice(0, 200_000) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "read failed" }, { status: 404 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { path?: string; content?: string; action?: string };
    const raw = body.path ?? "";
    const abs = resolveSafe(raw);
    if (abs === null) {
      await logSecurityEvent(raw, "write blocked: protected kernel path");
      return NextResponse.json({ error: `SECURITY: '${raw}' is a protected kernel file. Write blocked.` }, { status: 403 });
    }

    if (body.action === "mkdir") {
      await fs.mkdir(abs, { recursive: true });
      return NextResponse.json({ ok: true, path: raw });
    }
    if (body.action === "touch") {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", { flag: "wx" }).catch(async () => {
        // file already exists — touch is a no-op
      });
      return NextResponse.json({ ok: true, path: raw });
    }

    const content = typeof body.content === "string" ? body.content : "";
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return NextResponse.json({ ok: true, path: raw, bytes: content.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "write failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path") ?? "";
  const abs = resolveSafe(raw);
  if (abs === null || abs === PROJECT_ROOT) {
    await logSecurityEvent(raw, "delete blocked: protected kernel path");
    return NextResponse.json({ error: `SECURITY: '${raw}' cannot be deleted.` }, { status: 403 });
  }
  try {
    await fs.rm(abs, { recursive: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "delete failed" }, { status: 500 });
  }
}
