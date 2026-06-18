import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Wallpaper API — manages persistent wallpaper selection.
 * GET  /api/alpha/wallpaper          → get active wallpaper { presetId, config }
 * GET  /api/alpha/wallpaper?list=true → list all saved custom wallpapers
 * POST /api/alpha/wallpaper           → set active wallpaper { presetId, config, name? }
 * POST /api/alpha/wallpaper?action=save → save a custom wallpaper
 * DELETE /api/alpha/wallpaper?id=...    → delete a custom wallpaper
 */

// GET — get active wallpaper or list saved wallpapers
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list");

  try {
    if (list === "true") {
      // List all saved custom wallpapers
      const wallpapers = await db.wallpaper.findMany({
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({
        wallpapers: wallpapers.map((w) => ({
          id: w.id,
          name: w.name,
          presetId: w.presetId,
          config: JSON.parse(w.config),
          isCustom: w.isCustom,
        })),
      });
    }

    // Get active wallpaper from UserPreference
    const pref = await db.userPreference.findUnique({
      where: { key: "activeWallpaper" },
    });

    if (pref) {
      return NextResponse.json(JSON.parse(pref.value));
    }

    // Default wallpaper
    return NextResponse.json({ presetId: "obsidian-oil", config: {}, name: "Obsidian Oil" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

// POST — set active wallpaper or save a new custom one
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "save") {
      // Save a new custom wallpaper
      const created = await db.wallpaper.create({
        data: {
          name: body.name || "Custom Wallpaper",
          presetId: body.presetId,
          config: JSON.stringify(body.config || {}),
          isCustom: true,
        },
      });
      return NextResponse.json({ ok: true, id: created.id });
    }

    if (action === "delete") {
      await db.wallpaper.delete({ where: { id: body.id } });
      return NextResponse.json({ ok: true });
    }

    // Default action: set active wallpaper
    const wallpaperData = {
      presetId: body.presetId,
      config: body.config || {},
      name: body.name || body.presetId,
    };

    await db.userPreference.upsert({
      where: { key: "activeWallpaper" },
      create: { key: "activeWallpaper", value: JSON.stringify(wallpaperData) },
      update: { value: JSON.stringify(wallpaperData) },
    });

    return NextResponse.json({ ok: true, wallpaper: wallpaperData });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
