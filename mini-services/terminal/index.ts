/**
 * index.ts — thin bun launcher for the terminal mini-service.
 *
 * node-pty does NOT work under bun (bun's tty.ReadStream closes the PTY
 * master fd and bash dies with SIGHUP within ~1s). The workaround: this
 * launcher runs under `bun --hot index.ts` (per spec), spawns the real
 * service as `node --import tsx worker.ts`, and restarts the node child
 * when any *.ts file changes (hot reload preserved end-to-end).
 */
const spawned = (globalThis as { __alphaTerminalLaunched?: boolean }).__alphaTerminalLaunched;
if (!spawned) {
  (globalThis as { __alphaTerminalLaunched?: boolean }).__alphaTerminalLaunched = true;
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const workerPath = path.join(import.meta.dir, "worker.ts");

  const start = (): ReturnType<typeof spawn> => {
    const child = spawn("node", ["--import", "tsx", workerPath], {
      cwd: import.meta.dir,
      stdio: "inherit",
      env: process.env,
    });
    console.log(`[terminal-launcher] node worker pid=${child.pid}`);
    child.on("exit", (code) => {
      console.log(`[terminal-launcher] worker exited (${code}) — restarting in 500ms`);
      setTimeout(start, 500);
    });
    return child;
  };
  start();

  // hot reload: restart the node child when sources change
  const { watch } = await import("node:fs");
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let current: ReturnType<typeof spawn> | undefined;
  current = undefined;
  watch(import.meta.dir, (_event, filename) => {
    if (!filename?.endsWith(".ts")) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      console.log("[terminal-launcher] source changed — restarting worker");
      if (current) current.kill("SIGTERM");
      current = start();
    }, 300);
  });
}
