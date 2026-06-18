/**
 * /api/alpha/vision — analyzes an attached image using the configured LLM's
 * vision capability. The chat panel calls this when the user attaches an
 * image to a message; the returned description is folded into the user
 * message text so the existing /api/alpha/think flow needs no changes.
 *
 * POST { image: string (data URL), prompt?: string } → { description: string }
 *
 * Reuses callLLM from model-config so it works for both the cloud (GLM-4.6V)
 * and the Aether (GGUF with vision) providers. Falls back to a short note
 * if vision is unavailable on the current provider.
 */
import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 45;

interface VisionRequest {
  image?: string;
  prompt?: string;
}

const SYSTEM_PROMPT =
  "You are a precise vision assistant inside Alpha-OS. Describe the attached image in 2-4 sentences. " +
  "Focus on what is concretely visible: UI elements, text, charts, code, layout, colors, and any notable detail. " +
  "Do not speculate beyond what is shown. Plain prose, no markdown headers.";

export async function POST(req: NextRequest) {
  let body: VisionRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const image = body.image?.trim();
  if (!image) {
    return NextResponse.json({ error: "image is required" }, { status: 400 });
  }
  // Accept both raw base64 and full data URLs; normalize to a data URL.
  const dataUrl = image.startsWith("data:")
    ? image
    : `data:image/png;base64,${image}`;

  const prompt = body.prompt?.trim() || "Describe this image in detail.";

  try {
    const result = await callLLM(SYSTEM_PROMPT, prompt, dataUrl);
    const description = result.content.trim();
    if (!description) {
      return NextResponse.json({
        description: "(Vision model returned no description for this image.)",
      });
    }
    return NextResponse.json({ description });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: message, description: `(Vision analysis unavailable: ${message.slice(0, 80)})` },
      { status: 200 }
    );
  }
}
