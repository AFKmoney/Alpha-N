/**
 * page.tsx — the Alpha-OS desktop. Boots clean (no app windows — only the
 * chat), mounts the full OS surface: living backdrop, top bar, window
 * manager with tiling, dock, start menu, status bar, chat, the autonomous
 * loop that drives the AI, and every system overlay.
 */
"use client";

import { useEffect, useRef } from "react";
import { ObsidianBackground } from "@/components/alpha/obsidian-background";
import { TopBar } from "@/components/alpha/top-bar";
import { WindowManager } from "@/components/alpha/window-manager";
import { Dock } from "@/components/alpha/dock";
import { StartMenu } from "@/components/alpha/start-menu";
import { StatusBar } from "@/components/alpha/status-bar";
import { BootSequence } from "@/components/alpha/boot-sequence";
import { BeforeAfter } from "@/components/alpha/before-after";
import { MutationViewer } from "@/components/alpha/mutation-viewer";
import { ChatPanel, ChatToggle } from "@/components/alpha/chat-panel";
import { AutonomousLoop } from "@/components/alpha/autonomous-loop";
import { ContextMenuProvider, triggerContextMenu, buildDesktopActions } from "@/components/alpha/context-menu";
import { CommandPalette } from "@/components/alpha/command-palette";
import { ToastSystem } from "@/components/alpha/toast-system";
import { ShortcutsOverlay } from "@/components/alpha/shortcuts-overlay";
import { NotificationCenter } from "@/components/alpha/notification-center";
import { EvolutionGraph } from "@/components/alpha/evolution-graph";
import { DebateReplay } from "@/components/alpha/debate-replay";
import { SystemSearch } from "@/components/alpha/system-search";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";

export default function Home() {
  const workspaceRef = useRef<HTMLDivElement>(null);

  // hydration: Akasha memory, episodes, constraints, preferences
  useEffect(() => {
    const evolution = useEvolution.getState();
    void evolution.hydrateFromDb();
    void evolution.loadEpisodesFromDb();
    void evolution.loadConstraints();
  }, []);

  // viewport tracking: full-screen framing, re-clamps floating windows
  useEffect(() => {
    const push = () => {
      useOS.getState().setViewport({
        x: 0,
        y: 0,
        w: window.innerWidth,
        h: window.innerHeight,
      });
    };
    push();
    window.addEventListener("resize", push);
    return () => window.removeEventListener("resize", push);
  }, []);

  // start the heartbeat + telemetry ticker
  useEffect(() => {
    useEvolution.getState().tick();
    const timer = window.setInterval(() => useEvolution.getState().tick(), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main
      ref={workspaceRef}
      className="relative h-dvh w-full overflow-hidden"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.desktop === "true") {
          triggerContextMenu(e, buildDesktopActions());
        }
      }}
    >
      <div data-desktop="true" className="absolute inset-0">
        <ObsidianBackground />
        <TopBar />
        <WindowManager />
        <MutationViewer />
        <Dock />
        <StartMenu />
        <StatusBar />
        <BeforeAfter />
        <ChatPanel />
        <ChatToggle />
        <AutonomousLoop workspaceRef={workspaceRef} />
        <ContextMenuProvider />
        <CommandPalette />
        <ToastSystem />
        <ShortcutsOverlay />
        <NotificationCenter />
        <EvolutionGraph />
        <DebateReplay />
        <SystemSearch />
        <BootSequence />
      </div>
    </main>
  );
}
