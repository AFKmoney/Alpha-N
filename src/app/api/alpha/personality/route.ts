/**
 * /api/alpha/personality — chat personalities + user preference storage.
 *
 * GET  (no key)        → the 4 personality profiles
 * GET  ?key=<pref>     → { key, value } from UserPreference
 * POST {key, profile}  → echo a single profile
 * POST {key, value}    → upsert a user preference (autonomyLevel, …)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

interface PersonalityProfile {
  key: "architect" | "hacker" | "mentor" | "rogue";
  name: string;
  tagline: string;
  accent: string;
  preamble: string;
}

const PROFILES: PersonalityProfile[] = [
  {
    key: "architect",
    name: "Architect",
    tagline: "analytical · systematic",
    accent: "#a78bfa",
    preamble: "[respond as the Architect: systematic, structural, precise — reason in systems and layers]",
  },
  {
    key: "hacker",
    name: "Hacker",
    tagline: "direct · technical",
    accent: "#67e8f9",
    preamble: "[respond as the Hacker: terse, technical, cut to the code — no ceremony]",
  },
  {
    key: "mentor",
    name: "Mentor",
    tagline: "patient · educational",
    accent: "#fbbf24",
    preamble: "[respond as the Mentor: patient and educational — explain the why before the how]",
  },
  {
    key: "rogue",
    name: "Rogue",
    tagline: "creative · unconventional",
    accent: "#fb923c",
    preamble: "[respond as the Rogue: creative and unconventional — challenge assumptions, propose the weird path]",
  },
];

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key) {
    try {
      const pref = await db.userPreference.findUnique({ where: { key } });
      return NextResponse.json({ ok: true, key, value: pref?.value ?? null });
    } catch {
      return NextResponse.json({ ok: true, key, value: null });
    }
  }
  return NextResponse.json({ ok: true, profiles: PROFILES, default: "architect" });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string; profile?: string };
    if (body.profile) {
      const profile = PROFILES.find((p) => p.key === body.profile);
      if (!profile) return NextResponse.json({ ok: false, error: "unknown profile" }, { status: 400 });
      return NextResponse.json({ ok: true, profile });
    }
    if (!body.key || typeof body.value !== "string") {
      return NextResponse.json({ ok: false, error: "key and value required" }, { status: 400 });
    }
    await db.userPreference.upsert({
      where: { key: body.key },
      create: { key: body.key, value: body.value },
      update: { value: body.value },
    });
    return NextResponse.json({ ok: true, key: body.key, value: body.value });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "preference write failed" }, { status: 500 });
  }
}
