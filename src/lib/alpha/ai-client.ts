"use client";

import { toPng } from "html-to-image";
import type { Mutation } from "./mutations";

/**
 * Capture a screenshot of the Alpha-N workspace as a compressed data URL.
 * Falls back to a "no screenshot" payload if capture fails.
 */
export async function captureScreenshot(
  target: HTMLElement | null,
  label = "workspace"
): Promise<string | null> {
  if (!target || typeof window === "undefined") return null;
  try {
    const dataUrl = await toPng(target, {
      cacheBust: true,
      pixelRatio: 1,
      width: Math.min(target.scrollWidth, 1280),
      height: Math.min(target.scrollHeight, 800),
      backgroundColor: "#0a0a14",
      filter: (node) => {
        // skip elements that opt out
        if (node instanceof HTMLElement && node.dataset.aiSkip === "true") {
          return false;
        }
        return true;
      },
    });
    // downscale further to keep payload small for the VLM
    return dataUrl;
  } catch (err) {
    console.warn(`[alpha-n] screenshot capture failed (${label}):`, err);
    return null;
  }
}

export interface ThinkResponse {
  reasoning: string;
  message: string;
  mutations: Mutation[];
  raw?: string;
  error?: string;
}

export interface WebSearchResponse {
  query: string;
  count: number;
  results: { rank: number; title: string; url: string; snippet: string; host: string; date: string }[];
  error?: string;
}

/**
 * Perform a web search via the backend. Used when the AI emits a web_search mutation.
 */
export async function webSearch(query: string, signal?: AbortSignal): Promise<WebSearchResponse> {
  const res = await fetch("/api/alpha/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, num: 6 }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`search failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Ask N-Core to think. Sends the current screenshot + state + optional
 * user instruction, receives structured mutations to apply to the UI.
 */
export async function think(
  payload: {
    screenshot: string | null;
    state: {
      generation: number;
      version: string;
      aiState: string;
      metrics: { cpu: number; ram: number; entropy: number; coherence: number };
      codePreview: string;
      agents: { role: string; status: string; thought: string; load: number }[];
      recentLogs: string[];
      recentMutations: string[];
    };
    userMessage?: string | null;
    history: { role: "user" | "ai"; content: string }[];
  },
  signal?: AbortSignal
): Promise<ThinkResponse> {
  const res = await fetch("/api/alpha/think", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    throw new Error(`think failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    reasoning: data.reasoning ?? "",
    message: data.message ?? "",
    mutations: (data.mutations ?? []) as Mutation[],
    raw: data.raw,
    error: data.error,
  };
}
