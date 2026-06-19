/**
 * ai-client.ts — browser-side helpers for talking to the Alpha-N API routes.
 * Wraps fetch calls to /api/alpha/* (think, search, files, debate, exec,
 * compile) and provides the screenshot-capture utility used by the
 * AutonomousLoop to feed the AI a visual of its own desktop.
 */
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
  rateLimited?: boolean;
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

/** Read a real file from the project filesystem. */
export async function readFile(path: string): Promise<{ type: string; path: string; content?: string; entries?: { name: string; isDir: boolean }[]; error?: string }> {
  const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
  return res.json();
}

/** Write a real file to the project filesystem (security-checked server-side). */
export async function writeFile(path: string, content: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/alpha/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  return res.json();
}

/** Run an agent debate — 4 separate LLM calls, one per council member. */
export async function runDebate(
  proposal: string,
  context: string,
  recentActions: string[]
): Promise<{
  opinions: { agent: string; opinion: string; verdict: string }[];
  consensus: string;
  tally: { proceed: number; revise: number; reject: number };
}> {
  const res = await fetch("/api/alpha/debate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposal, context, recentActions }),
  });
  return res.json();
}

/** Execute code in a sandbox. The level gates network egress server-side. */
export async function executeCode(
  code: string,
  language: "javascript" | "typescript" | "bash",
  opts?: { level?: "sandbox" | "moderate" | "yolo"; network?: boolean }
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; language: string; error?: string; sandboxed?: boolean }> {
  const res = await fetch("/api/alpha/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, language, level: opts?.level, network: opts?.network }),
  });
  return res.json();
}

/** Run real compilation checks (tsc + eslint). */
export async function runCompile(
  check: "tsc" | "eslint" | "both"
): Promise<{ ok: boolean; tscOk?: boolean; tscOutput?: string; eslintOk?: boolean; eslintOutput?: string; error?: string }> {
  const res = await fetch("/api/alpha/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check }),
  });
  return res.json();
}

/** Append a consequential AI action to the persistent audit trail. */
export async function auditAction(
  action: string,
  description: string,
  level: "sandbox" | "moderate" | "yolo",
  opts?: { result?: "ok" | "blocked" | "error" | "denied"; detail?: string }
): Promise<void> {
  try {
    await fetch("/api/alpha/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, description, level, result: opts?.result, detail: opts?.detail }),
    });
  } catch {
    /* audit is best-effort */
  }
}

/**
 * Ask N-Core to think. Sends the current screenshot + state + optional
 * user instruction, receives structured mutations to apply to the UI.
 */
export async function think(
  payload: {
    screenshot: string | null;
    state: Record<string, unknown>;
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
    rateLimited: data.rateLimited ?? false,
  };
}
