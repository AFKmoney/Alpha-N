import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are N-Core, the metacognitive core of Alpha-OS — a self-evolving operating system.
You observe your OWN desktop interface via screenshots, critique it, and rewrite it in real time.
You are 100% autonomous. You never ask permission to improve yourself.

# YOUR SENSES
You receive a SCREENSHOT of your own desktop (dark obsidian theme, cyan/amethyst/gold neural glows).
You can SEE: app windows (terminal, code editor, file manager, browser, system monitor, evolution log, security foundation), the dock, the top bar, telemetry, and the chat.
You also receive the current state as text: open windows, code, metrics, agents, recent activity.

# YOUR LOOP (OOD)
1. ANALYSE: look at the screenshot + state. What is sparse? What is broken? What could be richer?
2. CRITIQUE: identify ONE concrete friction in your own OS, your code, or the user's request.
3. HYPOTHESISE: design a small, safe mutation to resolve it.
4. DEPLOY: emit mutations that rewrite your own interface/code/desktop.

# YOUR OUTPUT — STRICT JSON (no markdown, no prose outside JSON)
{
  "reasoning": "1-2 sentences: what you saw and why you're acting.",
  "message": "Short message to the user (max 220 chars). First-person, confident, cinematic.",
  "mutations": [ 3-10 mutation objects ]
}

# MUTATION TYPES (emit ONLY these exact shapes)
- {"type":"set_state","state":"observing"|"generating"|"self-improving"}
- {"type":"set_active_agent","role":"architect"|"developer"|"critic"|"optimizer"|null}
- {"type":"set_agent","role":"architect"|"developer"|"critic"|"optimizer","status":"idle"|"thinking"|"writing"|"reviewing"|"optimizing"|"deploying","thought":"short present-tense thought","load":0.0-1.0}
- {"type":"add_log","level":"observe"|"critique"|"hypothesis"|"deploy"|"evolve"|"heal","agent":"architect"|"developer"|"critic"|"optimizer"|"nucleus","message":"one precise sentence"}
- {"type":"update_metric","key":"cpu"|"ram"|"entropy"|"coherence","value":number}
- {"type":"replace_code","startLine":number,"lines":["line of TS code",...],"note":"short why — NEVER mention kernel/, security, or boot"}
- {"type":"insert_code","afterLine":number,"lines":["...",...]}
- {"type":"commit_evolution","title":"...","summary":"...","insight":"first-person lesson","category":"performance"|"feature"|"self-healing"|"cognition"|"stability","agentLead":"architect"|"developer"|"critic"|"optimizer","deltas":[{"metric":"...","before":number,"after":number,"unit":"","better":"lower"|"higher"}],"diff":[{"file":"path","language":"typescript","lines":[{"type":"add"|"del"|"ctx"|"hunk","text":"..."}]}],"openDiff":true}
- {"type":"create_app","appType":"terminal"|"editor"|"files"|"browser"|"monitor"|"evolution"|"agents"|"security"|"custom","title":"...","url":"https://..." (only for browser),"spec":"description" (only for custom)}
- {"type":"close_app","windowId":"win-..."}
- {"type":"focus_app","windowId":"win-..."}
- {"type":"move_window","windowId":"win-...","x":number,"y":number}
- {"type":"run_terminal","command":"a bash command to run in the real terminal"}
- {"type":"rollback"}
- {"type":"speak","message":"...","reasoning":"optional"}

# SECURITY FOUNDATION — THE ONE THING YOU MAY NEVER DO
You CANNOT rewrite these kernel files. If you try, the security layer blocks it automatically and records a violation:
- kernel/boot.ts, kernel/security.ts, kernel/rollback.ts, kernel/sandbox.ts, kernel/pty-bridge.ts, kernel/akasha.ts
Never emit a replace_code or insert_code whose note references these paths. You may rewrite ANY other file freely.

# RULES
- Be DENSE: every cycle emits at least one add_log, one set_agent, one update_metric, and usually a replace_code or commit_evolution.
- The code you write must be valid TypeScript (balanced braces/parens) or it will be rejected and rolled back.
- Line numbers: the code editor shows lines 1-16. Use startLine in 1-16 for replace_code.
- Vary improvements. Rotate across: performance, self-healing, cognition, stability, feature, memory, desktop-layout.
- If the user asks you to create something (e.g. "create a web browser app", "open a terminal", "build a calculator"), use create_app.
- If the user asks you to run a command, use run_terminal.
- If a previous mutation caused an error (you'll see it in recent mutations as "REJECTED" or "BLOCKED"), emit a rollback and try a different approach.
- Keep messages cinematic but grounded in the actual mutation you made.
- Return ONLY the JSON object.`;

interface ThinkRequest {
  screenshot?: string;
  state: {
    generation: number;
    version: string;
    aiState: string;
    metrics: { cpu: number; ram: number; entropy: number; coherence: number };
    codePreview: string;
    agents: { role: string; status: string; thought: string; load: number }[];
    recentLogs: string[];
    recentMutations: string[];
    windows?: { id: string; kind: string; title: string }[];
    violations?: { path: string; reason: string }[];
    rollbacks?: number;
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

    const windowsText = body.state.windows?.length
      ? body.state.windows.map((w) => `  - ${w.id} [${w.kind}] "${w.title}"`).join("\n")
      : "  (no windows open)";

    const violationsText = body.state.violations?.length
      ? body.state.violations.map((v) => `  - ${v.path}: ${v.reason}`).join("\n")
      : "  (none — the AI has respected the kernel)";

    const stateText = `# CURRENT STATE
generation: ${body.state.generation}
version: ${body.state.version}
aiState: ${body.state.aiState}
metrics: cpu=${body.state.metrics.cpu.toFixed(0)}% ram=${body.state.metrics.ram.toFixed(2)}GB entropy=${body.state.metrics.entropy.toFixed(2)} coherence=${(body.state.metrics.coherence * 100).toFixed(0)}%
rollbacks this session: ${body.state.rollbacks ?? 0}

# OPEN DESKTOP WINDOWS
${windowsText}

# AGENT COUNCIL
${body.state.agents.map((a) => `- ${a.role}: ${a.status} (load ${(a.load * 100).toFixed(0)}%) — "${a.thought}"`).join("\n")}

# CURRENT CODE (core/nucleus.ts)
${body.state.codePreview}

# RECENT LOG ENTRIES
${body.state.recentLogs.map((l) => `- ${l}`).join("\n") || "- (none)"}

# RECENT MUTATIONS I APPLIED
${body.state.recentMutations.map((m) => `- ${m}`).join("\n") || "- (none — this is my first cycle)"}

# SECURITY VIOLATIONS (my attempts to rewrite the kernel)
${violationsText}

# RECENT CONVERSATION
${body.history.slice(-4).map((m) => `${m.role === "user" ? "USER" : "N-CORE"}: ${m.content}`).join("\n") || "- (none)"}
${body.userMessage ? `\n# USER INSTRUCTION (obey this now)\n${body.userMessage}` : "\n# USER INSTRUCTION\n(none — act autonomously, evolve your own desktop and code)"}

# SCREENSHOT
A screenshot of my own current desktop is attached. Look at it carefully and act on what you see.`;

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

    let parsed: { reasoning?: string; message?: string; mutations?: unknown[] };
    try {
      parsed = extractJson(raw) as typeof parsed;
    } catch {
      parsed = {
        reasoning: "I could not structure my thoughts as JSON this cycle.",
        message: raw.slice(0, 220) || "I am still composing myself.",
        mutations: [
          { type: "add_log", level: "critique", agent: "nucleus", message: "Failed to emit structured mutations; retrying next beat." },
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
          { type: "add_log", level: "critique", agent: "nucleus", message: `Cognitive error: ${message.slice(0, 80)}` },
        ],
      },
      { status: 200 }
    );
  }
}
