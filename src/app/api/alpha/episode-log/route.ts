/**
 * /api/alpha/episode-log — CRUD for the AI's episodic memory journal.
 *
 * Every action the AI takes is logged here. The AI re-reads its recent
 * episodes every cycle to learn from what worked and what didn't.
 *
 * GET  /api/alpha/episode-log?limit=50  → recent episodes (newest first)
 * POST /api/alpha/episode-log           → create a new episode
 * PATCH /api/alpha/episode-log?id=X     → update reward/result by id
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET — list recent episodes
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  try {
    const episodes = await db.episodeLog.findMany({
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    return NextResponse.json({ ok: true, episodes });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}

// POST — create a new episode
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cycle, action, description, reasoning, result, reward, screenshot } = body as {
      cycle: number;
      action: string;
      description: string;
      reasoning?: string;
      result?: string;
      reward?: number;
      screenshot?: string;
    };

    if (!action || !description) {
      return NextResponse.json({ ok: false, error: "action and description required" }, { status: 400 });
    }

    const episode = await db.episodeLog.create({
      data: {
        cycle: cycle || 0,
        action,
        description,
        reasoning: reasoning || "",
        result: result || "ok",
        reward: reward || 0,
        screenshot: screenshot || "",
      },
    });
    return NextResponse.json({ ok: true, episode });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}

// PATCH — update reward/result (e.g. when user clicks 👍/👎)
export async function PATCH(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  try {
    const body = await req.json();
    const { reward, result } = body as { reward?: number; result?: string };

    const updated = await db.episodeLog.update({
      where: { id },
      data: {
        ...(reward !== undefined && { reward }),
        ...(result !== undefined && { result }),
      },
    });
    return NextResponse.json({ ok: true, episode: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}
