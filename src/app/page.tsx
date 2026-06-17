"use client";

import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ObsidianBackground } from "@/components/alpha/obsidian-background";
import { TopBar } from "@/components/alpha/top-bar";
import { CodeEditor } from "@/components/alpha/code-editor";
import { EvolutionTree } from "@/components/alpha/evolution-tree";
import { NeuralDiff } from "@/components/alpha/neural-diff";
import { SynapseMap } from "@/components/alpha/synapse-map";
import { AgentPanel } from "@/components/alpha/agent-panel";
import { EvolutionLog } from "@/components/alpha/evolution-log";
import { StatusBar } from "@/components/alpha/status-bar";
import { BootSequence } from "@/components/alpha/boot-sequence";
import { EvolutionController } from "@/components/alpha/evolution-controller";
import { AutonomousLoop } from "@/components/alpha/autonomous-loop";
import { ChatPanel, ChatToggle } from "@/components/alpha/chat-panel";
import { BeforeAfter } from "@/components/alpha/before-after";
import { OptimizationStream } from "@/components/alpha/optimization-stream";
import { useEvolution } from "@/lib/alpha/evolution-store";

export default function Page() {
  const flowMode = useEvolution((s) => s.flowMode);
  const toggleFlow = useEvolution((s) => s.toggleFlow);
  const workspaceRef = useRef<HTMLElement>(null);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden lg:overflow-hidden">
      <ObsidianBackground />
      <EvolutionController />
      <AutonomousLoop workspaceRef={workspaceRef} />
      <BootSequence />

      <MutationFilament />

      {/* The workspace — what N-Core screenshots and rewrites */}
      <main ref={workspaceRef} className="flex flex-1 flex-col">
        <AnimatePresence mode="wait">
          {flowMode ? (
            <motion.div
              key="flow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col px-4 py-4 sm:px-6"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="eyebrow text-glow-gold text-[oklch(0.85_0.16_85)]">
                  flow mode · tunnel of concentration
                </span>
                <button
                  onClick={toggleFlow}
                  className="rounded-full border border-border/60 bg-card/40 px-3 py-1 font-mono-ae text-xs text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
                >
                  exit flow
                </button>
              </div>
              <div className="mx-auto flex h-full w-full max-w-3xl flex-1 items-center">
                <CodeEditor />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="ide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col"
            >
              <TopBar />

              {/* Dense 4-column workspace */}
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[240px_1fr_280px_220px] xl:grid-cols-[260px_1fr_320px_260px]">
                {/* Col 1: agent council */}
                <div className="hidden min-h-0 flex-col gap-3 lg:flex">
                  <div className="min-h-0 flex-[3]">
                    <AgentPanel />
                  </div>
                  <div className="min-h-0 flex-[2]">
                    <EvolutionLog />
                  </div>
                </div>

                {/* Col 2: the Loom */}
                <div className="min-h-[55vh] lg:min-h-0">
                  <CodeEditor />
                </div>

                {/* Col 3: evolution tree */}
                <div className="hidden min-h-0 flex-col gap-3 lg:flex">
                  <div className="min-h-0 flex-1">
                    <EvolutionTree />
                  </div>
                </div>

                {/* Col 4: live optimization stream */}
                <div className="hidden min-h-0 flex-col xl:flex">
                  <div className="min-h-0 flex-1">
                    <OptimizationStream />
                  </div>
                </div>
              </div>

              {/* Mobile / tablet: stacked panels */}
              <div className="grid grid-cols-1 gap-3 px-3 pb-3 lg:hidden">
                <AgentPanel />
                <OptimizationStream />
                <EvolutionTree />
                <EvolutionLog />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <StatusBar />

      {/* Overlays — excluded from screenshots via data-ai-skip */}
      <NeuralDiff />
      <SynapseMap />
      <BeforeAfter />
      <ChatPanel />
      <ChatToggle />
    </div>
  );
}

/** A thin top filament that ignites when the organism is mutating. */
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
