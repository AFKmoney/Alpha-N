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

  if (config.provider === "aether") {
    return callAetherLLM(systemPrompt, userText, screenshot);
  }
  return callCloudLLM(systemPrompt, userText, screenshot, options);
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
async function callAetherLLM(
  systemPrompt: string,
  userText: string,
  screenshot?: string | null
): Promise<LLMResponse> {
  const config = getModelConfig();
  const hasImage = config.aetherHasVision && screenshot;
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: "text", text: userText }];
  if (hasImage) {
    content.push({ type: "image_url", image_url: { url: screenshot! } });
  }

  const res = await fetch("/api/alpha/aether?endpoint=chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.aetherModel || "aether",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: hasImage ? content : userText },
      ],
      stream: false,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Aether Engine error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const result = data?.choices?.[0]?.message?.content ?? "";
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
      const res = await fetch("http://localhost:3004/health", { cache: "no-store" });
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
