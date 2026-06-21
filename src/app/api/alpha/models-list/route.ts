import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { PROJECT_ROOT } from "@/lib/alpha/paths";

export const runtime = "nodejs";

/**
 * Scan the models/ folder for .gguf files.
 * Returns the list of available models the user can load in the Aether Engine.
 *
 * Uses the cross-platform PROJECT_ROOT (derived from cwd/env) so it works on
 * Windows, macOS, and Linux. Previously this was hardcoded to
 * /home/z/my-project/models, which only existed on the original Linux box —
 * every other machine got an empty list.
 */
export async function GET() {
  const modelsDir = path.join(PROJECT_ROOT, "models");
  try {
    const entries = await fs.readdir(modelsDir, { withFileTypes: true });
    const models = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gguf"))
      .map((e) => ({ name: e.name, path: `models/${e.name}` }));

    // Attach file sizes (best-effort).
    const modelsWithSize = await Promise.all(
      models.map(async (m) => {
        try {
          const stat = await fs.stat(path.join(modelsDir, m.name));
          return { ...m, sizeMB: Math.round(stat.size / 1024 / 1024) };
        } catch {
          return { ...m, sizeMB: 0 };
        }
      })
    );

    return NextResponse.json({
      models: modelsWithSize,
      folder: modelsDir,
    });
  } catch {
    return NextResponse.json({
      models: [],
      folder: modelsDir,
      error: "Models folder not found (looked in " + modelsDir + ")",
    });
  }
}
