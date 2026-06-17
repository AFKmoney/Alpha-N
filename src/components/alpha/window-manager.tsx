/**
 * window-manager.tsx — renders all visible windows on the active desktop.
 * Computes the tiled layout (when in tile mode) and dispatches to the
 * correct app component via renderAppContent.
 */
"use client";

import { AnimatePresence } from "framer-motion";
import { useOS } from "@/lib/alpha/os-store";
import {
  computeTiledLayout,
  defaultSplits,
  type SplitHandle,
} from "@/lib/alpha/os-types";
import { WindowFrame } from "./window-frame";
import { TerminalApp } from "./apps/terminal-app";
import { BrowserApp, FilesApp, MonitorApp, SecurityApp, CustomApp, OptionsApp, VaultApp } from "./apps/os-apps";
import { RealCodeEditor } from "./apps/real-code-editor";
import { MemoryNetworkApp } from "./apps/memory-network";
import { AppRepositoryApp } from "./apps/app-repository";
import { WallpaperApp } from "./apps/wallpaper-app";
import { AgentPanel } from "./agent-panel";
import { EvolutionLog } from "./evolution-log";
import { LoomApp } from "./apps/loom-app";
import { SplitHandleBar } from "./split-handle";

export function WindowManager() {
  const { windows, layoutMode, activeDesktop, viewport, splitRatios } = useOS();

  // windows visible on the active desktop (not minimized)
  const visible = windows.filter((w) => w.desktop === activeDesktop && !w.minimized);

  // compute tiled layout if in tile mode
  const tiled =
    layoutMode === "tile" && visible.length > 0
      ? computeTiledLayout(
          visible.length,
          viewport,
          splitRatios[activeDesktop] ?? defaultSplits(visible.length)
        )
      : null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {visible.map((win, i) => (
          <WindowFrame key={win.id} win={win} tiledRect={tiled?.rects[i]}>
            {renderAppContent(win.kind, win.id)}
          </WindowFrame>
        ))}
      </AnimatePresence>

      {/* Split handles — only in tile mode, rendered above windows */}
      {tiled &&
        tiled.handles.map((h) => (
          <SplitHandleBar key={`h-${h.index}`} handle={h} desktop={activeDesktop} />
        ))}
    </div>
  );
}

function renderAppContent(kind: string, windowId: string) {
  switch (kind) {
    case "terminal":
      return <TerminalApp windowId={windowId} />;
    case "editor":
      return <LoomApp />;
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
    case "options":
      return <OptionsApp />;
    case "vault":
      return <VaultApp />;
    case "realcode":
      return <RealCodeEditor />;
    case "memory":
      return <MemoryNetworkApp />;
    case "repository":
      return <AppRepositoryApp />;
    case "wallpaper":
      return <WallpaperApp />;
    case "custom":
      return <CustomApp windowId={windowId} />;
    default:
      return <div className="p-4 text-muted-foreground">Unknown app</div>;
  }
}
