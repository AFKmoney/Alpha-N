/**
 * top-bar.tsx — the OS top bar: brand, council chips, telemetry, layout
 * controls (tile/float + 4 virtual desktops), model settings, evolve,
 * synapse, flow, chat and the notification bell.
 */
"use client";

import { useState } from "react";
import { Bell, Cpu, Layers, MessageSquare, Play, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { DESKTOPS } from "@/lib/alpha/os-types";
import { ModelSettings, ModelSettingsButton } from "./model-settings";

export function TopBar(): React.ReactElement {
  const generation = useEvolution((s) => s.generation);
  const version = useEvolution((s) => s.version);
  const metrics = useEvolution((s) => s.metrics);
  const agents = useEvolution((s) => s.agents);
  const autonomyMode = useEvolution((s) => s.autonomyMode);
  const toggleAutonomy = useEvolution((s) => s.toggleAutonomy);
  const triggerCycle = useEvolution((s) => s.triggerCycle);
  const toggleChat = useEvolution((s) => s.toggleChat);
  const toggleSynapse = useEvolution((s) => s.toggleSynapse);
  const toggleFlow = useEvolution((s) => s.toggleFlow);

  const layoutMode = useOS((s) => s.layoutMode);
  const setLayoutMode = useOS((s) => s.setLayoutMode);
  const activeDesktop = useOS((s) => s.activeDesktop);
  const setActiveDesktop = useOS((s) => s.setActiveDesktop);
  const windows = useOS((s) => s.windows);

  const [modelOpen, setModelOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <>
      <header
        className="font-mono-ae glass fixed inset-x-0 top-0 z-[7000] flex h-[50px] items-center gap-3 border-b border-white/8 px-3"
        data-ai-skip
      >
        {/* brand */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm text-[--ae-amethyst] text-glow-amethyst">α</span>
          <span className="text-[12px] font-semibold tracking-widest text-zinc-200">ALPHA-OS</span>
        </div>

        {/* council chips */}
        <div className="hidden items-center gap-1 md:flex">
          {agents.map((agent) => (
            <span
              key={agent.role}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9px] capitalize",
                agent.status === "idle"
                  ? "border-white/8 text-zinc-500"
                  : "border-[--ae-cyan]/30 bg-[--ae-cyan]/8 text-[--ae-cyan]"
              )}
            >
              {agent.role} {Math.round(agent.load * 100)}
            </span>
          ))}
        </div>

        <span className="hidden text-[10px] text-zinc-600 lg:inline">
          gen {generation} · v{version} · coherence {(metrics.coherence * 100).toFixed(0)}%
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* layout controls */}
          <button
            type="button"
            title={layoutMode === "tile" ? "Switch to float" : "Switch to tile"}
            onClick={() => setLayoutMode(layoutMode === "tile" ? "float" : "tile")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-[10px]",
              layoutMode === "tile"
                ? "bg-[--ae-cyan]/15 text-[--ae-cyan] glow-cyan"
                : "text-zinc-400 hover:bg-white/8"
            )}
          >
            <Layers className="h-3 w-3" />
            {layoutMode}
          </button>
          <div className="flex items-center gap-0.5 rounded-md bg-black/25 p-0.5">
            {Array.from({ length: DESKTOPS }, (_, i) => i + 1).map((desktop) => {
              const count = windows.filter((w) => w.desktop === desktop).length;
              return (
                <button
                  key={desktop}
                  type="button"
                  title={`Desktop ${desktop}`}
                  onClick={() => setActiveDesktop(desktop)}
                  className={cn(
                    "font-mono-ae relative h-6 w-6 rounded text-[10px]",
                    desktop === activeDesktop ? "bg-[--ae-cyan]/20 text-[--ae-cyan]" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {desktop}
                  {count > 0 && (
                    <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-[--ae-gold]" />
                  )}
                </button>
              );
            })}
          </div>

          <ModelSettingsButton onOpen={() => setModelOpen(true)} />

          <button
            type="button"
            title={autonomyMode === "active" ? "Autonomy: active" : "Autonomy: standby"}
            onClick={toggleAutonomy}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-[10px]",
              autonomyMode === "active"
                ? "bg-[--ae-emerald]/15 text-[--ae-emerald]"
                : "text-zinc-400 hover:bg-white/8"
            )}
          >
            <span className={cn("neural-dot", autonomyMode !== "active" && "opacity-40")} />
            auto
          </button>
          <button
            type="button"
            title="Force an AI cycle now"
            onClick={triggerCycle}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/8 hover:text-[--ae-amethyst]"
          >
            <Play className="h-3 w-3" /> evolve
          </button>
          <button
            type="button"
            title="Synapse map"
            onClick={toggleSynapse}
            className="hidden h-7 items-center rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/8 hover:text-[--ae-cyan] sm:flex"
          >
            <Sparkles className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Flow mode"
            onClick={toggleFlow}
            className="hidden h-7 items-center rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/8 hover:text-[--ae-gold] sm:flex"
          >
            <Zap className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Chat"
            onClick={toggleChat}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/8 hover:text-[--ae-amethyst]"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Notifications (F8)"
            onClick={() => window.dispatchEvent(new CustomEvent("alpha-notification-center-open"))}
            className={cn("flex h-7 w-7 items-center justify-center rounded-md", notifOpen ? "text-[--ae-gold]" : "text-zinc-400 hover:bg-white/8")}
          >
            <Bell className="h-3.5 w-3.5" />
          </button>
          <span className="hidden items-center gap-1 text-[10px] text-zinc-600 lg:flex">
            <Cpu className="h-3 w-3" /> {metrics.cpu.toFixed(0)}%
          </span>
        </div>
      </header>

      <ModelSettings open={modelOpen} onClose={() => setModelOpen(false)} />
    </>
  );
}

export default TopBar;
