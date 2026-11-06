/**
 * /api/alpha/models-list — scan the models/ folder for .gguf files so the
 * Aether provider can list them (name + human-readable size).
 */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const dir = path.join(process.cwd(), "models");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const models = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gguf"))
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name));
          return { name: e.name, size: stat.size, sizeLabel: formatBytes(stat.size) };
        })
    );
    return NextResponse.json({ ok: true, models });
  } catch {
    return NextResponse.json({ ok: true, models: [] });
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
