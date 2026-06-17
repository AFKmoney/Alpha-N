import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Web proxy — fetches any URL and returns the HTML with X-Frame-Options
 * and Content-Security-Policy headers stripped, so any site (including
 * google.com) can be loaded in an iframe inside the Alpha-OS browser app.
 *
 * This also rewrites relative URLs to absolute so resources load correctly.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "text/html";
    const html = await res.text();

    // Determine the origin for rewriting relative URLs
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;
    const baseHref = `<base href="${origin}/">`;

    // Inject a <base> tag so relative resources resolve to the target origin
    let rewritten = html;
    if (rewritten.includes("<head>")) {
      rewritten = rewritten.replace("<head>", `<head>${baseHref}`);
    } else if (rewritten.includes("<html>")) {
      rewritten = rewritten.replace("<html>", `<html><head>${baseHref}</head>`);
    } else {
      rewritten = baseHref + rewritten;
    }

    // Return with headers that ALLOW framing (strip X-Frame-Options, relax CSP)
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "content-type": contentType,
        // Explicitly allow framing
        "x-frame-options": "ALLOWALL",
        "content-security-policy": "frame-ancestors *",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `Proxy fetch failed: ${message}` },
      { status: 502 }
    );
  }
}
