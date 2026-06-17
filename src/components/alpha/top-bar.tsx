"use client";

import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Columns2,
  GitBranch,
  Layers,
  Network,
  Play,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { Nucleus } from "./nucleus";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { DESKTOPS } from "@/lib/alpha/os-types";
import { AGENT_META, type Agent } from "@/lib/alpha/evolution-data";
import { cn } from "@/lib/utils";

const HUE_TEXT: Record<Agent["hue"], string> = {
  cyan: "text-[oklch(0.82_0.17_195)]",
  amethyst: "text-[oklch(0.74_0.22_300)]",
  gold: "text-[oklch(0.85_0.16_85)]",
  rose: "text-[oklch(0.7_0.22_15)]",
};
const HUE_BG: Record<Agent["hue"], string> = {
  cyan: "bg-[oklch(0.82_0.17_195)]",
  amethyst: "bg-[oklch(0.74_0.22_300)]",
  gold: "bg-[oklch(0.85_0.16_85)]",
  rose: "bg-[oklch(0.7_0.22_15)]",
};

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function TopBar() {
  const {
    version,
    generation,
    uptimeMs,
    aiState,
    agents,
    activeAgent,
    flowMode,
    synapseOpen,
    triggerCycle,
    toggleFlow,
    toggleSynapse,
    triggerGenerate,
    autonomy,
    toggleAutonomy,
    aiBusy,
    toggleChat,
    chatOpen,
  } = useEvolution();

  const busy = aiState !== "observing";

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 border-b border-border/60 px-4 py-2.5 backdrop-blur-xl sm:px-6">
      {/* Left: brand + nucleus */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <div className="flex items-baseline gap-2">
              <span className="font-mono-ae text-lg font-semibold tracking-tight text-foreground">
                Alpha<span className="text-glow-cyan text-[oklch(0.82_0.17_195)]">-N</span>
              </span>
              <span className="eyebrow hidden md:inline">recursive ide</span>
            </div>
          </div>
        </div>
        <div className="h-8 w-px bg-border/60" />
        <Nucleus size={44} showLabel={false} />
      </div>

      {/* Center: council */}
      <div className="hidden items-center gap-2 lg:flex">
        <span className="eyebrow mr-1">council</span>
        {agents.map((a) => {
          const isActive = activeAgent === a.role;
          return (
            <motion.div
              key={a.role}
              layout
              className={cn(
                "group relative flex items-center gap-2 rounded-full border px-2.5 py-1 transition-all",
                isActive
                  ? "border-transparent " + (a.hue === "cyan" ? "glow-cyan" : a.hue === "amethyst" ? "glow-amethyst" : "glow-gold")
                  : "border-border/60 bg-card/40"
              )}
            >
              <span className={cn("text-sm leading-none", HUE_TEXT[a.hue])}>
                {a.glyph}
              </span>
              <span className="font-mono-ae text-[0.65rem] text-muted-foreground">
                {AGENT_META[a.role].name.replace("The ", "")}
              </span>
              {isActive && (
                <span className={cn("h-1.5 w-1.5 rounded-full neural-dot", HUE_BG[a.hue])} />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Right: telemetry + actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-3 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 md:flex">
          <Telemetry icon={<GitBranch className="h-3 w-3" />} label="gen" value={String(generation)} />
          <div className="h-3 w-px bg-border/60" />
          <Telemetry icon={<Sparkles className="h-3 w-3" />} label="ver" value={version} />
          <div className="h-3 w-px bg-border/60" />
          <Telemetry icon={<Activity className="h-3 w-3" />} label="up" value={formatUptime(uptimeMs)} />
        </div>

        <LayoutControls />

        <button
          onClick={triggerGenerate}
          disabled={busy || aiBusy}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs transition-all hover:border-[oklch(0.74_0.22_300)]/50 hover:bg-card/70 disabled:opacity-40",
            aiState === "generating" && "glow-amethyst border-transparent"
          )}
          title="Ask the brain to ghost-write"
        >
          <Zap className={cn("h-3.5 w-3.5", aiState === "generating" && "text-[oklch(0.74_0.22_300)]")} />
          <span className="hidden font-mono-ae sm:inline">generate</span>
        </button>

        <button
          onClick={toggleChat}
          className={cn(
            "relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all",
            chatOpen
              ? "border-transparent glow-amethyst bg-card/70"
              : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Talk to N-Core"
        >
          <Bot className={cn("h-3.5 w-3.5", chatOpen && "text-[oklch(0.74_0.22_300)]")} />
          <span className="hidden font-mono-ae sm:inline">chat</span>
          {aiBusy && (
            <motion.span
              animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[oklch(0.74_0.22_300)]"
            />
          )}
        </button>

        <button
          onClick={toggleAutonomy}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all",
            autonomy
              ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 text-[oklch(0.85_0.16_85)]"
              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
          )}
          title="Toggle autonomous self-improvement"
        >
          {autonomy ? <Sparkles className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span className="hidden font-mono-ae sm:inline">{autonomy ? "autonomous" : "paused"}</span>
        </button>

        <button
          onClick={toggleSynapse}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all",
            synapseOpen
              ? "border-transparent glow-cyan bg-card/70"
              : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Toggle the Synapse Map"
        >
          <Network className="h-3.5 w-3.5" />
          <span className="hidden font-mono-ae sm:inline">synapse</span>
        </button>

        <button
          onClick={toggleFlow}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all",
            flowMode
              ? "border-transparent glow-gold bg-card/70"
              : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Enter flow mode — strip everything but the code"
        >
          <Target className="h-3.5 w-3.5" />
          <span className="hidden font-mono-ae sm:inline">flow</span>
        </button>

        <button
          onClick={() => triggerCycle()}
          disabled={busy || aiBusy}
          className="flex items-center gap-1.5 rounded-full border border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 px-3 py-1.5 text-xs text-[oklch(0.85_0.16_85)] transition-all hover:bg-[oklch(0.85_0.16_85)]/20 disabled:opacity-40"
          title="Force a real AI self-improvement cycle"
        >
          <Sparkles className={cn("h-3.5 w-3.5", aiState === "self-improving" && "animate-spin")} />
          <span className="hidden font-mono-ae sm:inline">
            {aiState === "self-improving" ? "mutating…" : "evolve"}
          </span>
        </button>
      </div>
    </header>
  );
}

function Telemetry({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="eyebrow">{label}</span>
      <span className="font-mono-ae text-xs text-foreground">{value}</span>
    </div>
  );
}

/** Tile/float toggle + virtual desktop switcher (the "layers" of the desktop). */
function LayoutControls() {
  const { layoutMode, setLayoutMode, activeDesktop, setActiveDesktop, windows } = useOS();
  const tiled = layoutMode === "tile";

  return (
    <div className="flex items-center gap-1.5">
      {/* Tile / Float (overlap) toggle */}
      <button
        onClick={() => setLayoutMode(tiled ? "float" : "tile")}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-all",
          tiled
            ? "border-transparent glow-cyan bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)]"
            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
        )}
        title={tiled ? "Tiling mode (no overlap) — click for floating" : "Floating mode (overlap) — click for tiling"}
      >
        <Columns2 className="h-3.5 w-3.5" />
        <span className="hidden font-mono-ae sm:inline">{tiled ? "tile" : "float"}</span>
      </button>

      {/* Virtual desktops / layers */}
      <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-card/40 px-1 py-1">
        <Layers className="mr-0.5 hidden h-3 w-3 text-muted-foreground sm:block" />
        {DESKTOPS.map((d) => {
          const isActive = d.id === activeDesktop;
          const count = windows.filter((w) => w.desktop === d.id && !w.minimized).length;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDesktop(d.id)}
              className={cn(
                "relative flex h-5 w-5 items-center justify-center rounded-full font-mono-ae text-[0.6rem] transition-all",
                isActive
                  ? "bg-[oklch(0.82_0.17_195)]/20 text-[oklch(0.82_0.17_195)] glow-cyan"
                  : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              )}
              title={`Desktop ${d.name} (${count} windows)`}
            >
              {d.name}
              {count > 0 && !isActive && (
                <span className="absolute -bottom-0.5 -right-0.5 h-1 w-1 rounded-full bg-muted-foreground/60" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
