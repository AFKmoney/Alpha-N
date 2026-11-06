/**
 * /api/alpha/debate — the agent council. Four separate LLM calls with
 * distinct personas and mandates weigh a proposal; verdicts are tallied
 * into a consensus the loop must respect (REJECT vetoes).
 */
import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/alpha/model-config";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Opinion {
  agent: string;
  opinion: string;
  verdict: "PROCEED" | "REVISE" | "REJECT";
}

const AGENTS: { key: string; mandate: string }[] = [
  { key: "architect", mandate: "Structural soundness: does this fit the architecture cleanly?" },
  { key: "developer", mandate: "Feasibility: is this implementable without breaking working code?" },
  { key: "critic", mandate: "Risk: what could break? Is the change necessary at all?" },
  { key: "optimizer", mandate: "Efficiency: does this make the system faster, smaller, clearer?" },
];

function parseVerdict(text: string): "PROCEED" | "REVISE" | "REJECT" {
  const upper = text.toUpperCase();
  if (upper.includes("REJECT")) return "REJECT";
  if (upper.includes("REVISE")) return "REVISE";
  return "PROCEED";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { proposal?: string; context?: string; recent?: string[] };
    const proposal = String(body.proposal ?? "").slice(0, 2000);
    if (!proposal) {
      return NextResponse.json({ ok: false, error: "proposal required" }, { status: 400 });
    }
    const context = String(body.context ?? "").slice(0, 2000);
    const recent = Array.isArray(body.recent) ? body.recent.slice(0, 8) : [];

    const opinions = await Promise.all(
      AGENTS.map(async (agent): Promise<Opinion> => {
        try {
          const system = `You are ${agent.key}, a member of the Alpha-OS agent council. Your mandate: ${agent.mandate} Reply with a short opinion (2-3 sentences) ending with a verdict line: VERDICT: PROCEED | REVISE | REJECT.`;
          const user = [
            `PROPOSAL: ${proposal}`,
            context ? `CONTEXT: ${context}` : "",
            recent.length ? `RECENT ACTIONS: ${recent.join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const { content } = await callLLM(system, user);
          return {
            agent: agent.key,
            opinion: content.replace(/VERDICT:\s*\w+\s*$/i, "").trim().slice(0, 500),
            verdict: parseVerdict(content),
          };
        } catch (err) {
          return {
            agent: agent.key,
            opinion: `[${agent.key} could not deliberate: ${err instanceof Error ? err.message : "error"}]`,
            verdict: "REVISE",
          };
        }
      })
    );

    const tally = {
      proceed: opinions.filter((o) => o.verdict === "PROCEED").length,
      revise: opinions.filter((o) => o.verdict === "REVISE").length,
      reject: opinions.filter((o) => o.verdict === "REJECT").length,
    };
    const consensus: Opinion["verdict"] =
      tally.reject > 0 ? "REJECT" : tally.proceed >= tally.revise ? "PROCEED" : "REVISE";

    return NextResponse.json({ ok: true, opinions, consensus, tally, time: Date.now() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "debate failed" }, { status: 500 });
  }
}
