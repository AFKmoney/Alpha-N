/**
 * /api/alpha/episode-log — the AI's episode memory (what it did, why, what
 * it earned). GET ?limit, POST appends an episode, PATCH ?id= {reward}
 * records user thumbs-up/down (rateEpisode).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1), 200);
    const rows = await db.episodeLog.findMany({ orderBy: { timestamp: "desc" }, take: limit });
    return NextResponse.json({
      ok: true,
      episodes: rows.map((r) => ({
        id: r.id,
        cycle: r.cycle,
        action: r.action,
        description: r.description,
        reasoning: r.reasoning,
        result: r.result,
        reward: r.reward,
        screenshot: r.screenshot,
        timestamp: r.timestamp.getTime(),
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "episode read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      cycle?: number;
      action?: string;
      description?: string;
      reasoning?: string;
      result?: string;
      reward?: number;
      screenshot?: string;
    };
    const row = await db.episodeLog.create({
      data: {
        cycle: Number(body.cycle ?? 0),
        action: String(body.action ?? "unknown").slice(0, 120),
        description: String(body.description ?? "").slice(0, 2000),
        reasoning: String(body.reasoning ?? "").slice(0, 8000),
        result: String(body.result ?? "ok").slice(0, 40),
        reward: Number(body.reward ?? 0),
        screenshot: String(body.screenshot ?? ""),
      },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "episode write failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const body = (await req.json()) as { reward?: number };
    await db.episodeLog.update({ where: { id }, data: { reward: Number(body.reward ?? 0) } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "episode rate failed" }, { status: 500 });
  }
}
