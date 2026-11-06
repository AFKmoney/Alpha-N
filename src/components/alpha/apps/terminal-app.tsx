/**
 * terminal-app.tsx — the real Linux terminal. xterm.js frontend wired over
 * socket.io to the PTY mini-service on :3003 (true bash — vim/top/python
 * work). Adds bash-like command history (ArrowUp/Down, persisted) and
 * consumes the AI's queued terminal commands.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useOS } from "@/lib/alpha/os-store";

const LS_HISTORY = "alpha-terminal-history";

export function TerminalApp(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const currentLine = useRef("");
  const historyRef = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: "#d4d4d8",
        cursor: "#67e8f9",
        selectionBackground: "rgba(167,139,250,0.3)",
        black: "#18181b",
        green: "#34d399",
        yellow: "#fbbf24",
        cyan: "#67e8f9",
        magenta: "#a78bfa",
        red: "#fb7185",
      },
      fontFamily: "var(--ae-font-mono)",
      fontSize: 12.5,
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    term.writeln("\x1b[38;5;51mAlpha-OS terminal\x1b[0m — real bash PTY via :3003");
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* container not sized yet */
    }

    // persisted history (deferred — no setState in mount effect)
    Promise.resolve().then(() => {
      try {
        const raw = window.localStorage.getItem(LS_HISTORY);
        if (raw) historyRef.current = JSON.parse(raw) as string[];
      } catch {
        historyRef.current = [];
      }
    });

    const pushHistory = (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      const hist = historyRef.current;
      if (hist[hist.length - 1] === trimmed) return;
      hist.push(trimmed);
      if (hist.length > 100) hist.shift();
      try {
        window.localStorage.setItem(LS_HISTORY, JSON.stringify(hist));
      } catch {
        /* non-fatal */
      }
    };

    const socket = io("/?XTransformPort=3003", { path: "/", transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("terminal:input", { data: "" });
    });
    socket.on("terminal:ready", () => setStatus("ready"));
    socket.on("terminal:output", (payload: { data?: string }) => {
      if (payload?.data) term.write(payload.data);
    });
    socket.on("terminal:exited", () => term.writeln("\r\n\x1b[38;5;245m[shell exited — respawning]\x1b[0m"));
    socket.on("terminal:error", (payload: { message?: string }) => {
      setStatus("error");
      term.writeln(`\r\n\x1b[38;5;203m[terminal error] ${payload?.message ?? "unknown"}\x1b[0m`);
    });
    socket.on("disconnect", () => setStatus("connecting"));

    term.onData((data) => {
      // maintain the live line so history navigation can replace it
      if (data === "\r") {
        pushHistory(currentLine.current);
        currentLine.current = "";
        historyIndex.current = -1;
      } else if (data === "\x7f") {
        currentLine.current = currentLine.current.slice(0, -1);
      } else if (data === "\x15") {
        currentLine.current = "";
      } else if (data >= " " && data <= "~") {
        currentLine.current += data;
      }
      socket.emit("terminal:input", { data });
    });

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.key === "ArrowUp") {
        const hist = historyRef.current;
        if (hist.length === 0) return false;
        historyIndex.current = historyIndex.current === -1 ? hist.length - 1 : Math.max(0, historyIndex.current - 1);
        const cmd = hist[historyIndex.current] ?? "";
        socket.emit("terminal:input", { data: `\x15${cmd}` });
        currentLine.current = cmd;
        return false;
      }
      if (event.key === "ArrowDown") {
        const hist = historyRef.current;
        if (historyIndex.current === -1) return false;
        historyIndex.current += 1;
        const cmd = historyIndex.current >= hist.length ? "" : hist[historyIndex.current];
        socket.emit("terminal:input", { data: `\x15${cmd}` });
        currentLine.current = cmd;
        if (historyIndex.current >= hist.length) historyIndex.current = -1;
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.emit("terminal:resize", { cols: term.cols, rows: term.rows });
      } catch {
        /* transient */
      }
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      socket.removeAllListeners();
      socket.disconnect();
      term.dispose();
    };
  }, []);

  // drain the AI's terminal command queue
  useEffect(() => {
    const timer = window.setInterval(() => {
      const command = useOS.getState().dequeueTerminalCommand();
      if (!command) return;
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit("terminal:input", { data: `${command}\r` });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative h-full w-full bg-black/45">
      <div className="font-mono-ae pointer-events-none absolute right-2 top-1 z-10 text-[9px] uppercase tracking-widest">
        {status === "ready" ? (
          <span className="text-[--ae-emerald]">pty :3003</span>
        ) : status === "connecting" ? (
          <span className="text-[--ae-gold]">connecting…</span>
        ) : (
          <span className="text-[--ae-rose]">pty offline</span>
        )}
      </div>
      <div ref={hostRef} className="xterm-ae h-full w-full" />
    </div>
  );
}

export default TerminalApp;
