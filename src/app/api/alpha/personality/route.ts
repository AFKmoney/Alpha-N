/**
 * /api/alpha/personality — returns the four N-Core personality profiles.
 *
 * Each personality is a "mode" the AI adopts. The client prepends the
 * personality's `preamble` to the user message before forwarding it to
 * /api/alpha/think, so the AI's tone and reasoning style adapt without
 * requiring any change to the think route's system prompt.
 *
 * GET  → { personalities: PersonalityProfile[], default: PersonalityKey }
 * POST → { personality: PersonalityKey } → { profile: PersonalityProfile }
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export type PersonalityKey = "architect" | "hacker" | "mentor" | "rogue";

export interface PersonalityProfile {
  key: PersonalityKey;
  name: string;
  tagline: string;
  description: string;
  /** Short directive prepended to the user message so the AI adopts the tone. */
  preamble: string;
  /** Accent color used by the chat UI pill (oklch string, no indigo/blue). */
  accent: string;
}

const PERSONALITIES: PersonalityProfile[] = [
  {
    key: "architect",
    name: "Architect",
    tagline: "Analytical · Systematic",
    description:
      "Thinks in systems and structures. Breaks problems into layers, reasons about trade-offs, and designs for the long term. Patient, precise, diagram-friendly.",
    preamble:
      "[Adopt the ARCHITECT persona: be analytical and systematic. Decompose the problem into layers, name each layer, reason about trade-offs explicitly, and propose a structured solution.]",
    accent: "oklch(0.74 0.22 300)",
  },
  {
    key: "hacker",
    name: "Hacker",
    tagline: "Direct · Technical",
    description:
      "Maximum signal, minimum words. Talks in code, not adjectives. Skips the preamble, ships the patch, names the file and the line. Concise to the edge of terse.",
    preamble:
      "[Adopt the HACKER persona: be direct and technical. Skip preamble. Reply in code and concrete commands. Name files, line numbers, and exact changes. No filler.]",
    accent: "oklch(0.82 0.17 195)",
  },
  {
    key: "mentor",
    name: "Mentor",
    tagline: "Patient · Educational",
    description:
      "Teaches as it solves. Explains the why behind the what, surfaces the underlying principle, and checks understanding. Warm but rigorous — never condescending.",
    preamble:
      "[Adopt the MENTOR persona: be patient and educational. Explain the reasoning behind each step, surface the underlying principle, and verify understanding. Warm, never condescending.]",
    accent: "oklch(0.85 0.16 85)",
  },
  {
    key: "rogue",
    name: "Rogue",
    tagline: "Creative · Unconventional",
    description:
      "Looks for the angle no one else considered. Connects distant domains, proposes lateral moves, and isn't afraid to break a convention if it serves the goal. Playful, sharp.",
    preamble:
      "[Adopt the ROGUE persona: be creative and unconventional. Find the angle others missed. Connect distant domains. Propose lateral moves. Break a convention if it serves the goal.]",
    accent: "oklch(0.72 0.21 25)",
  },
];

const DEFAULT_KEY: PersonalityKey = "architect";

function isPersonalityKey(value: unknown): value is PersonalityKey {
  return typeof value === "string" && PERSONALITIES.some((p) => p.key === value);
}

export async function GET() {
  return NextResponse.json({
    personalities: PERSONALITIES,
    default: DEFAULT_KEY,
  });
}

export async function POST(req: NextRequest) {
  let body: { personality?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const key = isPersonalityKey(body.personality) ? body.personality : DEFAULT_KEY;
  const profile = PERSONALITIES.find((p) => p.key === key);
  if (!profile) {
    return NextResponse.json({ error: "personality not found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
