/**
 * /api/alpha/proxy — the browser app's fetch proxy.
 * Fetches any URL, strips X-Frame-Options / CSP headers and injects a
 * <base> tag so relative resources resolve. Query strings without a dot
 * are treated as Google searches by the client before hitting this route.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return NextResponse.json({ error: "only http(s) is supported" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AlphaOS-Browser/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    const contentType = upstream.headers.get("content-type") ?? "text/html";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      // pass non-HTML through untouched (images, etc.)
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        status: upstream.status,
        headers: { "content-type": contentType },
      });
    }

    let html = await upstream.text();
    // strip framing + script-ish restrictions
    html = html
      .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
      .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "");

    const baseTag = `<base href="${target.origin}${target.pathname.replace(/[^/]*$/, "")}">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else {
      html = `${baseTag}${html}`;
    }

    return new NextResponse(html, {
      status: upstream.status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy fetch failed" },
      { status: 502 }
    );
  }
}
