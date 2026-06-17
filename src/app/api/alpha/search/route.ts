/**
 * /api/alpha/search — web search proxy via the z-ai-web-dev-sdk.
 * Used when the AI emits a web_search mutation to research self-improvement
 * techniques. Returns ranked results with title, URL, snippet, host, date.
 */
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SearchRequest {
  query: string;
  num?: number;
}

export async function POST(req: NextRequest) {
  let body: SearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const zai = await ZAI.create();
    const num = Math.min(body.num ?? 6, 10);
    const results = await zai.functions.invoke("web_search", {
      query,
      num,
    });

    const formatted = (Array.isArray(results) ? results : []).map((r: {
      url?: string;
      name?: string;
      snippet?: string;
      host_name?: string;
      date?: string;
    }, i: number) => ({
      rank: i + 1,
      title: r.name ?? "",
      url: r.url ?? "",
      snippet: r.snippet ?? "",
      host: r.host_name ?? "",
      date: r.date ?? "",
    }));

    return NextResponse.json({
      query,
      count: formatted.length,
      results: formatted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: message, query, results: [] },
      { status: 200 }
    );
  }
}
