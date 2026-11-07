/**
 * model-config.ts — universal LLM abstraction for Alpha-OS.
 *
 * Two providers:
 *  - cloud: GLM vision models via z-ai-web-dev-sdk (backend-only)
 *  - aether: any OpenAI-compatible endpoint (the local Aether Engine on :3004
 *    or Ollama/vLLM behind it), with or without vision.
 *
 * callLLM is the single entry point used by /api/alpha/think,
 * /api/alpha/generate-app, /api/alpha/debate and /api/alpha/vision.
 * Error messages deliberately carry the raw cause ("429", "fetch failed"…)
 * so the think route's retry/backoff can classify them.
 */

export type ModelProvider = "cloud" | "aether";

export interface ModelConfig {
  provider: ModelProvider;
  aetherEndpoint: string;
  aetherModel: string;
  aetherApiKey: string;
  aetherHasVision: boolean;
}

let config: ModelConfig = {
  provider: "cloud",
  aetherEndpoint: "http://localhost:3004/v1",
  aetherModel: "aether-pipeline",
  aetherApiKey: "",
  aetherHasVision: false,
};

export function getModelConfig(): ModelConfig {
  return { ...config };
}

export function setModelConfig(patch: Partial<ModelConfig>): ModelConfig {
  config = { ...config, ...patch };
  return { ...config };
}

async function callCloud(system: string, user: string, screenshot?: string): Promise<string> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  if (screenshot) {
    const completion = await zai.chat.completions.createVision({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${system}\n\n---\n${user}` },
            { type: "image_url", image_url: { url: screenshot } },
          ],
        },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("cloud vision returned empty content");
    return content;
  }

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: system },
      { role: "user", content: user },
    ],
    thinking: { type: "disabled" },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("cloud returned empty content");
  return content;
}

async function callAether(system: string, user: string, screenshot?: string): Promise<string> {
  const base = config.aetherEndpoint.replace(/\/$/, "");
  const messages: unknown[] = [
    { role: "system", content: system },
    { role: "user", content: screenshot && config.aetherHasVision ? `${user}\n\n[screenshot attached]` : user },
  ];
  if (screenshot && config.aetherHasVision) {
    messages[1] = {
      role: "user",
      content: [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: screenshot } },
      ],
    };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.aetherApiKey ? { authorization: `Bearer ${config.aetherApiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.aetherModel, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local LLM error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Local LLM error: empty completion");
  return content;
}

/**
 * The single LLM entry point. `screenshot` is a data URL — omitted when the
 * provider has no vision (a text-only model still gets full OS state).
 */
export async function callLLM(
  system: string,
  user: string,
  screenshot?: string
): Promise<{ content: string }> {
  try {
    if (config.provider === "cloud") {
      return { content: await callCloud(system, user, screenshot) };
    }
    return { content: await callAether(system, user, screenshot) };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
}

/** Health-check the configured provider (used by the model settings panel). */
export async function testModelConnection(cfg?: Partial<ModelConfig>): Promise<ConnectionTest> {
  const c = { ...config, ...cfg };
  const started = Date.now();
  try {
    if (c.provider === "cloud") {
      const content = await callCloud("Reply with the single word: ok", "ping");
      return {
        ok: true,
        message: `Connected to cloud (${content.trim().slice(0, 20)}) in ${Date.now() - started}ms`,
      };
    }
    const healthBase = c.aetherEndpoint.replace(/\/$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${healthBase}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, message: `aether health returned ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; nodes?: number; edges?: number };
    return {
      ok: Boolean(data.ok),
      message: `Connected to aether (${data.nodes ?? 0} nodes, ${data.edges ?? 0} edges) in ${Date.now() - started}ms`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "connection failed" };
  }
}

// ---------------------------------------------------------------------------
// Provider probing — used by /api/alpha/probe-providers: health-check both
// providers, list local aether models, and auto-fallback to whichever works.
// ---------------------------------------------------------------------------

export async function probeProviders(): Promise<{
  provider: ModelProvider;
  cloudOk: boolean;
  aetherOk: boolean;
  aetherModels: string[];
}> {
  const cloudOk = await probeCloud();
  const { ok: aetherOk, models: aetherModels } = await probeAether();

  // Prefer the configured provider when it works; otherwise pick whichever
  // is reachable, defaulting to the configured one when nothing answers.
  const config = getModelConfig();
  let provider: ModelProvider = config.provider;
  if (provider === "cloud" && !cloudOk && aetherOk) provider = "aether";
  else if (provider === "aether" && !aetherOk && cloudOk) provider = "cloud";
  return { provider, cloudOk, aetherOk, aetherModels };
}

async function probeCloud(): Promise<boolean> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    await ZAI.create();
    return true;
  } catch {
    return false;
  }
}

async function probeAether(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const base = getModelConfig().aetherEndpoint.replace(/\/$/, "");
    const res = await fetch(`${base}/models`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((m: { id?: string }) => m.id).filter((x: unknown): x is string => typeof x === "string")
      : [];
    return { ok: true, models: ids };
  } catch {
    return { ok: false, models: [] };
  }
}
