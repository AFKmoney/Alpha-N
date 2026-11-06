/**
 * /api/alpha/constraints — the sovereignty constraints the user imposes on
 * the AI. GET lists, POST adds, DELETE ?id= removes.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db.constraint.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json({
      ok: true,
      constraints: rows.map((r) => ({
        id: r.id,
        text: r.text,
        scope: r.scope,
        active: r.active,
        time: r.createdAt.getTime(),
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "constraints read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string; scope?: string };
    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
    const row = await db.constraint.create({
      data: { text: text.slice(0, 500), scope: String(body.scope ?? "global").slice(0, 60) },
    });
    return NextResponse.json({
      ok: true,
      constraint: { id: row.id, text: row.text, scope: row.scope, active: row.active, time: row.createdAt.getTime() },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "constraint write failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    await db.constraint.deleteMany({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "constraint delete failed" }, { status: 500 });
  }
}
