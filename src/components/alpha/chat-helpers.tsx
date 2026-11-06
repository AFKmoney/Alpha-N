/**
 * chat-helpers.tsx — pure helpers, types and small presentational bits for
 * the chat panel, so chat-panel.tsx stays focused on layout + interaction.
 */
"use client";

import React from "react";

export type PersonalityKey = "architect" | "hacker" | "mentor" | "rogue";

/** File attached to a chat message (image data URL or inlined text). */
export interface AttachedFile {
  name: string;
  kind: "image" | "text";
  data: string;
  size: number;
}

export interface PersonalityProfile {
  key: PersonalityKey;
  name: string;
  tagline: string;
  /** hex color — interpolated with alpha suffixes by the panel */
  accent: string;
  /** prepended to the user message so the AI adopts the tone */
  preamble: string;
}

export const PERSONALITIES: PersonalityProfile[] = [
  {
    key: "architect",
    name: "Architect",
    tagline: "analytical · systematic",
    accent: "#a78bfa",
    preamble: "[respond as the Architect: systematic, structural, precise]",
  },
  {
    key: "hacker",
    name: "Hacker",
    tagline: "direct · technical",
    accent: "#67e8f9",
    preamble: "[respond as the Hacker: terse, technical, no ceremony]",
  },
  {
    key: "mentor",
    name: "Mentor",
    tagline: "patient · educational",
    accent: "#fbbf24",
    preamble: "[respond as the Mentor: patient, explain the why before the how]",
  },
  {
    key: "rogue",
    name: "Rogue",
    tagline: "creative · unconventional",
    accent: "#fb923c",
    preamble: "[respond as the Rogue: creative, unconventional, challenge assumptions]",
  },
];

export const DEFAULT_PERSONALITY: PersonalityKey = "architect";

export function getPersonality(key: PersonalityKey): PersonalityProfile {
  return PERSONALITIES.find((p) => p.key === key) ?? PERSONALITIES[0];
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
export const TEXT_EXTENSIONS = ["txt", "md", "json", "ts", "tsx", "js", "jsx", "py"];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// localStorage (guarded for SSR / storage-full)
// ---------------------------------------------------------------------------

export function loadString(key: string, fallback: string): string {
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // non-fatal
  }
}

export const LS_PERSONALITY = "alpha-n:chat-personality";
export const LS_TTS = "alpha-n:chat-tts";
export const LS_PINS = "alpha-n:chat-pins";

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/** Highlight case-insensitive matches of `query` inside `text`. */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={`hl-${key++}`} className="rounded-sm bg-(--ae-gold) bg-opacity-30 px-0.5 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

/** 1-3 contextual follow-up suggestions for an AI message. */
export function generateSuggestions(content: string): string[] {
  const lower = content.toLowerCase();
  const pool: [RegExp, string[]][] = [
    [/error|fail|broken|crash/, ["diagnose the failure", "roll that change back", "show me the logs"]],
    [/optimi[sz]|faster|latency|performance/, ["what did you optimize?", "keep optimizing", "measure the gain"]],
    [/terminal|command|bash|shell/, ["open a terminal", "run the tests", "show recent output"]],
    [/file|code|rewrite|refactor/, ["show me the diff", "explain the change", "commit this evolution"]],
    [/memory|akasha|remember|forget/, ["what do you remember?", "add that to akasha", "list your intentions"]],
    [/plan|goal|next/, ["what is your current plan?", "advance the plan", "set a new goal"]],
    [/window|desktop|app/, ["open the monitor", "tile my windows", "show the desktop"]],
  ];
  const suggestions: string[] = [];
  for (const [re, set] of pool) {
    if (re.test(lower)) {
      for (const s of set) {
        if (!suggestions.includes(s)) suggestions.push(s);
        if (suggestions.length >= 3) return suggestions;
      }
    }
  }
  return suggestions.length > 0 ? suggestions : ["what can you do?", "evolve now", "what is your plan?"];
}

// ---------------------------------------------------------------------------
// Web Speech API (Chromium-only — callers hide the UI when null)
// ---------------------------------------------------------------------------

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
