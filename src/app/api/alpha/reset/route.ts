/**
 * /api/alpha/reset — danger zone. Clears ALL Akasha cognition
 * (memory, intentions, plans, goals, events, rewards, episodes, constraints,
 * preferences, wallpapers, generated apps) for a fresh boot.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    const results = await Promise.all([
      db.akashaMemory.deleteMany(),
      db.akashaIntention.deleteMany(),
      db.plan.deleteMany(),
      db.goal.deleteMany(),
      db.systemEvent.deleteMany(),
      db.mutationReward.deleteMany(),
      db.episodeLog.deleteMany(),
      db.constraint.deleteMany(),
      db.userPreference.deleteMany(),
      db.wallpaper.deleteMany(),
      db.generatedApp.deleteMany(),
    ]);
    return NextResponse.json({
      ok: true,
      cleared: results.reduce((sum, r) => sum + r.count, 0),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "reset failed" }, { status: 500 });
  }
}
