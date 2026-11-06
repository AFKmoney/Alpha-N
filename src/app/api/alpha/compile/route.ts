/**
 * /api/alpha/compile — real compilation checks against the actual project.
 * Runs `npx tsc --noEmit` and/or `npx eslint src/` with a 30s timeout.
 * Compile errors are pushed back into the loop as compile_error events by
 * the caller, closing the self-healing loop.
 */
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";

export const runtime = "nodejs";
export const maxDuration = 60;

const TIMEOUT_MS = 30_000;

function run(cmd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd: process.cwd(), timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      // tsc exits 0 on clean; eslint exits 0 on clean — but eslint also exits 0
      // with warnings unless --max-warnings is set, which we use.
      resolve({ ok: !err, output: output || (err ? err.message : "") });
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { check?: string };
    const check = body.check === "tsc" || body.check === "eslint" ? body.check : "both";

    const [tsc, eslint] = await Promise.all([
      check === "eslint" ? Promise.resolve(null) : run("npx tsc --noEmit"),
      check === "tsc" ? Promise.resolve(null) : run("npx eslint src --max-warnings=0"),
    ]);

    const tscOk = tsc === null ? true : tsc.ok;
    const eslintOk = eslint === null ? true : eslint.ok;

    return NextResponse.json({
      ok: tscOk && eslintOk,
      check,
      tscOk,
      tscOutput: tsc === null ? null : tsc.output.slice(0, 20_000),
      eslintOk,
      eslintOutput: eslint === null ? null : eslint.output.slice(0, 20_000),
      time: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "compile failed" }, { status: 500 });
  }
}
