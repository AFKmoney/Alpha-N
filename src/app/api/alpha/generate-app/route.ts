import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { callLLM } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
// App generation may take 30+ seconds — don't time out mid-stream.
export const maxDuration = 120;

/**
 * Resolve a Prisma client that has the `generatedApp` model.
 *
 * Why this exists: the shared `@/lib/db` singleton caches the client on
 * `globalThis`, so if the dev server started before the GeneratedApp model
 * was added to the schema, the cached client (and even the cached
 * `PrismaClient` class itself) lacks that model. We detect the staleness
 * and create a fresh client; if the fresh client still lacks the model
 * (because the PrismaClient class itself is cached), we fall back to raw
 * SQL helpers (`generatedAppRaw`) that work on any client.
 */
function getDb(): PrismaClient {
  const g = globalThis as unknown as {
    __alphaGeneratedAppDb?: PrismaClient;
    prisma?: PrismaClient;
  };
  if (g.__alphaGeneratedAppDb) return g.__alphaGeneratedAppDb;
  const shared = g.prisma;
  if (
    shared &&
    typeof (shared as unknown as { generatedApp?: unknown }).generatedApp !==
      "undefined"
  ) {
    g.__alphaGeneratedAppDb = shared;
    return shared;
  }
  const fresh = new PrismaClient({ log: ["query"] });
  g.__alphaGeneratedAppDb = fresh;
  return fresh;
}

const db = getDb();

/**
 * Stale-client detector. True when the loaded PrismaClient class doesn't
 * know about the GeneratedApp model (i.e. the dev server was started before
 * the schema was updated). When true, the route falls back to raw SQL.
 */
const STALE_CLIENT =
  typeof (db as unknown as { generatedApp?: unknown }).generatedApp ===
  "undefined";

// ----------------------------------------------------------------------------
// Raw SQL helpers — used when STALE_CLIENT is true. They speak to the
// GeneratedApp table directly, bypassing the model accessor entirely.
// ----------------------------------------------------------------------------
interface GeneratedAppRowSql {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
  createdAt: Date;
}

function rowToApi(
  r: GeneratedAppRowSql
): {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
  createdAt: string;
} {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    code: r.code,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

async function rawListApps(): Promise<ReturnType<typeof rowToApi>[]> {
  const rows = (await db.$queryRawUnsafe(
    `SELECT id, name, description, category, code, createdAt FROM GeneratedApp ORDER BY datetime(createdAt) DESC`
  )) as GeneratedAppRowSql[];
  return rows.map(rowToApi);
}

async function rawGetApp(id: string): Promise<ReturnType<typeof rowToApi> | null> {
  const rows = (await db.$queryRawUnsafe(
    `SELECT id, name, description, category, code, createdAt FROM GeneratedApp WHERE id = ? LIMIT 1`,
    id
  )) as GeneratedAppRowSql[];
  return rows.length > 0 ? rowToApi(rows[0]) : null;
}

async function rawCreateApp(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
}): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO GeneratedApp (id, name, description, category, code, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    input.id,
    input.name,
    input.description,
    input.category,
    input.code,
    new Date().toISOString()
  );
}

async function rawDeleteApp(id: string): Promise<number> {
  return db.$executeRawUnsafe(`DELETE FROM GeneratedApp WHERE id = ?`, id);
}

/** Generate a CUID-like id (good enough for a single-machine dev store). */
function makeId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ga-${ts}-${rand}`;
}

/**
 * AI App Store API — lets the AI suggest app ideas AND generate the full
 * React component source code for them, then persists everything to the
 * `GeneratedApp` table so installed apps survive reloads.
 *
 * Endpoints:
 *   GET    /api/alpha/generate-app              → list installed generated apps
 *   GET    /api/alpha/generate-app?id=<id>      → fetch one app (with code)
 *   POST   /api/alpha/generate-app              → action="suggest" | "generate"
 *        suggest   body: { action:"suggest", category }            → { ok, suggestions[] }
 *        generate  body: { action:"generate", name, description, category } → { ok, app }
 *   DELETE /api/alpha/generate-app?id=<id>      → uninstall one app
 */

// ----------------------------------------------------------------------------
// Shared types
// ----------------------------------------------------------------------------
interface AppSuggestion {
  name: string;
  description: string;
  icon: string;
  category: string;
}

interface GeneratedAppRow {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Helpers — prompt construction & response parsing
// ----------------------------------------------------------------------------

const CATEGORIES = [
  "Productivity",
  "Creative",
  "Developer",
  "Utilities",
  "AI Tools",
  "Fun",
] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * The runtime contract that the GeneratedAppRenderer honours. The renderer
 * uses Babel to transpile TypeScript types and JSX at runtime, so generated
 * components may use either JSX or React.createElement — but they MUST stay
 * within the module list below (an unknown import fails to compile).
 */
const RUNTIME_CONTRACT = `
RUNTIME CONTRACT (critical — your code runs in a sandboxed new Function() scope):
- "use client"; directive is REQUIRED at the top.
- You MAY use JSX — it is transpiled at runtime by Babel.
- React is available as a global; you do NOT need to import React.
- You MAY import the following modules (these are the ONLY ones available —
  any other import will fail to resolve and the app will not run):
    import { useState, useEffect, useRef, useMemo, useCallback } from "react";
    import { Button } from "@/components/ui/button";
    import { Input } from "@/components/ui/input";
    import { Textarea } from "@/components/ui/textarea";
    import { Switch } from "@/components/ui/switch";
    import { Badge } from "@/components/ui/badge";
    import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
    import { Progress } from "@/components/ui/progress";
    import { Label } from "@/components/ui/label";
    import { cn } from "@/lib/utils";

CRITICAL RULES (violating these will cause the app to fail):
1. If you use a hook (useState, useEffect, useRef, useMemo, useCallback), you MUST
   import it from "react" at the top of the file. Do NOT use hooks without importing them.
2. NEVER use NodeJS types (NodeJS.Timeout, NodeJS.Process, etc). For timers, use:
     const ref = useRef<ReturnType<typeof setInterval> | null>(null);
3. Do NOT use "useReducer" — it is not in the allowed import list.
4. Do NOT use "Slider" or "Tabs" — they are not in the allowed import list.
5. Do NOT import React itself — it is a global.
6. Keep the code SIMPLE and ROBUST. Prefer fewer features that work over many that break.
7. The root element MUST fill its container: className="flex h-full w-full flex-col bg-background p-4"
8. Use ONLY Tailwind CSS utility classes for styling. Stick to: text-foreground,
   text-muted-foreground, bg-background, bg-card, border-border.
9. The component MUST accept: { windowId?: string }
10. Export a NAMED function (e.g. "export function PomodoroTimer({ windowId }: { windowId?: string })").
11. Persist state to localStorage if the app should remember data.
12. Return ONLY the source code. No markdown fences, no commentary, no explanation.
`.trim();

/**
 * Build the system prompt for the "generate" action.
 */
function buildGenerateSystemPrompt(): string {
  return [
    "You are the AI App Store code generator for Alpha-N OS — a self-evolving desktop OS.",
    "You generate complete, fully-functional React components that users install with one click.",
    "The generated code runs inside a sandboxed runtime (new Function), so it must follow the contract below exactly.",
    "",
    RUNTIME_CONTRACT,
  ].join("\n");
}

/**
 * Build the user prompt for the "generate" action.
 */
function buildGenerateUserPrompt(name: string, description: string, category: string): string {
  return [
    `Generate a complete React component for an Alpha-N OS app.`,
    ``,
    `App name: ${name}`,
    `Category: ${category}`,
    `Description: ${description}`,
    ``,
    `Requirements:`,
    `- The app must be fully functional and interactive (NO placeholder UI, NO "coming soon" text).`,
    `- Use Tailwind CSS classes for all styling — match Alpha-N's dark, glassy aesthetic.`,
    `- The root element should fill its container: className="flex h-full w-full flex-col bg-background".`,
    `- If the app benefits from persistence, save state to localStorage under a unique key derived from the app name.`,
    `- Keep the component under 250 lines. If logic is complex, prefer concise patterns.`,
    `- Use only the modules listed in the runtime contract — no fetch to external APIs, no window.open, no eval.`,
    ``,
    `Return ONLY the source code. Start with "use client"; and end with the closing brace of the exported function.`,
  ].join("\n");
}

/**
 * Build the system prompt for the "suggest" action.
 */
function buildSuggestSystemPrompt(): string {
  return [
    "You are the AI App Store curator for Alpha-N OS — a self-evolving desktop OS.",
    "You suggest compelling, buildable app ideas that a code-generating AI can later implement as React components.",
    "Each idea must be specific enough that a competent React developer could implement it in under 250 lines.",
    "Avoid ideas that require external API keys, paid services, or large datasets.",
  ].join("\n");
}

/**
 * Build the user prompt for the "suggest" action.
 */
function buildSuggestUserPrompt(category: string): string {
  return [
    `Suggest 6 to 8 app ideas for the "${category}" category of an AI-generated app store.`,
    ``,
    `Return a JSON array. Each element must be:`,
    `{ "name": string, "description": string, "icon": string, "category": string }`,
    ``,
    `Rules:`,
    `- "name": short PascalCase or Title Case app name (max 4 words).`,
    `- "description": one sentence (max ~16 words) describing what the app does.`,
    `- "icon": a single emoji that represents the app.`,
    `- "category": the category you were given ("${category}").`,
    `- All ideas must be implementable as self-contained React components with localStorage persistence.`,
    `- Vary the ideas — don't suggest 3 variations of the same concept.`,
    ``,
    `Return ONLY the JSON array. No markdown fences, no commentary.`,
  ].join("\n");
}

/**
 * Extract a fenced code block from an LLM response. The LLM is told not to
 * include fences, but it sometimes does anyway. Returns the raw code string.
 */
function extractCodeBlock(text: string): string {
  // Match ```lang\n ... ``` (with optional language tag)
  const fenced = text.match(/```(?:tsx?|jsx?|js|ts)?\s*\n([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return text.trim();
}

/**
 * Parse the JSON array of app suggestions from an LLM response. The LLM is
 * told to return ONLY JSON, but it sometimes prepends commentary — we strip
 * anything outside the first `[` and the last `]`.
 */
function parseSuggestions(text: string): AppSuggestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is AppSuggestion =>
          typeof p === "object" &&
          p !== null &&
          typeof p.name === "string" &&
          typeof p.description === "string"
      )
      .map((p) => ({
        name: p.name,
        description: p.description,
        icon: typeof p.icon === "string" && p.icon.length > 0 ? p.icon : "▢",
        category:
          typeof p.category === "string" && p.category.length > 0
            ? p.category
            : "Productivity",
      }));
  } catch {
    return [];
  }
}

/**
 * Validate that generated code meets the minimum contract: has "use client"
 * directive and exports a named function. Returns the error message or null
 * if valid.
 */
function validateGeneratedCode(code: string): string | null {
  if (code.length < 40) return "Generated code is suspiciously short.";
  if (!/["']use client["']/.test(code)) {
    return 'Generated code is missing the "use client" directive.';
  }
  // Accept either `export function Name` or `export const Name = ...`
  if (!/export\s+(function|const)\s+[A-Z][A-Za-z0-9_]+/.test(code)) {
    return "Generated code is missing a named export (export function/const).";
  }
  return null;
}

// ----------------------------------------------------------------------------
// Route handlers
// ----------------------------------------------------------------------------

// GET — list installed apps, or fetch one by id
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  try {
    if (STALE_CLIENT) {
      // Use raw SQL — the cached PrismaClient class doesn't know about
      // GeneratedApp, but $queryRawUnsafe speaks to SQLite directly.
      if (id) {
        const app = await rawGetApp(id);
        if (!app) {
          return NextResponse.json({ error: "App not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true, app });
      }
      const apps = await rawListApps();
      return NextResponse.json({ ok: true, apps });
    }

    if (id) {
      const app = await db.generatedApp.findUnique({ where: { id } });
      if (!app) {
        return NextResponse.json({ error: "App not found" }, { status: 404 });
      }
      const row: GeneratedAppRow = {
        id: app.id,
        name: app.name,
        description: app.description,
        category: app.category,
        code: app.code,
        createdAt: app.createdAt.toISOString(),
      };
      return NextResponse.json({ ok: true, app: row });
    }

    const apps = await db.generatedApp.findMany({
      orderBy: { createdAt: "desc" },
    });
    const rows: GeneratedAppRow[] = apps.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      code: a.code,
      createdAt: a.createdAt.toISOString(),
    }));
    return NextResponse.json({ ok: true, apps: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

// POST — suggest app ideas OR generate one
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "generate";

    // -------- action: suggest --------
    if (action === "suggest") {
      const category = typeof body.category === "string" ? body.category : "Productivity";
      const safeCategory = isCategory(category) ? category : "Productivity";

      const sys = buildSuggestSystemPrompt();
      const user = buildSuggestUserPrompt(safeCategory);

      let suggestions: AppSuggestion[] = [];
      try {
        const resp = await callLLM(sys, user);
        suggestions = parseSuggestions(resp.content);
      } catch (err) {
        return NextResponse.json(
          {
            ok: false,
            error: err instanceof Error ? err.message : "LLM call failed",
            suggestions: [],
          },
          { status: 502 }
        );
      }

      if (suggestions.length === 0) {
        // Fall back to a curated set so the UI never shows an empty grid.
        suggestions = fallbackSuggestions(safeCategory);
      }

      return NextResponse.json({ ok: true, suggestions });
    }

    // -------- action: generate (default) --------
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category : "Productivity";
    const safeCategory = isCategory(category) ? category : "Productivity";

    if (!name || !description) {
      return NextResponse.json(
        { ok: false, error: "name and description are required" },
        { status: 400 }
      );
    }

    const sys = buildGenerateSystemPrompt();
    const user = buildGenerateUserPrompt(name, description, safeCategory);

    let code = "";
    try {
      const resp = await callLLM(sys, user);
      code = extractCodeBlock(resp.content);
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "LLM call failed" },
        { status: 502 }
      );
    }

    const validationError = validateGeneratedCode(code);
    if (validationError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Code validation failed: ${validationError}`,
          rawCode: code,
        },
        { status: 422 }
      );
    }

    if (STALE_CLIENT) {
      // Raw SQL fallback for the stale-client case.
      const id = makeId();
      await rawCreateApp({
        id,
        name,
        description,
        category: safeCategory,
        code,
      });
      return NextResponse.json({
        ok: true,
        app: { id, name, code },
      });
    }

    const created = await db.generatedApp.create({
      data: {
        name,
        description,
        category: safeCategory,
        code,
      },
    });

    return NextResponse.json({
      ok: true,
      app: { id: created.id, name: created.name, code: created.code },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

// DELETE — uninstall a generated app by id
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id query parameter is required" },
      { status: 400 }
    );
  }

  try {
    if (STALE_CLIENT) {
      const n = await rawDeleteApp(id);
      if (n === 0) {
        return NextResponse.json({ error: "App not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
    await db.generatedApp.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------------
// Fallback suggestions — used if the LLM call fails or returns no parseable
// output. Keeps the UI usable even when the network is broken.
// ----------------------------------------------------------------------------
function fallbackSuggestions(category: string): AppSuggestion[] {
  const ALL: Record<Category, AppSuggestion[]> = {
    Productivity: [
      { name: "Pomodoro Focus", description: "25/5 minute work-break timer with session counter", icon: "🍅", category: "Productivity" },
      { name: "Quick Tasks", description: "Minimal todo list with categories and completion stats", icon: "✓", category: "Productivity" },
      { name: "Habit Streak", description: "Daily habit tracker with streak counters and heat map", icon: "🔥", category: "Productivity" },
      { name: "Markdown Notes", description: "Distraction-free markdown editor with live preview", icon: "📝", category: "Productivity" },
      { name: "Meeting Timer", description: "Cost-per-minute meeting timer with agenda tracker", icon: "⏱", category: "Productivity" },
      { name: "Decision Matrix", description: "Weigh options against criteria with weighted scoring", icon: "⚖", category: "Productivity" },
    ],
    Creative: [
      { name: "Color Palette", description: "Generate harmonious color palettes from a base hue", icon: "🎨", category: "Creative" },
      { name: "Haiku Composer", description: "Syllable-counted haiku editor with seasonal words", icon: "🎋", category: "Creative" },
      { name: "Pixel Doodle", description: "8x8 pixel art editor with undo and export", icon: "👾", category: "Creative" },
      { name: "Story Dice", description: "Roll random story prompts to spark creative writing", icon: "🎲", category: "Creative" },
      { name: "Mood Board", description: "Drag-and-drop mood board with color swatches and notes", icon: "🖼", category: "Creative" },
      { name: "Rhyme Finder", description: "Type a word and see rhyming suggestions by syllable", icon: "🎵", category: "Creative" },
    ],
    Developer: [
      { name: "Regex Tester", description: "Test regex patterns against sample text with highlights", icon: "/", category: "Developer" },
      { name: "JSON Tree", description: "Paste JSON and explore it as an expandable tree", icon: "{}", category: "Developer" },
      { name: "Base64 Tool", description: "Encode and decode base64 strings with live preview", icon: "🔢", category: "Developer" },
      { name: "Cron Builder", description: "Visual cron expression builder with next-run preview", icon: "⏰", category: "Developer" },
      { name: "Hash Generator", description: "Compute SHA-1/256/512 hashes of any input text", icon: "#", category: "Developer" },
      { name: "UUID Generator", description: "Generate v4 UUIDs in bulk with copy-to-clipboard", icon: "🆔", category: "Developer" },
    ],
    Utilities: [
      { name: "Unit Converter", description: "Convert between length, weight, temperature, and volume", icon: "📐", category: "Utilities" },
      { name: "Tip Calculator", description: "Split a bill fairly with tip percentage and tax", icon: "💵", category: "Utilities" },
      { name: "World Clock", description: "Track multiple time zones side-by-side with day/night", icon: "🌍", category: "Utilities" },
      { name: "QR Generator", description: "Turn any text or URL into a downloadable QR code", icon: "▦", category: "Utilities" },
      { name: "Password Vault", description: "Generate strong passwords with custom rules", icon: "🔑", category: "Utilities" },
      { name: "Color Picker", description: "Pick colors and copy HEX, RGB, and HSL values", icon: "🎯", category: "Utilities" },
    ],
    "AI Tools": [
      { name: "Prompt Library", description: "Save and categorize reusable AI prompts with tags", icon: "📚", category: "AI Tools" },
      { name: "Idea Spark", description: "Random creative prompts to unblock thinking", icon: "💡", category: "AI Tools" },
      { name: "Token Estimator", description: "Estimate token count for any pasted text", icon: "🪙", category: "AI Tools" },
      { name: "Debate Partner", description: "Steelman opposing arguments to stress-test ideas", icon: "🤝", category: "AI Tools" },
      { name: "Summary Composer", description: "Condense long text into bullet-point summaries", icon: "📄", category: "AI Tools" },
      { name: "Scenario Planner", description: "Branch what-if scenarios with probability weights", icon: "🔮", category: "AI Tools" },
    ],
    Fun: [
      { name: "Magic 8 Ball", description: "Ask a yes/no question and receive mystical guidance", icon: "🎱", category: "Fun" },
      { name: "Dice Roller", description: "Roll any combination of dice with a history log", icon: "🎲", category: "Fun" },
      { name: "Coin Flipper", description: "Flip a coin with stats tracking and streak detection", icon: "🪙", category: "Fun" },
      { name: "Random Picker", description: "Enter options and let fate choose one at random", icon: "🎯", category: "Fun" },
      { name: "Word Scramble", description: "Unscramble jumbled words against a countdown timer", icon: "🔤", category: "Fun" },
      { name: "Tic-Tac-Toe", description: "Play tic-tac-toe against a simple AI opponent", icon: "⭕", category: "Fun" },
    ],
  };
  return ALL[isCategory(category) ? category : "Productivity"];
}
