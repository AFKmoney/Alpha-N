"use client";

import { useEffect, useRef, useState } from "react";
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
import { Dock } from "@/components/alpha/dock";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { WORKSPACE_TOP, WORKSPACE_BOTTOM_MARGIN } from "@/lib/alpha/os-types";

export default function Page() {
  const workspaceRef = useRef<HTMLElement>(null);
  const openApp = useOS((s) => s.openApp);
  const windowsLen = useOS((s) => s.windows.length);
  const setViewport = useOS((s) => s.setViewport);
  const booted = useEvolution((s) => s.uptimeMs > 0 || s.generation >= 0);

  // Track the workspace viewport and update the store on resize.
  // The viewport = full width, from below the top bar to above the dock+status.
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({
        x: 0,
        y: WORKSPACE_TOP,
        w,
        h: Math.max(200, h - WORKSPACE_TOP - WORKSPACE_BOTTOM_MARGIN),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [setViewport]);

  // Open default apps on first mount (the "desktop session")
  useEffect(() => {
    if (windowsLen > 0) return;
    const t = setTimeout(() => {
      openApp("editor", { x: 280, y: 64, w: 560, h: 440 });
      openApp("terminal", { x: 24, y: 64, w: 460, h: 340 });
      openApp("monitor", { x: 860, y: 64, w: 380, h: 380 });
      openApp("agents", { x: 24, y: 420, w: 300, h: 300 });
      openApp("security", { x: 860, y: 460, w: 380, h: 280 });
    }, 100);
    return () => clearTimeout(t);
  }, [openApp, windowsLen]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <ObsidianBackground />
      <EvolutionController />
      <AutonomousLoop workspaceRef={workspaceRef} />
      <BootSequence />

      <MutationFilament />

      <TopBar />

      {/* The desktop — what N-Core screenshots and rewrites */}
      <main ref={workspaceRef} className="relative flex-1 overflow-hidden">
        <WindowManager />

        {/* Desktop widgets — always-visible dense overlays */}
        <DesktopWidgets />
      </main>

      <Dock />
      <StatusBar />

      {/* Overlays */}
      <NeuralDiff />
      <SynapseMap />
      <BeforeAfter />
      <ChatPanel />
    </div>
  );
}

/** Dense always-visible desktop widgets: live optimization ticker + clock */
function DesktopWidgets() {
  const { mutationStream, aiBusy, generation, version } = useEvolution();
  const [clock, setClock] = useStateClock();

  return (
    <>
      {/* Top-left: live optimization ticker */}
      <div
        className="pointer-events-none absolute left-3 top-3 z-20 max-w-[260px]"
        data-ai-skip="true"
      >
        <div className="glass rounded-xl border border-border/40 p-2.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-[oklch(0.82_0.17_195)]">live mutations</span>
            <span className="font-mono-ae text-[0.55rem] text-muted-foreground">
              {mutationStream.length} this session
            </span>
          </div>
          <div className="mt-1.5 h-12 overflow-hidden">
            <AnimatePresence mode="popLayout">
              {mutationStream.slice(0, 3).map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-1.5 py-0.5"
                >
                  <span className={`h-1 w-1 shrink-0 rounded-full ${m.kind === "violation" ? "bg-[oklch(0.78_0.2_20)]" : "bg-[oklch(0.82_0.17_195)]"}`} />
                  <span className="truncate font-mono-ae text-[0.6rem] text-foreground/70">
                    {m.description}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {aiBusy && (
            <div className="mt-1 flex items-center gap-1.5">
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="h-1 w-1 rounded-full bg-[oklch(0.85_0.16_85)]"
              />
              <span className="font-mono-ae text-[0.55rem] text-[oklch(0.85_0.16_85)]">
                N-Core is thinking…
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Top-right: clock + version */}
      <div className="pointer-events-none absolute right-3 top-3 z-20" data-ai-skip="true">
        <div className="glass rounded-xl border border-border/40 px-3 py-2 text-right">
          <div className="font-mono-ae text-base font-semibold tabular-nums text-foreground">
            {clock}
          </div>
          <div className="font-mono-ae text-[0.55rem] text-muted-foreground">
            gen {generation} · v{version}
          </div>
        </div>
      </div>
    </>
  );
}

function useStateClock() {
  const [clock, setClock] = useState("--:--:--");
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return [clock, setClock] as const;
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
