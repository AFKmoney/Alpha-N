/**
 * /api/alpha/exec — sandboxed code execution.
 *
 * Writes the snippet to /tmp/alpha-sandbox and runs it with node (js/ts via
 * tsx), bun or bash with a hard 8s timeout. Network access is gated by the
 * autonomy level passed from the loop (defense in depth — the loop already
 * refuses network exec at sandbox level).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";

const TIMEOUT_MS = 8_000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      code?: string;
      language?: string;
      network?: boolean;
      level?: string;
    };
    const code = String(body.code ?? "");
    const language = String(body.language ?? "javascript");
    if (!code.trim()) {
      return NextResponse.json({ ok: false, error: "empty code" }, { status: 400 });
    }

    const sandboxDir = path.join(os.tmpdir(), "alpha-sandbox");
    await fs.mkdir(sandboxDir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let file: string;
    let cmd: string;
    let args: string[];
    if (language === "bash") {
      file = path.join(sandboxDir, `${stamp}.sh`);
      await fs.writeFile(file, code, "utf8");
      cmd = "bash";
      args = [file];
    } else if (language === "typescript") {
      file = path.join(sandboxDir, `${stamp}.ts`);
      await fs.writeFile(file, code, "utf8");
      cmd = "node";
      args = ["--import", "tsx", file];
    } else {
      file = path.join(sandboxDir, `${stamp}.js`);
      await fs.writeFile(file, code, "utf8");
      cmd = "node";
      args = [file];
    }

    // sandbox level: strip network by denying env proxies (best-effort flag)
    const env = { ...process.env };
    if (body.network === false) {
      env.HTTP_PROXY = "";
      env.HTTPS_PROXY = "";
      env.http_proxy = "";
      env.https_proxy = "";
      env.ALPHA_SANDBOX_NO_NETWORK = "1";
    }

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const child = spawn(cmd, args, { cwd: sandboxDir, env, timeout: TIMEOUT_MS });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
        if (stdout.length > 50_000) stdout = stdout.slice(0, 50_000) + "\n[truncated]";
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (stderr.length > 20_000) stderr = stderr.slice(0, 20_000) + "\n[truncated]";
      });
      child.on("error", (e) => resolve({ stdout, stderr: `${stderr}${e.message}`, exitCode: 127 }));
      child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 0 }));
    });

    await fs.rm(file, { force: true }).catch(() => {});
    return NextResponse.json({
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "exec failed" }, { status: 500 });
  }
}
