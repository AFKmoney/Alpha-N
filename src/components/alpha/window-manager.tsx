"use client";

import { AnimatePresence } from "framer-motion";
import { useOS } from "@/lib/alpha/os-store";
import { WindowFrame } from "./window-frame";
import { TerminalApp } from "./apps/terminal-app";
import { BrowserApp, FilesApp, MonitorApp, SecurityApp, CustomApp } from "./apps/os-apps";
import { AgentPanel } from "./agent-panel";
import { EvolutionLog } from "./evolution-log";
import { EvolutionTree } from "./evolution-tree";
import { CodeEditor } from "./code-editor";

export function WindowManager() {
  const { windows } = useOS();

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {windows.map((win) => (
          <WindowFrame key={win.id} win={win}>
            {renderAppContent(win.kind, win.id)}
          </WindowFrame>
        ))}
      </AnimatePresence>
    </div>
  );
}

function renderAppContent(kind: string, windowId: string) {
  switch (kind) {
    case "terminal":
      return <TerminalApp windowId={windowId} />;
    case "editor":
      return <CodeEditor />;
    case "files":
      return <FilesApp />;
    case "browser":
      return <BrowserApp windowId={windowId} />;
    case "monitor":
      return <MonitorApp />;
    case "evolution":
      return <EvolutionLog />;
    case "agents":
      return <AgentPanel />;
    case "security":
      return <SecurityApp />;
    case "custom":
      return <CustomApp windowId={windowId} />;
    default:
      return <div className="p-4 text-muted-foreground">Unknown app</div>;
  }
}
