import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const MODELS_DIR = "/home/z/my-project/models";

/**
 * Scan the models/ folder for .gguf files.
 * Returns the list of available models the user can load in the Aether Engine.
 */
export async function GET() {
  try {
    const entries = await fs.readdir(MODELS_DIR, { withFileTypes: true });
    const models = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gguf"))
      .map((e) => {
        const name = e.name;
        // Try to get file size
        return { name, path: `models/${name}` };
      });

    // Also get sizes
    const modelsWithSize = await Promise.all(
      models.map(async (m) => {
        try {
          const stat = await fs.stat(path.join(MODELS_DIR, m.name));
          return { ...m, sizeMB: Math.round(stat.size / 1024 / 1024) };
        } catch {
          return { ...m, sizeMB: 0 };
        }
      })
    );

    return NextResponse.json({
      models: modelsWithSize,
      folder: MODELS_DIR,
    });
  } catch {
    return NextResponse.json({ models: [], folder: MODELS_DIR, error: "Models folder not found" });
  }
}
