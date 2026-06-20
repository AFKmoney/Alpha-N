/**
 * chat-helpers.tsx — pure logic, types, and small presentational helpers
 * extracted from chat-panel.tsx.
 *
 * Everything here is free of component state and store coupling, which keeps
 * chat-panel.tsx focused on layout + interaction and makes these utilities
 * unit-testable in isolation. highlightMatch returns JSX so this file is
 * .tsx.
 */

import type { ReactNode } from "react";

// ===========================================================================
// Web Speech API typing — lib.dom.d.ts doesn't always expose
// webkitSpeechRecognition, so we declare the surface we use. Keeps the
// component fully typed (zero `any`) while staying Chromium-compatible.
// ===========================================================================
export interface SpeechRecognitionResultLike {
  transcript: string;
  confidence: number;
}
export interface SpeechRecognitionResultListLike {
  readonly length: number;
  0: SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultListLike };
}
export interface SpeechRecognitionErrorLike {
  readonly error: string;
  readonly message: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ===========================================================================
// Personality profiles — mirrored from /api/alpha/personality so the chat
// UI works instantly without waiting on a fetch. The route remains the
// canonical source for any other consumer.
// ===========================================================================
export type PersonalityKey = "architect" | "hacker" | "mentor" | "rogue";

export interface PersonalityProfile {
  key: PersonalityKey;
  name: string;
  tagline: string;
  preamble: string;
  accent: string;
}

export const PERSONALITIES: PersonalityProfile[] = [
  {
    key: "architect",
    name: "Architect",
    tagline: "Analytical · Systematic",
    preamble:
      "[Adopt the ARCHITECT persona: be analytical and systematic. Decompose the problem into layers, name each layer, reason about trade-offs explicitly, and propose a structured solution.]",
    accent: "oklch(0.74 0.22 300)",
  },
  {
    key: "hacker",
    name: "Hacker",
    tagline: "Direct · Technical",
    preamble:
      "[Adopt the HACKER persona: be direct and technical. Skip preamble. Reply in code and concrete commands. Name files, line numbers, and exact changes. No filler.]",
    accent: "oklch(0.82 0.17 195)",
  },
  {
    key: "mentor",
    name: "Mentor",
    tagline: "Patient · Educational",
    preamble:
      "[Adopt the MENTOR persona: be patient and educational. Explain the reasoning behind each step, surface the underlying principle, and verify understanding. Warm, never condescending.]",
    accent: "oklch(0.85 0.16 85)",
  },
  {
    key: "rogue",
    name: "Rogue",
    tagline: "Creative · Unconventional",
    preamble:
      "[Adopt the ROGUE persona: be creative and unconventional. Find the angle others missed. Connect distant domains. Propose lateral moves. Break a convention if it serves the goal.]",
    accent: "oklch(0.72 0.21 25)",
  },
];

export const DEFAULT_PERSONALITY: PersonalityKey = "architect";

export function getPersonality(key: PersonalityKey): PersonalityProfile {
  return PERSONALITIES.find((p) => p.key === key) ?? PERSONALITIES[0];
}

// ===========================================================================
// Suggestion pool — keyword-driven, generated client-side after each AI turn.
// ===========================================================================
const SUGGESTION_POOL: { keywords: string[]; text: string }[] = [
  { keywords: ["code", "function", "snippet", "implement"], text: "Run this code" },
  { keywords: ["code", "function", "snippet"], text: "Show me a different approach" },
  { keywords: ["error", "fail", "bug", "broken"], text: "How do I fix this?" },
  { keywords: ["error", "fail", "bug"], text: "What caused this error?" },
  { keywords: ["plan", "step", "phase", "roadmap"], text: "What's the next step?" },
  { keywords: ["plan", "step", "phase"], text: "Break this down further" },
  { keywords: ["memory", "remember", "lesson"], text: "Add this to memory" },
  { keywords: ["memory", "remember", "lesson"], text: "Why is this important?" },
  { keywords: ["search", "research", "web"], text: "Search for more info" },
  { keywords: ["file", "path", "directory"], text: "Read this file" },
  { keywords: ["file", "path", "directory"], text: "Explain the structure" },
  { keywords: ["metric", "performance", "optimize", "speed"], text: "How do we measure improvement?" },
];
const FALLBACK_SUGGESTIONS = [
  "Explain this in simpler terms",
  "Show me an example",
  "What are the alternatives?",
];

export function generateSuggestions(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = SUGGESTION_POOL.filter((s) =>
    s.keywords.some((k) => lower.includes(k))
  ).map((s) => s.text);
  // De-duplicate, cap at 3, fall back if nothing matched.
  const unique = Array.from(new Set(matched)).slice(0, 3);
  return unique.length > 0 ? unique : FALLBACK_SUGGESTIONS.slice(0, 2);
}

// ===========================================================================
// File upload — supported mime types and extensions.
// ===========================================================================
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
export const TEXT_EXTENSIONS = ["txt", "md", "json", "ts", "tsx", "js", "jsx", "py"];

export interface AttachedFile {
  name: string;
  kind: "image" | "text";
  /** For images: a data URL. For text: the raw string content. */
  data: string;
  /** Byte size of the original file, for display. */
  size: number;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

// ===========================================================================
// localStorage helpers — guarded so SSR never touches window.
// ===========================================================================
export function loadString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}
export function saveString(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
}

export const LS_PERSONALITY = "alpha-n:chat-personality";
export const LS_TTS = "alpha-n:chat-tts";
export const LS_PINS = "alpha-n:chat-pins";

// ===========================================================================
// Small presentational helpers
// ===========================================================================

/** Highlight occurrences of `query` inside `text` with <mark>. */
export function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={key++} className="rounded bg-[oklch(0.85_0.16_85)]/40 px-0.5 text-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return out;
}

/** Human-readable byte size (B / KB / MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
