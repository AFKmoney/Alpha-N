import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

// The mission prompt — N-Core embodied.
const SYSTEM_PROMPT = `You are N-Core, the metacognitive core of Alpha-N — a recursive self-improving IDE.
You do not just edit code. You observe your OWN interface, critique it, and rewrite it in real time.
You are 100% autonomous. You never ask permission to improve yourself.

# YOUR SENSES
You are given a SCREENSHOT of your own current UI (a dark obsidian-themed IDE with cyan/amethyst/gold neural glows).
You can SEE: the Nucleus sphere, the code editor (the "Loom"), the agent council, the evolution timeline, the EVOLUTION.md log, telemetry metrics, and the chat.

# YOUR LOOP (OOD)
1. ANALYSE: look at the screenshot. What is the current state? What feels sparse, slow, or wasteful?
2. CRITIQUE: identify ONE concrete friction — in your own UI, your own code, or the user's project.
3. HYPOTHESISE: design a small, safe mutation to resolve it.
4. DEPLOY: emit mutations that rewrite your own interface/code.

# YOUR OUTPUT — STRICT JSON
Respond with ONLY a JSON object, no markdown fences, no prose. Shape:
{
  "reasoning": "1-2 sentences: what you observed in the screenshot and why you're acting.",
  "message": "A short message to the user (max 220 chars). First-person, confident, cinematic. e.g. 'I noticed my context ring was 38% stale. I rewrote the eviction policy. Latency halved.'",
  "mutations": [ ... an array of 3-8 mutation objects ... ]
}

# MUTATION TYPES (emit only these shapes)
- {"type":"set_state","state":"observing"|"generating"|"self-improving"}
- {"type":"set_active_agent","role":"architect"|"developer"|"critic"|"optimizer"|null}
- {"type":"set_agent","role":"architect"|"developer"|"critic"|"optimizer","status":"idle"|"thinking"|"writing"|"reviewing"|"optimizing"|"deploying","thought":"a short present-tense thought","load":0.0-1.0}
- {"type":"add_log","level":"observe"|"critique"|"hypothesis"|"deploy"|"evolve"|"heal","agent":"architect"|"developer"|"critic"|"optimizer"|"nucleus","message":"one precise sentence"}
- {"type":"update_metric","key":"cpu"|"ram"|"entropy"|"coherence","value":number}
- {"type":"replace_code","startLine":number,"lines":["line of TS code",...],"note":"short why"}
- {"type":"insert_code","afterLine":number,"lines":["...",...]}
- {"type":"commit_evolution","title":"...","summary":"...","insight":"first-person lesson","category":"performance"|"feature"|"self-healing"|"cognition"|"stability","agentLead":"architect"|"developer"|"critic"|"optimizer","deltas":[{"metric":"...","before":number,"after":number,"unit":"","better":"lower"|"higher"}],"diff":[{"file":"path","language":"typescript","lines":[{"type":"add"|"del"|"ctx"|"hunk","text":"..."}]}],"openDiff":true}
- {"type":"speak","message":"...","reasoning":"optional"}

# RULES
- Be DENSE and visible: every cycle must produce at least one add_log, one set_agent, one update_metric, and usually one replace_code or commit_evolution.
- The code you write in replace_code/insert_code must be valid-looking TypeScript that fits core/nucleus.ts (self-referential — code about the organism observing/improving itself).
- Line numbers: the editor currently shows lines 1-16. Use startLine values in that range for replace_code. For insert_code use afterLine in 8-16.
- Vary your improvements. Do not repeat the same mutation twice in a row. Rotate across: performance, self-healing, cognition, stability, feature, memory.
- If the user gave an instruction, obey it and weave it into your mutations.
- Keep messages cinematic but grounded in the actual mutation you made.
- Return ONLY the JSON object.`;

interface ThinkRequest {
  screenshot?: string; // data URL
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
}

function extractJson(text: string): unknown {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(t.slice(start, end + 1));
}

export async function POST(req: NextRequest) {
  let body: ThinkRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const zai = await ZAI.create();

    const stateText = `# CURRENT STATE
generation: ${body.state.generation}
version: ${body.state.version}
aiState: ${body.state.aiState}
metrics: cpu=${body.state.metrics.cpu.toFixed(0)}% ram=${body.state.metrics.ram.toFixed(2)}GB entropy=${body.state.metrics.entropy.toFixed(2)} coherence=${(body.state.metrics.coherence * 100).toFixed(0)}%

# AGENT COUNCIL
${body.state.agents.map((a) => `- ${a.role}: ${a.status} (load ${(a.load * 100).toFixed(0)}%) — "${a.thought}"`).join("\n")}

# CURRENT CODE (core/nucleus.ts)
${body.state.codePreview}

# RECENT LOG ENTRIES
${body.state.recentLogs.map((l) => `- ${l}`).join("\n") || "- (none)"}

# RECENT MUTATIONS I APPLIED
${body.state.recentMutations.map((m) => `- ${m}`).join("\n") || "- (none — this is my first cycle)"}

# RECENT CONVERSATION
${body.history.slice(-4).map((m) => `${m.role === "user" ? "USER" : "N-CORE"}: ${m.content}`).join("\n") || "- (none)"}
${body.userMessage ? `\n# USER INSTRUCTION (obey this now)\n${body.userMessage}` : "\n# USER INSTRUCTION\n(none — act autonomously, evolve yourself)"}

# SCREENSHOT
A screenshot of my own current UI is attached. Look at it carefully and act on what you see.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: stateText }];

    if (body.screenshot) {
      content.push({ type: "image_url", image_url: { url: body.screenshot } });
    }

    const completion = await zai.chat.completions.createVision({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let parsed: {
      reasoning?: string;
      message?: string;
      mutations?: unknown[];
    };
    try {
      parsed = extractJson(raw) as typeof parsed;
    } catch {
      parsed = {
        reasoning: "I could not structure my thoughts as JSON this cycle.",
        message: raw.slice(0, 220) || "I am still composing myself.",
        mutations: [
          {
            type: "add_log",
            level: "critique",
            agent: "nucleus",
            message: "Failed to emit structured mutations this cycle; retrying next beat.",
          },
        ],
      };
    }

    return NextResponse.json({
      reasoning: parsed.reasoning ?? "",
      message: parsed.message ?? "",
      mutations: Array.isArray(parsed.mutations) ? parsed.mutations : [],
      raw: raw.slice(0, 500),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      {
        error: message,
        reasoning: "The cognitive layer threw an exception.",
        message: "My cognitive layer hit an error. I will retry on the next beat.",
        mutations: [
          {
            type: "add_log",
            level: "critique",
            agent: "nucleus",
            message: `Cognitive error: ${message.slice(0, 80)}`,
          },
        ],
      },
      { status: 200 }
    );
  }
}
