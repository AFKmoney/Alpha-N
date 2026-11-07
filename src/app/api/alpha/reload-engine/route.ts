/**
 * /api/alpha/reload-engine — hot-reload the Aether inference engine.
 *
 * Lets the AI (or the user) swap the running GGUF model without restarting
 * the OS. Forwards to the Aether engine's own /admin/reload endpoint. If
 * the Aether isn't reachable, returns a clear error so the caller can fall
 * back gracefully.
 *
 * POST body (optional):
 *   { model?: string }   absolute path or filename of the new model to load.
 *                        Omit to reload the currently configured model.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const AETHER_BASE = process.env.AETHER_BASE_URL || "http://localhost:3004";

export async function POST(req: Request) {
  let body: { model?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — reload the current model
  }

  try {
    const res = await fetch(`${AETHER_BASE}/admin/reload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: body.model }),
      signal: AbortSignal.timeout(50_000),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: `Aether reload failed (${res.status}): ${(data as { error?: string }).error ?? text.slice(0, 200)}` },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, message: "engine reloaded", ...(data as object) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { ok: false, message: `Aether unreachable: ${message}. Is the engine running on ${AETHER_BASE}?` },
      { status: 200 }
    );
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
