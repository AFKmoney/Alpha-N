/**
 * /api/alpha/audit — read the recent AI action audit trail.
 * GET returns the in-memory ring (newest first). This is what the
 * Control Center "Activity" panel surfaces so the user can see what the
 * organism has been doing under the current autonomy level.
 */
import { NextResponse } from "next/server";
import { recentAudit } from "@/lib/alpha/audit-log";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ entries: recentAudit(100) });
}

/**
 * POST — append a client-observed action to the audit trail. Used by the
 * autonomous loop to log consequential actions that originated client-side
 * (e.g. a mutation that ran an OS control rather than an API call).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, description, level, result, detail } = body as {
      action: string;
      description: string;
      level: "sandbox" | "moderate" | "yolo";
      result?: "ok" | "blocked" | "error" | "denied";
      detail?: string;
    };
    if (!action || !description) {
      return NextResponse.json({ error: "action + description required" }, { status: 400 });
    }
    // Dynamic import to avoid circular concerns; audit() persists in background.
    const { audit } = await import("@/lib/alpha/audit-log");
    audit({
      action,
      description,
      level: level ?? "moderate",
      result: result ?? "ok",
      detail,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
