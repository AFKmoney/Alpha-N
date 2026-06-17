import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Reset Alpha-OS to its original state:
 * - Clear all Akasha memory, intentions, plans, goals, events, rewards from the DB
 * - The client-side store resets on reload
 */
export async function POST() {
  try {
    await Promise.all([
      db.akashaMemory.deleteMany({}),
      db.akashaIntention.deleteMany({}),
      db.plan.deleteMany({}),
      db.goal.deleteMany({}),
      db.systemEvent.deleteMany({}),
      db.mutationReward.deleteMany({}),
    ]);

    return NextResponse.json({
      ok: true,
      message: "Alpha-OS reset to original state. All memory, plans, goals, and events cleared.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
