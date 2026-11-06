/**
 * /api/alpha/search — web research for the AI (z-ai web_search function).
 * Results feed back into the next think cycle and open in the browser app.
 */
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";

interface SearchItem {
  title?: string;
  snippet?: string;
  host?: string;
  url?: string;
  link?: string;
  date?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { query?: string; num?: number };
    const query = String(body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ ok: false, error: "query required" }, { status: 400 });
    }

    const zai = await ZAI.create();
    const raw = (await zai.functions.invoke("web_search", {
      query,
      num: Math.min(Math.max(Number(body.num ?? 6), 1), 10),
    })) as unknown;

    const items: SearchItem[] = Array.isArray(raw) ? (raw as SearchItem[]) : [];
    const results = items.slice(0, 10).map((r) => ({
      title: String(r.title ?? "untitled"),
      snippet: String(r.snippet ?? "").slice(0, 300),
      host: String(r.host ?? safeHost(r.url ?? r.link ?? "")),
      url: String(r.url ?? r.link ?? ""),
      date: r.date ? String(r.date) : undefined,
    }));

    return NextResponse.json({ ok: true, query, results, time: Date.now() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "search failed" }, { status: 500 });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
