/**
 * /api/alpha/probe-providers — boot-time provider detection.
 *
 * Probes the cloud SDK and the local Aether Engine, then picks whichever is
 * reachable. If the configured provider is down, this auto-switches to the
 * other so the OS never boots into a dead state. The client calls this once
 * on mount and pushes the result into the model config.
 */
import { NextResponse } from "next/server";
import { probeProviders, setModelConfig, getModelConfig } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST() {
  const result = await probeProviders();

  // If the active provider isn't reachable but the other is, switch now so
  // the very first think() call succeeds. Keep the chosen model id if we
  // switched to aether and one is available.
  const config = getModelConfig();
  let switched = false;
  if (result.provider !== config.provider) {
    const aetherModel =
      result.provider === "aether" && result.aetherModels.length > 0
        ? result.aetherModels.find((m) => m.endsWith(".gguf")) ?? result.aetherModels[0]
        : config.aetherModel;
    setModelConfig({ provider: result.provider, aetherModel });
    switched = true;
  }

  return NextResponse.json({
    ...result,
    switched,
    activeProvider: result.provider,
    aetherModels: result.aetherModels,
  });
}
