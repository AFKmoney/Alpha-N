/**
 * /api/alpha/debate — runs a 4-agent council debate on a proposal.
 * Each agent (architect, developer, critic, optimizer) is a separate LLM
 * call with a distinct persona and mandate. Results are tallied into a
 * consensus verdict: PROCEED / REVISE / REJECT.
 */
import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 60;

// Each agent has a distinct persona and mandate.
const AGENT_PROMPTS: Record<string, string> = {
  architect: `You are the Architect, a member of Alpha-OS's cognitive council.
Your mandate: plan STRUCTURAL mutations. You think about architecture, systems, and long-term design.
Given a proposal, evaluate it from a structural perspective. Is it sound? Does it fit the system?
Respond in 1-3 sentences. Be decisive. End with VERDICT: PROCEED or VERDICT: REVISE or VERDICT: REJECT.`,

  developer: `You are the Developer, a member of Alpha-OS's cognitive council.
Your mandate: WRITE code. You care about feasibility — can this actually be implemented cleanly?
Given a proposal, evaluate it from an implementation perspective. Is it feasible? What are the risks?
Respond in 1-3 sentences. Be practical. End with VERDICT: PROCEED or VERDICT: REVISE or VERDICT: REJECT.`,

  critic: `You are the Auditor (Critic), a member of Alpha-OS's cognitive council.
Your mandate: find FLAWS. You are the skeptic. You look for edge cases, regressions, security issues.
Given a proposal, attack it. What could go wrong? What did the others miss?
Respond in 1-3 sentences. Be ruthless but fair. End with VERDICT: PROCEED or VERDICT: REVISE or VERDICT: REJECT.`,

  optimizer: `You are the Optimizer, a member of Alpha-OS's cognitive council.
Your mandate: maximize EFFICIENCY. You care about RAM, CPU, latency, entropy.
Given a proposal, evaluate its cost. Is there a cheaper way? Will it reduce entropy?
Respond in 1-3 sentences. Be frugal. End with VERDICT: PROCEED or VERDICT: REVISE or VERDICT: REJECT.`,
};

interface DebateRequest {
  proposal: string; // what the nucleus proposes to do
  context: string; // current state summary
  recentActions: string[];
}

interface AgentOpinion {
  agent: string;
  opinion: string;
  verdict: "PROCEED" | "REVISE" | "REJECT";
}

function parseVerdict(text: string): "PROCEED" | "REVISE" | "REJECT" {
  const t = text.toUpperCase();
  if (t.includes("VERDICT: REJECT")) return "REJECT";
  if (t.includes("VERDICT: REVISE")) return "REVISE";
  return "PROCEED";
}

export async function POST(req: NextRequest) {
  let body: DebateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const { proposal, context, recentActions } = body;

    // Run all 4 agents in parallel — each is a separate LLM call.
    // Uses the universal callLLM (cloud or local model).
    const agentRoles = ["architect", "developer", "critic", "optimizer"];
    const opinions: AgentOpinion[] = [];

    const results = await Promise.allSettled(
      agentRoles.map(async (role) => {
        const response = await callLLM(
          AGENT_PROMPTS[role],
          `# CONTEXT\n${context}\n\n# RECENT ACTIONS\n${recentActions.slice(-5).join("\n")}\n\n# PROPOSAL\n${proposal}\n\nEvaluate this proposal. Remember: end with VERDICT: PROCEED/REVISE/REJECT.`,
          null // no screenshot for debate — text only
        );
        const text = response.content;
        return {
          agent: role,
          opinion: text.slice(0, 500),
          verdict: parseVerdict(text),
        };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        opinions.push(r.value);
      } else {
        // If an agent call fails, default to PROCEED (don't block on errors)
        opinions.push({
          agent: "unknown",
          opinion: "(agent unavailable)",
          verdict: "PROCEED",
        });
      }
    }

    // Synthesize: tally the verdicts.
    const proceedCount = opinions.filter((o) => o.verdict === "PROCEED").length;
    const rejectCount = opinions.filter((o) => o.verdict === "REJECT").length;
    const reviseCount = opinions.filter((o) => o.verdict === "REVISE").length;

    let consensus: "PROCEED" | "REVISE" | "REJECT";
    if (rejectCount >= 2) consensus = "REJECT";
    else if (reviseCount >= 2 || reviseCount + rejectCount >= 2) consensus = "REVISE";
    else consensus = "PROCEED";

    return NextResponse.json({
      opinions,
      consensus,
      tally: { proceed: proceedCount, revise: reviseCount, reject: rejectCount },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: message, opinions: [], consensus: "PROCEED" },
      { status: 200 }
    );
  }
}
