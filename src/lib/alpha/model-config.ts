// ============================================================
// Alpha-OS — Model Configuration
// Two providers: Cloud (GLM 4.6V via z-ai SDK) and Aether (Rust engine
// that loads GGUF models from the models/ folder with graph-augmented context).
// ============================================================

export type ModelProvider = "cloud" | "aether";

export interface ModelConfig {
  provider: ModelProvider;
  // Aether settings — which GGUF model to load from the models/ folder
  aetherModel: string; // filename of the .gguf file, e.g. "llama3.2-3b-q4_k_m.gguf"
  aetherHasVision: boolean; // does the model support image input?
  // Cloud model settings
  cloudModel: string;
}

// Default config — cloud by default (works out of the box)
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "cloud",
  aetherModel: "",
  aetherHasVision: false,
  cloudModel: "glm-4.6v",
};

// In-memory config (updated at runtime via the /api/alpha/model route)
// On server restart, defaults are used until the client pushes the config.
let currentConfig: ModelConfig = { ...DEFAULT_MODEL_CONFIG };

export function getModelConfig(): ModelConfig {
  return { ...currentConfig };
}

export function setModelConfig(config: Partial<ModelConfig>): ModelConfig {
  currentConfig = { ...currentConfig, ...config };
  return { ...currentConfig };
}

// ============================================================
// Universal LLM caller — works with both cloud and local models
// ============================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface VisionContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface LLMResponse {
  content: string;
  raw?: unknown;
}

/**
 * Call the LLM — routes to cloud (z-ai SDK) or local (OpenAI-compatible) based on config.
 * For cloud: uses z-ai-web-dev-sdk's createVision (handles both text and image).
 * For local: uses fetch to the OpenAI-compatible /chat/completions endpoint.
 *
 * RESILIENCE: if the configured provider fails, the call automatically falls
 * back to the other one. This is what keeps the OS responsive when, e.g., the
 * cloud SDK isn't configured (no .z-ai-config) but the local Aether Engine is
 * running — the organism stays alive instead of going silent.
 *
 * If the local model doesn't support vision, the image is omitted and only
 * text is sent — the AI still has full OS control via the rich text context.
 */
export async function callLLM(
  systemPrompt: string,
  userText: string,
  screenshot?: string | null,
  options?: { thinking?: boolean }
): Promise<LLMResponse> {
  const config = getModelConfig();

  // Try the configured provider first.
  try {
    if (config.provider === "aether") {
      return await callAetherLLM(systemPrompt, userText, screenshot);
    }
    return await callCloudLLM(systemPrompt, userText, screenshot, options);
  } catch (primaryError) {
    // If the configured provider failed, fall back to the OTHER one before
    // giving up. Log which provider was used so the failure is diagnosable.
    const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[alpha-n] primary provider "${config.provider}" failed (${errMsg.slice(0, 120)}); trying fallback…`);

    try {
      if (config.provider === "aether") {
        // Was using local — try cloud as a fallback.
        return await callCloudLLM(systemPrompt, userText, screenshot, options);
      }
      // Was using cloud — try the local Aether Engine as a fallback.
      return await callAetherLLM(systemPrompt, userText, screenshot);
    } catch (fallbackError) {
      // Both providers failed — surface the original (primary) error so the
      // caller can report it, but include the fallback failure too.
      const fbMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Both LLM providers failed. Cloud: ${errMsg.slice(0, 150)} | Aether: ${fbMsg.slice(0, 150)}`
      );
    }
  }
}

/**
 * Probe which provider is actually working right now. Used at boot so the OS
 * can switch to whichever backend is reachable instead of failing silently.
 * Returns the provider to use + a flag telling whether it auto-switched.
 */
export async function probeProviders(): Promise<{
  provider: ModelProvider;
  cloudOk: boolean;
  aetherOk: boolean;
  aetherModels: string[];
}> {
  const cloudOk = await probeCloud();
  const { ok: aetherOk, models: aetherModels } = await probeAether();

  // Prefer the configured provider when it works; otherwise pick whichever
  // is reachable, defaulting to cloud.
  const config = getModelConfig();
  let provider: ModelProvider = config.provider;
  if (provider === "cloud" && !cloudOk && aetherOk) provider = "aether";
  else if (provider === "aether" && !aetherOk && cloudOk) provider = "cloud";
  else if (!cloudOk && !aetherOk) provider = config.provider; // nothing works; keep config
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
    const res = await fetch("http://localhost:3004/v1/models", { cache: "no-store" });
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

// ---- Cloud (z-ai SDK) ----
async function callCloudLLM(
  systemPrompt: string,
  userText: string,
  screenshot?: string | null,
  options?: { thinking?: boolean }
): Promise<LLMResponse> {
  // Dynamic import to avoid loading the SDK when using local-only
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();

  const content: Array<VisionContent> = [{ type: "text", text: userText }];
  if (screenshot) {
    content.push({ type: "image_url", image_url: { url: screenshot } });
  }

  const completion = await zai.chat.completions.createVision({
    model: getModelConfig().cloudModel,
    messages: [
      { role: "assistant", content: systemPrompt },
      { role: "user", content },
    ],
    thinking: { type: options?.thinking ? "enabled" : "disabled" },
  });

  return {
    content: completion.choices[0]?.message?.content ?? "",
    raw: completion,
  };
}

// ---- Aether Engine (Rust inference orchestrator with memory graph) ----
// The Aether Engine at localhost:3004 receives the chat request, retrieves
// relevant memories from its semantic graph, augments the prompt, and
// forwards to the loaded GGUF model from the models/ folder.
// It returns an OpenAI-compatible response.
//
// IMPORTANT: this runs SERVER-SIDE (inside API routes), so it must hit the
// engine directly on localhost:3004 — a relative "/api/alpha/aether" URL
// would resolve against the wrong host in a server fetch and silently fail.
const AETHER_BASE = process.env.AETHER_BASE_URL || "http://localhost:3004";

async function callAetherLLM(
  systemPrompt: string,
  userText: string,
  screenshot?: string | null
): Promise<LLMResponse> {
  const config = getModelConfig();
  const hasImage = config.aetherHasVision && screenshot;

  // Pick a model: the configured one if set, otherwise let the engine decide
  // by omitting the field (it routes through its pipeline). We DON'T hardcode
  // a model id here so new .gguf files dropped in models/ Just Work once the
  // engine picks them up.
  const payload: Record<string, unknown> = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: hasImage ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: screenshot! } }] : userText },
    ],
    stream: false,
    temperature: 0.7,
  };
  if (config.aetherModel) payload.model = config.aetherModel;

  const res = await fetch(`${AETHER_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // Local inference on CPU can be slow; allow up to 90s.
    signal: AbortSignal.timeout(280_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Aether Engine error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const result = data?.choices?.[0]?.message?.content ?? "";
  if (!result) {
    throw new Error("Aether Engine returned an empty response");
  }
  return { content: result, raw: data };
}

/**
 * Quick health check — test if the configured model is reachable.
 * Returns { ok, latency, error }.
 */
export async function testModelConnection(): Promise<{
  ok: boolean;
  latency: number;
  error?: string;
  provider: string;
  model: string;
}> {
  const config = getModelConfig();
  const start = Date.now();

  try {
    if (config.provider === "aether") {
      // Aether Engine — check health endpoint
      const res = await fetch(`${AETHER_BASE}/health`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const modelInfo = config.aetherModel || "(no model loaded)";
        return { ok: true, latency: Date.now() - start, provider: "aether", model: `${modelInfo} (${data.nodes} nodes, ${data.edges} edges, ${data.cache_hits} cache hits)` };
      }
      return { ok: false, latency: Date.now() - start, error: "Aether Engine not reachable on port 3004", provider: "aether", model: config.aetherModel || "aether" };
    } else {
      // Cloud — just check the SDK loads
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      await ZAI.create();
      return { ok: true, latency: Date.now() - start, provider: "cloud", model: config.cloudModel };
    }
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
      provider: config.provider,
      model: config.provider === "aether" ? (config.aetherModel || "aether") : config.cloudModel,
    };
  }
}
