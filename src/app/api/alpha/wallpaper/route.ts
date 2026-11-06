/**
 * /api/alpha/wallpaper — active wallpaper persistence.
 * GET returns the active wallpaper, POST {action:"set",…} upserts it.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db.wallpaper.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
    const active = rows[0]
      ? {
          id: rows[0].id,
          name: rows[0].name,
          presetId: rows[0].presetId,
          config: safeJson(rows[0].config),
          isCustom: rows[0].isCustom,
        }
      : null;
    return NextResponse.json({ ok: true, active });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "wallpaper read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      presetId?: string;
      config?: Record<string, unknown>;
      name?: string;
      isCustom?: boolean;
    };
    if (body.action !== "set" || !body.presetId) {
      return NextResponse.json({ ok: false, error: "action=set and presetId required" }, { status: 400 });
    }
    const name = body.name ?? body.presetId;
    const config = JSON.stringify(body.config ?? {});
    const existing = await db.wallpaper.findFirst({ where: { presetId: body.presetId } });
    const row = existing
      ? await db.wallpaper.update({ where: { id: existing.id }, data: { name, config, isCustom: Boolean(body.isCustom) } })
      : await db.wallpaper.create({
          data: { name, presetId: body.presetId, config, isCustom: Boolean(body.isCustom) },
        });
    return NextResponse.json({
      ok: true,
      active: { id: row.id, name: row.name, presetId: row.presetId, config: safeJson(row.config), isCustom: row.isCustom },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "wallpaper write failed" }, { status: 500 });
  }
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
