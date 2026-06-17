"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, type Socket } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";

interface TerminalAppProps {
  windowId: string;
}

export function TerminalApp({ windowId }: TerminalAppProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { terminalCommands, clearTerminalCommand } = useOS();
  const lastCommandId = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
    term.writeln("\x1b[2m  real PTY · no sandbox · connected directly to the machine\x1b[0m");
    term.writeln("");

    const socket = io("/", {
      query: { XTransformPort: "3003" },
      path: "/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("terminal:resize", { cols: term.cols, rows: term.rows });
    });

    socket.on("terminal:ready", () => {
      term.writeln("\x1b[32m  shell ready\x1b[0m");
    });

    socket.on("terminal:output", (payload: { data: string }) => {
      term.write(payload.data);
      // ---- LAYER B: Reactive event detection ----
      // Detect errors in terminal output and push events for the AI to react to
      const text = payload.data.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI
      if (text.length > 5) {
        const lowerText = text.toLowerCase();
        if (lowerText.includes("error") || lowerText.includes("not found") || lowerText.includes("cannot") || lowerText.includes("denied") || lowerText.includes("exception")) {
          useEvolution.getState().pushEvent("terminal_error", text.slice(0, 300));
        } else if (text.trim().length > 20 && !text.includes("\x1b[")) {
          // significant output (not just prompts) — push as a terminal_output event
          useEvolution.getState().pushEvent("terminal_output", text.slice(0, 300));
        }
      }
    });

    socket.on("terminal:exited", (payload: { code: number }) => {
      term.writeln(`\r\n\x1b[33m[process exited with code ${payload.code}]\x1b[0m`);
    });

    socket.on("terminal:error", (payload: { message: string }) => {
      term.writeln(`\r\n\x1b[31m[error: ${payload.message}]\x1b[0m`);
    });

    term.onData((data) => {
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
    <div className="h-full w-full bg-[#0a0a14] p-1">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
