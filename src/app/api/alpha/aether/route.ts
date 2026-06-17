import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const AETHER_URL = "http://localhost:3004";

/**
 * Proxy to the Aether Engine (port 3004).
 * GET  /api/alpha/aether?endpoint=graph       → GET  /graph
 * GET  /api/alpha/aether?endpoint=health      → GET  /health
 * POST /api/alpha/aether?endpoint=graph/add   → POST /graph/add
 * POST /api/alpha/aether?endpoint=graph/search → POST /graph/search
 * POST /api/alpha/aether?endpoint=chat        → POST /v1/chat/completions
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "health";

  const path = endpoint === "graph" ? "/graph" : endpoint === "health" ? "/health" : `/${endpoint}`;

  try {
    const res = await fetch(`${AETHER_URL}${path}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Aether Engine not reachable";
    return NextResponse.json(
      { error: message, ok: false, nodes: 0, edges: 0 },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "graph/add";
  const body = await req.json();

  let path: string;
  switch (endpoint) {
    case "graph/add":
      path = "/graph/add";
      break;
    case "graph/search":
      path = "/graph/search";
      break;
    case "chat":
      path = "/v1/chat/completions";
      break;
    case "graph/clear":
      path = "/graph/clear";
      break;
    default:
      path = `/${endpoint}`;
  }

  try {
    const res = await fetch(`${AETHER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Aether Engine not reachable";
    return NextResponse.json({ error: message, ok: false }, { status: 200 });
  }
}
