/**
 * /api/alpha/model — model provider configuration (cloud | aether).
 * GET returns the current config, POST updates it or runs a connection test.
 * Config is held in the server's memory (model-config module singleton).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getModelConfig,
  setModelConfig,
  testModelConnection,
  type ModelProvider,
} from "@/lib/alpha/model-config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, config: getModelConfig() });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      provider?: string;
      aetherEndpoint?: string;
      aetherModel?: string;
      aetherApiKey?: string;
      aetherHasVision?: boolean;
    };

    if (body.action === "test") {
      const test = await testModelConnection(body as never);
      return NextResponse.json({ ok: test.ok, message: test.message });
    }

    const patch: Record<string, unknown> = {};
    if (body.provider === "cloud" || body.provider === "aether") {
      patch.provider = body.provider as ModelProvider;
    }
    if (typeof body.aetherEndpoint === "string") patch.aetherEndpoint = body.aetherEndpoint;
    if (typeof body.aetherModel === "string") patch.aetherModel = body.aetherModel;
    if (typeof body.aetherApiKey === "string") patch.aetherApiKey = body.aetherApiKey;
    if (typeof body.aetherHasVision === "boolean") patch.aetherHasVision = body.aetherHasVision;

    const config = setModelConfig(patch);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "config failed" }, { status: 500 });
  }
}
