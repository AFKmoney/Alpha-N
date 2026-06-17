/**
 * /api/alpha/compile — runs real `tsc --noEmit` and/or `eslint` on the
 * project (30s timeout per check). Returns stdout/stderr so the AI can
 * see and fix its own compile errors in the next cycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const maxDuration = 45;

const execAsync = promisify(exec);
const PROJECT_ROOT = "/home/z/my-project";

interface CompileRequest {
  check: "tsc" | "eslint" | "both";
}

export async function POST(req: NextRequest) {
  let body: CompileRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const results: { tsc?: { ok: boolean; output: string }; eslint?: { ok: boolean; output: string } } = {};

  try {
    if (body.check === "tsc" || body.check === "both") {
      try {
        const { stdout, stderr } = await execAsync("npx tsc --noEmit 2>&1", {
          cwd: PROJECT_ROOT,
          timeout: 30000,
        });
        results.tsc = { ok: true, output: (stdout + stderr).slice(0, 5000) || "No type errors." };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        results.tsc = { ok: false, output: ((e.stdout ?? "") + (e.stderr ?? "")).slice(0, 5000) };
      }
    }

    if (body.check === "eslint" || body.check === "both") {
      try {
        const { stdout, stderr } = await execAsync("npx eslint src/ --max-warnings=999 2>&1", {
          cwd: PROJECT_ROOT,
          timeout: 30000,
        });
        const output = (stdout + stderr).slice(0, 5000);
        results.eslint = { ok: output.trim() === "" || !output.includes("error"), output: output || "No lint errors." };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        const output = ((e.stdout ?? "") + (e.stderr ?? "")).slice(0, 5000);
        results.eslint = { ok: !output.includes("error"), output };
      }
    }

    const allOk = (results.tsc?.ok ?? true) && (results.eslint?.ok ?? true);
    return NextResponse.json({ ok: allOk, ...results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message, ok: false }, { status: 200 });
  }
}
