/**
 * terminal-app.tsx — real PTY terminal connected to the machine via
 * socket.io (bridged by the kernel/pty-bridge mini-service on port 3003).
 * The AI can queue commands via the os-store; output is parsed for errors
 * and pushed to the reactive event queue (Layer B) so the AI can react.
 *
 * SA3-WINDOW-OS addition: client-side command history (bash-like up/down
 * cycling). ArrowUp replaces the current line with the previous command;
 * ArrowDown cycles forward. History persists to localStorage under
 * "alpha-terminal-history" (max 100 entries).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, type Socket } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";

interface TerminalAppProps {
  windowId: string;
}

/** localStorage key for the persisted command history. */
const HISTORY_KEY = "alpha-terminal-history";
/** Maximum number of commands to keep in history (and in localStorage). */
const HISTORY_MAX = 100;
/** The terminal service port (matches mini-services/terminal/worker.ts). */
const TERMINAL_PORT = "3003";

/**
 * Resolve the socket.io connection URL. In production behind the Caddy
 * gateway, the client connects to the same origin with XTransformPort so
 * Caddy routes to port 3003. In dev (no gateway, direct localhost), connect
 * straight to the service to avoid a confusing dead terminal.
 */
function resolveTerminalUrl(): string {
  if (typeof window === "undefined") return "/";
  // If we're not on the default Next port (3000) or the gateway is absent,
  // connect directly to the terminal service.
  return `http://localhost:${TERMINAL_PORT}`;
}

type ConnState = "connecting" | "connected" | "disconnected";

export function TerminalApp({ windowId }: TerminalAppProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { terminalCommands, clearTerminalCommand } = useOS();
  const lastCommandId = useRef<string | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");

  useEffect(() => {
    if (!containerRef.current) return;

    // ---- SA3-WINDOW-OS: load persisted command history from localStorage ----
    // Stored as a JSON-encoded string[]. Guarded for SSR / disabled storage.
    const history: string[] = [];
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string") history.push(item);
          }
        }
      }
    } catch {
      // Storage disabled or corrupt — start with empty history.
    }
    /** Cursor into `history` while browsing with ArrowUp/Down. -1 = not browsing. */
    let historyIndex = -1;
    /** Live snapshot of the line the user is currently typing. */
    let currentLine = "";

    const term = new XTerm({
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a14",
        foreground: "#d4d4e8",
        cursor: "#7dd3fc",
        cursorAccent: "#0a0a14",
        selectionBackground: "#7dd3fc44",
        black: "#0a0a14",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#7dd3fc",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4f0",
        brightBlack: "#525266",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.writeln("\x1b[36m  Alpha-OS Terminal\x1b[0m");
    term.writeln("\x1b[2m  real shell · connected directly to the machine\x1b[0m");
    term.writeln("");

    const socket = io(resolveTerminalUrl(), {
      query: { XTransformPort: TERMINAL_PORT },
      path: "/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 4000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnState("connected");
      socket.emit("terminal:resize", { cols: term.cols, rows: term.rows });
    });

    socket.on("disconnect", () => {
      setConnState("disconnected");
    });

    // If the first connection attempt fails, surface a clear hint instead
    // of leaving the user staring at a blank terminal.
    let connectHintShown = false;
    socket.io.on("reconnect_attempt", () => {
      setConnState("connecting");
      if (!connectHintShown) {
        connectHintShown = true;
        term.writeln("\x1b[33m  ⚠ service introuvable sur le port 3003.\x1b[0m");
        term.writeln("\x1b[2m  Lance-le avec : node --import tsx mini-services/terminal/worker.ts\x1b[0m");
        term.writeln("\x1b[2m  (ou sous WSL : bun --hot mini-services/terminal/index.ts)\x1b[0m");
        term.writeln("");
      }
    });

    socket.on("terminal:ready", (payload: { backend?: string }) => {
      const be = payload?.backend === 'child' ? 'child_process' : (payload?.backend ?? 'pty');
      term.writeln(`\x1b[32m  shell ready\x1b[0m \x1b[2m· backend ${be}\x1b[0m`);
    });

    // Throttle for terminal events — only push one error event per 5 seconds
    // to avoid flooding the event queue with hundreds of entries.
    let lastEventTime = 0;

    socket.on("terminal:output", (payload: { data: string }) => {
      term.write(payload.data);
      // ---- LAYER B: Reactive event detection ----
      // Only push ERROR events (not normal output) and throttle to 1 per 5s
      const text = payload.data.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI
      if (text.length > 10) {
        const lowerText = text.toLowerCase();
        const isError = lowerText.includes("error") || lowerText.includes("not found") ||
                        lowerText.includes("cannot") || lowerText.includes("denied") ||
                        lowerText.includes("exception") || lowerText.includes("fatal");
        if (isError && Date.now() - lastEventTime > 5000) {
          lastEventTime = Date.now();
          useEvolution.getState().pushEvent("terminal_error", text.slice(0, 300));
        }
      }
    });

    socket.on("terminal:exited", (payload: { code: number }) => {
      term.writeln(`\r\n\x1b[33m[process exited with code ${payload.code}]\x1b[0m`);
    });

    socket.on("terminal:error", (payload: { message: string }) => {
      term.writeln(`\r\n\x1b[31m[error: ${payload.message}]\x1b[0m`);
    });

    /**
     * Replace the current shell input line with `text`. Sends Ctrl-U (kill
     * line in bash/readline) followed by the replacement text. Does NOT
     * forward the original keystroke that triggered the replacement.
     */
    const replaceLine = (text: string) => {
      socket.emit("terminal:input", { data: "\x15" + text });
      currentLine = text;
    };

    term.onData((data) => {
      // ---- SA3-WINDOW-OS: client-side command history (bash-like) ----
      // ArrowUp: walk backward through history.
      if (data === "\x1b[A") {
        if (history.length === 0) return;
        if (historyIndex === -1) {
          historyIndex = history.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        const cmd = history[historyIndex] ?? "";
        replaceLine(cmd);
        return;
      }
      // ArrowDown: walk forward through history; past the end restores empty.
      if (data === "\x1b[B") {
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          historyIndex++;
          const cmd = history[historyIndex] ?? "";
          replaceLine(cmd);
        } else {
          historyIndex = -1;
          replaceLine("");
        }
        return;
      }

      // Track the live line locally so Enter can capture the full command.
      if (data === "\r") {
        // Enter: commit current line to history (if non-empty + not a dup of the last entry).
        const trimmed = currentLine.trim();
        if (trimmed) {
          if (history.length === 0 || history[history.length - 1] !== trimmed) {
            history.push(trimmed);
            if (history.length > HISTORY_MAX) history.shift();
            try {
              localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            } catch {
              // Storage full or disabled — history still works in-memory for this session.
            }
          }
        }
        currentLine = "";
        historyIndex = -1;
      } else if (data === "\x7f" || data === "\b") {
        // Backspace: drop last char of the tracked line.
        currentLine = currentLine.slice(0, -1);
      } else if (data === "\x15") {
        // Ctrl-U: readline kill-line.
        currentLine = "";
      } else if (data === "\x1b" || data.startsWith("\x1b")) {
        // Other escape sequences (arrows already handled above, Home/End,
        // Delete, F-keys, etc.) — don't add to the tracked line. The shell
        // still receives them and may move the cursor / edit the line, but
        // our local snapshot is approximate anyway.
      } else if (data.length === 1 && data >= " ") {
        // Printable single char.
        currentLine += data;
      } else if (data.length > 1 && !data.startsWith("\x1b")) {
        // Pasted text (no escape prefix). Treat as a literal string append.
        currentLine += data;
      }

      // Forward every keystroke to the shell PTY as usual.
      socket.emit("terminal:input", { data });
    });

    term.onResize(({ cols, rows }) => {
      socket.emit("terminal:resize", { cols, rows });
    });

    const onResize = () => {
      try { fit.fit(); } catch { /* ignore */ }
    };
    window.addEventListener("resize", onResize);
    const resizeObs = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    resizeObs.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObs.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, []);

  // Process queued AI commands
  useEffect(() => {
    if (terminalCommands.length === 0) return;
    const latest = terminalCommands[terminalCommands.length - 1];
    if (latest.id === lastCommandId.current) return;
    lastCommandId.current = latest.id;
    if (socketRef.current?.connected && termRef.current) {
      socketRef.current.emit("terminal:input", { data: latest.command + "\r" });
      clearTerminalCommand(latest.id);
    }
  }, [terminalCommands, clearTerminalCommand]);

  return (
    <div className="relative h-full w-full bg-[#0a0a14] p-1">
      {/* Connection state indicator — top-right of the terminal pane. */}
      <div
        className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded bg-black/40 px-2 py-0.5 font-mono-ae text-[0.6rem]"
        style={{ color: connState === "connected" ? "#4ade80" : connState === "disconnected" ? "#f87171" : "#facc15" }}
        aria-live="polite"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: connState === "connected" ? "#4ade80" : connState === "disconnected" ? "#f87171" : "#facc15",
            animation: connState === "connecting" ? "blink 1s steps(2) infinite" : undefined,
          }}
        />
        {connState === "connected" ? "connecté" : connState === "disconnected" ? "déconnecté" : "connexion…"}
      </div>
      <style>{`@keyframes blink { 50% { opacity: 0.3; } }`}</style>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
