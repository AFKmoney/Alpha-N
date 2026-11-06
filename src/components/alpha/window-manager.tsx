/**
 * window-manager.tsx — renders every open window on the active desktop,
 * computes the tiling layout, mounts split handles, and maps each AppKind
 * to its app component (the full app registry).
 */
"use client";

import { useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { useOS, computeDesktopLayout } from "@/lib/alpha/os-store";
import { defaultSplits, type AppKind } from "@/lib/alpha/os-types";
import { WindowFrame, SplitHandleBar } from "./window-frame";
import { BrowserApp, FilesApp, MonitorApp, SecurityApp, CustomApp, OptionsApp, VaultApp } from "./apps/os-apps";
import { GeneratedAppRenderer } from "./apps/generated-app-renderer";
import { TerminalApp } from "./apps/terminal-app";
import { RealCodeEditor } from "./apps/real-code-editor";
import { LoomApp } from "./apps/loom-app";
import { CouncilApp } from "./apps/council-app";
import { EvolutionLogApp } from "./apps/evolution-log-app";
import { MemoryNetwork } from "./apps/memory-network";
import { WallpaperApp } from "./apps/wallpaper-app";
import { CalculatorApp } from "./apps/calculator-app";
import { NotesApp } from "./apps/notes-app";
import { ClipboardApp } from "./apps/clipboard-app";
import { AmbientApp } from "./apps/ambient-app";
import { StatsApp } from "./apps/stats-app";
import { ClockApp } from "./apps/clock-app";
import { WeatherApp } from "./apps/weather-app";
import { MusicApp } from "./apps/music-app";

/** AppKind → component registry (CustomApp passes windowId; SA1 apps don't). */
function renderApp(kind: AppKind, windowId: string): React.ReactNode {
  switch (kind) {
    case "terminal":
      return <TerminalApp />;
    case "editor":
      return <RealCodeEditor />;
    case "loom":
      return <LoomApp />;
    case "files":
      return <FilesApp />;
    case "browser":
      return <BrowserApp windowId={windowId} />;
    case "monitor":
      return <MonitorApp />;
    case "agents":
      return <CouncilApp />;
    case "evolution":
      return <EvolutionLogApp />;
    case "security":
      return <SecurityApp />;
    case "custom":
      return <CustomApp windowId={windowId} />;
    case "options":
      return <OptionsApp />;
    case "vault":
      return <VaultApp />;
    case "memory":
      return <MemoryNetwork />;
    case "wallpaper":
      return <WallpaperApp />;
    case "appstore":
      return <GeneratedAppRenderer windowId={windowId} />;
    case "control":
      return <OptionsApp />;
    case "calculator":
      return <CalculatorApp />;
    case "notes":
      return <NotesApp />;
    case "clipboard":
      return <ClipboardApp />;
    case "ambient":
      return <AmbientApp />;
    case "stats":
      return <StatsApp />;
    case "clock":
      return <ClockApp />;
    case "weather":
      return <WeatherApp />;
    case "music":
      return <MusicApp />;
    default:
      return <div className="font-mono-ae p-4 text-xs text-zinc-500">Unknown app: {kind}</div>;
  }
}

export function WindowManager(): React.ReactElement {
  const windows = useOS((s) => s.windows);
  const viewport = useOS((s) => s.viewport);
  const activeDesktop = useOS((s) => s.activeDesktop);
  const layoutMode = useOS((s) => s.layoutMode);
  const splitRatios = useOS((s) => s.splitRatios);
  const setSplitRatios = useOS((s) => s.setSplitRatios);

  const tiled = layoutMode === "tile";
  const layout = useMemo(
    () => computeDesktopLayout(windows, viewport, activeDesktop, splitRatios),
    [windows, viewport, activeDesktop, splitRatios]
  );
  const visible = useMemo(
    () => windows.filter((w) => w.desktop === activeDesktop),
    [windows, activeDesktop]
  );

  const onRatioDelta = (handleId: string, before: string, after: string, deltaPixels: number) => {
    const ids = visible.filter((w) => !w.minimized).map((w) => w.id);
    const beforeIdx = ids.indexOf(before);
    const afterIdx = ids.indexOf(after);
    if (beforeIdx === -1 || afterIdx === -1) return;
    const ratios = splitRatios[activeDesktop] ?? defaultSplits(ids.length);
    const px = viewport.w;
    const delta = deltaPixels / px;
    if (tiled && ids.length <= 4) {
      const columns = [...ratios.columns];
      columns[beforeIdx] = Math.max(0.08, (columns[beforeIdx] ?? 1) + delta);
      columns[afterIdx] = Math.max(0.08, (columns[afterIdx] ?? 1) - delta);
      setSplitRatios(activeDesktop, { ...ratios, columns });
    } else {
      // master+stack: vertical handle adjusts master width, horizontal adjusts rows
      if (beforeIdx === 0) {
        const columns = [...ratios.columns];
        columns[0] = Math.max(0.2, Math.min(0.6, (columns[0] ?? 0.4) + delta));
        setSplitRatios(activeDesktop, { ...ratios, columns });
      } else {
        const rows = [...ratios.rows];
        const ri = beforeIdx - 1;
        rows[ri] = Math.max(0.08, (rows[ri] ?? 1) + delta);
        rows[ri + 1] = Math.max(0.08, (rows[ri + 1] ?? 1) - delta);
        setSplitRatios(activeDesktop, { ...ratios, rows });
      }
    }
  };

  return (
    <>
      <AnimatePresence>
        {visible.map((win) => (
          <WindowFrame
            key={win.id}
            win={win}
            tiledRect={tiled && !win.minimized ? layout.rects[win.id] : undefined}
          >
            {renderApp(win.kind, win.id)}
          </WindowFrame>
        ))}
      </AnimatePresence>

      {tiled &&
        layout.handles.map((handle) => (
          <SplitHandleBar key={handle.id} handle={handle} viewport={viewport} onRatioDelta={onRatioDelta} />
        ))}
    </>
  );
}

export default WindowManager;
