/**
 * /api/alpha/aether — proxy to the Aether Engine (Rust, port 3004).
 * GET  ?endpoint=graph|health|graph/stats|…  → forwarded
 * POST ?endpoint=graph/add|graph/search|…    → body forwarded
 * Graceful when the engine is offline (the OS keeps working without it).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const AETHER = process.env.AETHER_URL ?? "http://localhost:3004";

export async function GET(req: NextRequest) {
  const endpoint = (req.nextUrl.searchParams.get("endpoint") ?? "health").replace(/^\/+/, "");
  try {
    const res = await fetch(`${AETHER}/${endpoint}`, { signal: AbortSignal.timeout(4000) });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, offline: true, error: "aether engine unreachable on :3004" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const endpoint = (req.nextUrl.searchParams.get("endpoint") ?? "").replace(/^\/+/, "");
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "endpoint required" }, { status: 400 });
  }
  try {
    const body = await req.text();
    const res = await fetch(`${AETHER}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, offline: true, error: "aether engine unreachable on :3004" },
      { status: 200 }
    );
  }
}
