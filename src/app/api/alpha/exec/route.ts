import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

const execAsync = promisify(exec);
const SANDBOX_DIR = "/tmp/alpha-sandbox";

interface ExecRequest {
  code: string;
  language: "javascript" | "typescript" | "bash";
  timeoutMs?: number;
}

export async function POST(req: NextRequest) {
  let body: ExecRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { code, language, timeoutMs = 8000 } = body;
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  try {
    await mkdir(SANDBOX_DIR, { recursive: true });
    const fileId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let cmd: string;
    let filePath: string;

    if (language === "bash") {
      filePath = path.join(SANDBOX_DIR, `${fileId}.sh`);
      await writeFile(filePath, code, "utf-8");
      cmd = `bash ${filePath}`;
    } else if (language === "typescript") {
      // Use bun to run TS directly (it's available in this project)
      filePath = path.join(SANDBOX_DIR, `${fileId}.ts`);
      await writeFile(filePath, code, "utf-8");
      cmd = `bun run ${filePath}`;
    } else {
      // javascript
      filePath = path.join(SANDBOX_DIR, `${fileId}.js`);
      await writeFile(filePath, code, "utf-8");
      cmd = `node ${filePath}`;
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      const result = await execAsync(cmd, {
        timeout: timeoutMs,
        cwd: SANDBOX_DIR,
        env: { ...process.env, NODE_PATH: "/home/z/my-project/node_modules" },
      });
      stdout = result.stdout.slice(0, 5000);
      stderr = result.stderr.slice(0, 3000);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
      stdout = (e.stdout ?? "").slice(0, 5000);
      stderr = (e.stderr ?? "").slice(0, 3000);
      exitCode = e.killed ? -1 : (e.code ?? 1);
      if (e.killed || e.signal === "SIGTERM") {
        stderr += "\n[process killed: timeout exceeded]";
      }
    }

    // cleanup
    try { await unlink(filePath); } catch { /* ignore */ }

    return NextResponse.json({
      ok: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      language,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message, ok: false }, { status: 200 });
  }
}
