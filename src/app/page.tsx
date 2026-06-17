"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ObsidianBackground } from "@/components/alpha/obsidian-background";
import { TopBar } from "@/components/alpha/top-bar";
import { StatusBar } from "@/components/alpha/status-bar";
import { BootSequence } from "@/components/alpha/boot-sequence";
import { EvolutionController } from "@/components/alpha/evolution-controller";
import { AutonomousLoop } from "@/components/alpha/autonomous-loop";
import { ChatPanel } from "@/components/alpha/chat-panel";
import { BeforeAfter } from "@/components/alpha/before-after";
import { NeuralDiff } from "@/components/alpha/neural-diff";
import { SynapseMap } from "@/components/alpha/synapse-map";
import { WindowManager } from "@/components/alpha/window-manager";
import { Dock, DockHint } from "@/components/alpha/dock";
import { StartMenu } from "@/components/alpha/start-menu";
import { LiveMutationViewer } from "@/components/alpha/live-mutation-viewer";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import type { AppKind } from "@/lib/alpha/os-types";

export default function Page() {
  const workspaceRef = useRef<HTMLElement>(null);
  const setViewport = useOS((s) => s.setViewport);

  // Track the viewport = the FULL screen. Windows can move/resize anywhere
  // within the screen framing (0,0 to innerWidth, innerHeight), regardless
  // of top bar or dock — just like a real Linux WM where you can push a
  // window to any edge.
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({
        x: 0,
        y: 0,
        w,
        h,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [setViewport]);

  // On boot: NO apps open. The OS starts clean — only the chat panel is
  // visible (it's a floating overlay, not a window). Apps open only when
  // the user asks the AI or opens them manually from the dock.

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <ObsidianBackground />
      <EvolutionController />
      <AutonomousLoop workspaceRef={workspaceRef} />
      <BootSequence />

      <MutationFilament />

      <TopBar />

      {/* The desktop — what N-Core screenshots and rewrites */}
      <main
        ref={workspaceRef}
        className="relative flex-1 overflow-hidden"
        onDragOver={(e) => {
          // Allow drop of apps from the App Repository
          if (e.dataTransfer.types.includes("text/appkind")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          // Drop an app from the App Repository → open it at the drop position
          const kind = e.dataTransfer.getData("text/appkind");
          if (kind) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left - 200; // offset so the window centers on cursor
            const y = e.clientY - rect.top - 20;
            useOS.getState().openApp(kind as AppKind, { x: Math.max(0, x), y: Math.max(0, y) });
          }
        }}
      >
        <WindowManager />
      </main>

      {/* Floating dock — appears on mouse proximity near bottom */}
      <DockHint />
      <Dock />
      {/* Start menu — always-visible button bottom-left */}
      <StartMenu />
      <StatusBar />

      {/* Live mutation viewer — toggle via side arrow */}
      <LiveMutationViewer />

      {/* Overlays */}
      <NeuralDiff />
      <SynapseMap />
      <BeforeAfter />
      <ChatPanel />
    </div>
  );
}

function MutationFilament() {
  const aiState = useEvolution((s) => s.aiState);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const mutating = aiState === "self-improving" || aiBusy;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5" data-ai-skip="true">
      <AnimatePresence>
        {mutating && (
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="h-full origin-left"
            style={{
              background:
                "linear-gradient(90deg, transparent, oklch(0.85 0.16 85), oklch(0.82 0.17 195), transparent)",
              boxShadow: "0 0 12px oklch(0.85 0.16 85 / 0.8)",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
