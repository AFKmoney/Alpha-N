/**
 * /api/alpha/vision — image understanding through the configured provider.
 * POST {image (data URL), prompt} → { description }. Falls back to a note
 * string on failure so the chat never breaks.
 */
import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { image?: string; prompt?: string };
    const image = String(body.image ?? "");
    const prompt = String(body.prompt ?? "Describe what you see.");
    if (!image) {
      return NextResponse.json({ ok: false, error: "image required" }, { status: 400 });
    }
    const normalized = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
    const { content } = await callLLM(
      "You are the vision cortex of Alpha-OS. Describe the image precisely and concisely.",
      prompt,
      normalized
    );
    return NextResponse.json({ ok: true, description: content });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "vision failed",
      description: "(vision analysis failed)",
    });
  }
}
