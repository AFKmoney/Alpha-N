/**
 * worker.ts — the real terminal service (runs under node, where node-pty
 * works). socket.io on :3003, socket.io path "/", one true PTY per
 * connection, auto-respawn on shell exit, graceful shutdown.
 */
import { createServer } from "node:http";
import { Server } from "socket.io";
import pty from "node-pty";

const PORT = 3003;

const http = createServer((_req, res) => {
  res.writeHead(200);
  res.end("alpha-terminal-service");
});

const io = new Server(http, {
  path: "/",
  cors: { origin: "*" },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

console.log(`Terminal service on :${PORT}`);
console.log('  socket.io path: "/"   (Caddy gateway: /?XTransformPort=3003)');
console.log("  backend: node-pty (full PTY — vim/top/htop/python supported)");

io.on("connection", (socket) => {
  let shell: pty.IPty | null = null;

  const spawnShell = () => {
    try {
      shell = pty.spawn("/bin/bash", [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: "/home/z/my-project",
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      });
      shell.onData((data) => socket.emit("terminal:output", { data }));
      shell.onExit(({ exitCode }) => {
        socket.emit("terminal:exited", { code: exitCode });
        shell = null;
        setTimeout(() => {
          if (socket.connected) {
            spawnShell();
            socket.emit("terminal:ready", { backend: "pty" });
          }
        }, 300);
      });
      socket.emit("terminal:ready", { backend: "pty" });
      console.log(`[${socket.id}] spawned pty shell (pid=${shell.pid})`);
    } catch (err) {
      socket.emit("terminal:error", { message: err instanceof Error ? err.message : "spawn failed" });
      setTimeout(() => {
        if (socket.connected && !shell) spawnShell();
      }, 500);
    }
  };

  spawnShell();

  socket.on("terminal:input", (payload: { data?: string }) => {
    shell?.write(payload?.data ?? "");
  });
  socket.on("terminal:resize", (payload: { cols?: number; rows?: number }) => {
    try {
      shell?.resize(Math.max(20, payload?.cols ?? 80), Math.max(6, payload?.rows ?? 24));
    } catch {
      /* shell may have just exited */
    }
  });
  socket.on("terminal:kill", () => {
    console.log(`[${socket.id}] kill — respawning fresh shell`);
    try {
      shell?.kill();
    } catch {
      /* already dead */
    }
    shell = null;
    spawnShell();
  });
  socket.on("disconnect", () => {
    console.log(`[${socket.id}] disconnected — killing shell`);
    try {
      shell?.kill();
    } catch {
      /* already dead */
    }
    shell = null;
  });
});

const shutdown = () => {
  io.close();
  http.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("uncaughtException", (err) => console.error("[terminal] uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("[terminal] unhandled:", String(err)));

http.listen(PORT, () => console.log(`  shell: /bin/bash · cwd: /home/z/my-project · 80x24`));
