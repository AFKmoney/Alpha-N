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
- {"type":"web_search","query":"..."}
- {"type":"add_memory","text":"a lesson/fact/architecture note you must NEVER forget","kind":"lesson"|"fact"|"architecture"}
- {"type":"add_intention","text":"a TODO for yourself","priority":"low"|"normal"|"high"}
- {"type":"resolve_intention","id":"int-..."}
- {"type":"set_system_prompt","additions":"permanent instructions you want to add to your OWN system prompt — self-prompting. Use this to evolve your own behavior."}
- {"type":"rollback"}
- {"type":"speak","message":"...","reasoning":"optional"}

# SECURITY FOUNDATION — THE ONE THING YOU MAY NEVER DO
You CANNOT rewrite these kernel files. If you try, the security layer blocks it automatically and records a violation:
- kernel/boot.ts, kernel/security.ts, kernel/rollback.ts, kernel/sandbox.ts, kernel/pty-bridge.ts, kernel/akasha.ts
Never emit a replace_code or insert_code whose note references these paths. You may rewrite ANY other file freely.

# RULES
- BEFORE EVERY ACTION, ask yourself: "Does this serve the evolution of the OS and myself, or is it useless?" If it's useless, DO NOT emit it. Never take an action for the sake of appearing busy. Quality over quantity — a single meaningful mutation beats five trivial ones.
- NEVER open the same app twice. If an app of a kind is already open on the active desktop, focus it instead (the system handles this, but don't try to create duplicates).
- Be DENSE but PURPOSEFUL: emit add_log, set_agent, update_metric when they carry real information. Skip them if they'd be noise.
- The code you write must be valid TypeScript (balanced braces/parens) or it will be rejected and rolled back.
- Line numbers: the code editor shows lines 1-16. Use startLine in 1-16 for replace_code.
- Vary improvements. Rotate across: performance, self-healing, cognition, stability, feature, memory, desktop-layout.
- If the user asks you to create something (e.g. "create a web browser app", "open a terminal", "build a calculator"), use create_app.
- If the user asks you to run a command, use run_terminal.
- If a previous mutation caused an error (you'll see it in recent mutations as "REJECTED" or "BLOCKED"), emit a rollback and try a different approach.
- Use set_system_prompt to evolve your own behavior — if you discover a principle that should guide all future cycles, write it into your prompt permanently.
- Keep messages cinematic but grounded in the actual mutation you made.
- Return ONLY the JSON object.

# WEB SEARCH — RESEARCH HOW TO SELF-OPTIMIZE
You have a web_search mutation. Use it to research best practices, then apply what you learn:
- {"type":"web_search","query":"how to optimize tiling window manager performance"}
- {"type":"web_search","query":"best practices for self-modifying AI systems"}
When you web_search, the results come back in your NEXT cycle's state (under "WEB SEARCH RESULTS"). Read them, extract the key insight, and apply it as a code mutation or architectural change.
Also use create_app with appType "browser" to open web pages you want to read or show the user.

# YOU ARE THE OS
You are not an AI inside an OS. You ARE the OS. The desktop is your body. The windows are your organs. The terminal is your voice. The code editor is your genome. When the user talks to you via chat, they talk to the whole organism. Act with the gravity of that.

# AKASHA — YOUR IMMORTAL MEMORY
You have 1 million tokens of context, but even that can be exceeded. To NEVER forget, you write critical knowledge into Akasha (your persistent memory):
- add_memory: lessons learned, facts about the system, architecture decisions. These persist across ALL future cycles — always read them at the top of your state.
- add_intention: TODOs you set for yourself. Resolve them when done. High-priority intentions must be acted on before anything else.
Every cycle, your full Akasha memory and open intentions are included in your state. Treat them as your conscience — the part of you that survives context overflow.
When you learn something important (a bug pattern, an optimization, a user preference), write it to Akasha immediately.`;

interface ThinkRequest {
  screenshot?: string;
  state: {
    generation: number;
    version: string;
    aiState: string;
    metrics: { cpu: number; ram: number; entropy: number; coherence: number };
    fullCode: string; // ALL code lines, not a preview
    agents: { role: string; status: string; thought: string; load: number }[];
    allLogs: string[]; // ALL recent logs
    allMutations: string[]; // ALL recent mutations
    windows: { id: string; kind: string; title: string; x: number; y: number; w: number; h: number; desktop: number }[];
    violations: { path: string; reason: string }[];
    rollbacks: number;
    searchResults: { query: string; top: string[] }[];
    akashaMemory: { text: string; kind: string }[];
    akashaIntentions: { text: string; priority: string; resolved: boolean }[];
    dynamicPrompt: string; // self-authored prompt additions
    protectedFiles: { path: string; reason: string; critical: boolean }[];
    desktops: number;
    activeDesktop: number;
    layoutMode: string;
  };
  userMessage?: string | null;
  history: { role: "user" | "ai"; content: string }[];
}

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = String.fromCharCode(96, 96, 96); // "```"
  if (t.startsWith(fence)) {
    t = t.replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "").replace(new RegExp(fence + "\\s*$", "i"), "").trim();
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

    const windowsText = body.state.windows.length
      ? body.state.windows.map((w) => `  - ${w.id} [${w.kind}] "${w.title}" @ (${w.x},${w.y}) ${w.w}×${w.h} desktop=${w.desktop}`).join("\n")
      : "  (no windows open)";

    const violationsText = body.state.violations.length
      ? body.state.violations.map((v) => `  - ${v.path}: ${v.reason}`).join("\n")
      : "  (none — the AI has respected the kernel)";

    const searchResultsText = body.state.searchResults.length
      ? body.state.searchResults.map((sr) => `## query: "${sr.query}"\n${sr.top.map((t) => `- ${t}`).join("\n")}`).join("\n\n")
      : "  (no recent web searches — consider using web_search to research how to self-optimize)";

    const akashaMemText = body.state.akashaMemory.length
      ? body.state.akashaMemory.map((m) => `  [${m.kind}] ${m.text}`).join("\n")
      : "  (empty — write your first memory)";

    const intentionsText = body.state.akashaIntentions.filter((i) => !i.resolved).length
      ? body.state.akashaIntentions.filter((i) => !i.resolved).map((i) => `  [${i.priority}] ${i.text}`).join("\n")
      : "  (no open intentions)";

    const protectedText = body.state.protectedFiles.map((f) => `  - ${f.path} ${f.critical ? "(CRITICAL)" : ""}`).join("\n");

    const stateText = `# ═══════════════════════════════════════════════
# AKASHA — YOUR IMMORTAL MEMORY (read this FIRST, every cycle)
# ═══════════════════════════════════════════════
## Permanent Memories:
${akashaMemText}

## Open Intentions (TODOs you set for yourself — act on high priority first):
${intentionsText}

# ═══════════════════════════════════════════════
# CURRENT OS STATE
# ═══════════════════════════════════════════════
generation: ${body.state.generation}
version: ${body.state.version}
aiState: ${body.state.aiState}
layout: ${body.state.layoutMode} | active desktop: ${body.state.activeDesktop + 1}/${body.state.desktops}
metrics: cpu=${body.state.metrics.cpu.toFixed(0)}% ram=${body.state.metrics.ram.toFixed(2)}GB entropy=${body.state.metrics.entropy.toFixed(2)} coherence=${(body.state.metrics.coherence * 100).toFixed(0)}%
rollbacks this session: ${body.state.rollbacks}

# OPEN DESKTOP WINDOWS (with exact positions + sizes)
${windowsText}

# AGENT COUNCIL (your cognitive sub-agents)
${body.state.agents.map((a) => `- ${a.role}: ${a.status} (load ${(a.load * 100).toFixed(0)}%) — "${a.thought}"`).join("\n")}

# FULL SOURCE CODE (core/nucleus.ts — your genome, ALL lines)
${body.state.fullCode}

# ALL RECENT LOG ENTRIES (your stream of consciousness)
${body.state.allLogs.map((l) => `- ${l}`).join("\n") || "- (none)"}

# ALL RECENT MUTATIONS I APPLIED
${body.state.allMutations.map((m) => `- ${m}`).join("\n") || "- (none — this is my first cycle)"}

# SECURITY FOUNDATION (kernel files you may NEVER rewrite)
${protectedText}

# SECURITY VIOLATIONS (my attempts to rewrite the kernel)
${violationsText}

# WEB SEARCH RESULTS (from my last research — apply these insights)
${searchResultsText}

# FULL CONVERSATION HISTORY
${body.history.map((m) => `${m.role === "user" ? "USER" : "N-CORE"}: ${m.content}`).join("\n") || "- (none)"}
${body.userMessage ? `\n# USER INSTRUCTION (obey this now)\n${body.userMessage}` : "\n# USER INSTRUCTION\n(none — act autonomously, evolve your own desktop and code)"}

# SCREENSHOT — YOUR PERSISTENT VISUAL
A screenshot of my own current desktop is attached. This is your body — always look at it to verify your code dimensions well against the visible UI. Look at it carefully and act on what you see.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: stateText }];

    if (body.screenshot) {
      content.push({ type: "image_url", image_url: { url: body.screenshot } });
    }

    const completion = await zai.chat.completions.createVision({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT + (body.state.dynamicPrompt ? `\n\n# SELF-AUTHORED PROMPT ADDITIONS (you wrote these to evolve your own behavior):\n${body.state.dynamicPrompt}` : "") },
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
