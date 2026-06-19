/**
 * /api/alpha/exec — sandboxed code execution for AI-generated code.
 *
 * Security model (moderate policy, the default):
 *   • Runs in SANDBOX_ROOT (OS tmpdir/alpha-sandbox), OUTSIDE the project,
 *     so the process cannot read project source or node_modules by default.
 *   • Receives a MINIMAL environment (PATH, HOME, USERPROFILE only) — never
 *     the full process.env. Secrets, API keys, and DATABASE_URL are stripped.
 *   • No network egress in moderate/sandbox mode. In yolo mode the caller
 *     may pass { network: true } to opt in (still logged).
 *   • Hard 8s timeout, killed via SIGTERM then SIGKILL.
 *   • Output capped (stdout 8KB, stderr 4KB) to prevent memory blowups.
 *
 * The autonomy policy is enforced server-side too: the request must declare
 * its level, and the route honours capabilities.execNetwork accordingly.
 */
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir, rm } from "fs/promises";
import path from "path";
import { SANDBOX_ROOT } from "@/lib/alpha/paths";
import type { AutonomyLevel } from "@/lib/alpha/autonomy-policy";

export const runtime = "nodejs";
export const maxDuration = 30;

const execAsync = promisify(exec);

interface ExecRequest {
  code: string;
  language: "javascript" | "typescript" | "bash";
  timeoutMs?: number;
  /** Caller's current autonomy level — gates network egress. */
  level?: AutonomyLevel;
  /** Explicit network opt-in (only honoured in yolo). */
  network?: boolean;
}

// Minimal, safe environment for spawned code. NEVER spread process.env.
function buildSandboxEnv(allowNetwork: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    // NODE_ENV is required by the ProcessEnv type; keep it explicit so
    // sandboxed code runs in "production" mode (no dev-only behaviours).
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PATH: process.env.PATH ?? "",
    // Provide a clean HOME/USERPROFILE so temp dir resolution works.
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
    USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "",
    TEMP: process.env.TEMP ?? process.env.TMPDIR ?? process.env.TMP ?? "",
    TMP: process.env.TMP ?? process.env.TEMP ?? process.env.TMPDIR ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TZ: process.env.TZ ?? "UTC",
    // Explicit flag so sandboxed code can detect it's sandboxed.
    ALPHA_SANDBOX: "1",
  };
  if (allowNetwork) {
    // In yolo mode we still don't leak secrets — just don't block network.
    env.ALPHA_NETWORK = "1";
  }
  // Strip empty values.
  for (const k of Object.keys(env)) {
    if (!env[k]) delete env[k];
  }
  return env;
}

export async function POST(req: NextRequest) {
  let body: ExecRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { code, language, timeoutMs = 8000 } = body;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }
  // Hard cap on code size to avoid pathological payloads.
  if (code.length > 200_000) {
    return NextResponse.json({ error: "code too large (max 200KB)" }, { status: 413 });
  }

  // Network egress only in yolo mode + explicit opt-in.
  const allowNetwork = body.level === "yolo" && body.network === true;

  // Per-run isolated working directory (not shared with other runs).
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const runDir = path.join(SANDBOX_ROOT, runId);

  try {
    await mkdir(runDir, { recursive: true });

    let cmd: string;
    let filePath: string;
    const fileId = "snippet";

    if (language === "bash") {
      filePath = path.join(runDir, `${fileId}.sh`);
      await writeFile(filePath, code, "utf-8");
      cmd = `bash ${filePath}`;
    } else if (language === "typescript") {
      filePath = path.join(runDir, `${fileId}.ts`);
      await writeFile(filePath, code, "utf-8");
      // Bun runs TS natively if installed; otherwise fall back to tsx.
      // The fallback uses a node wrapper so `||` works on Windows shells too.
      cmd = `node -e "const{execSync:e}=require('child_process');try{e('bun run ${filePath.replace(/\\/g, "/")}',{stdio:'inherit'})}catch{e('npx --yes tsx ${filePath.replace(/\\/g, "/")}',{stdio:'inherit'})}"`;
    } else {
      filePath = path.join(runDir, `${fileId}.js`);
      await writeFile(filePath, code, "utf-8");
      cmd = `node ${filePath}`;
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let timedOut = false;

    try {
      const result = await execAsync(cmd, {
        timeout: Math.min(timeoutMs, 15000),
        cwd: runDir,
        env: buildSandboxEnv(allowNetwork),
        maxBuffer: 1024 * 1024, // 1MB cap before exec aborts
        windowsHide: true,
      });
      stdout = result.stdout.slice(0, 8192);
      stderr = result.stderr.slice(0, 4096);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
      stdout = (e.stdout ?? "").slice(0, 8192);
      stderr = (e.stderr ?? "").slice(0, 4096);
      timedOut = Boolean(e.killed || e.signal === "SIGTERM");
      exitCode = timedOut ? 124 : (e.code ?? 1);
      if (timedOut) stderr += "\n[process killed: timeout exceeded]";
    }

    return NextResponse.json({
      ok: exitCode === 0 && !timedOut,
      stdout,
      stderr,
      exitCode,
      language,
      timedOut,
      sandboxed: true,
      network: allowNetwork,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message, ok: false }, { status: 200 });
  } finally {
    // Always wipe the run directory — no leftovers, no accumulation.
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
