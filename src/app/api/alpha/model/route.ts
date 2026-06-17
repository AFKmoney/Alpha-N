import { NextRequest, NextResponse } from "next/server";
import { getModelConfig, setModelConfig, testModelConnection, type ModelConfig } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET — current model config
export async function GET() {
  return NextResponse.json(getModelConfig());
}

// POST — update model config (and optionally test the connection)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body as { action?: string };

    if (action === "test") {
      const result = await testModelConnection();
      return NextResponse.json(result);
    }

    // Update config
    const update: Partial<ModelConfig> = {};
    if (body.provider) update.provider = body.provider;
    if (body.aetherModel !== undefined) update.aetherModel = body.aetherModel;
    if (body.aetherHasVision !== undefined) update.aetherHasVision = body.aetherHasVision;
    if (body.cloudModel !== undefined) update.cloudModel = body.cloudModel;

    const newConfig = setModelConfig(update);
    return NextResponse.json({ ok: true, config: newConfig });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
