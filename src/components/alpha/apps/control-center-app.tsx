/**
 * control-center-app.tsx — the standalone Control Center app.
 *
 * This is the former left-edge floating sidebar, now a proper window app.
 * Contains: animated logo, council chips, action buttons (evolve, generate,
 * chat, autonomy, synapse, flow), layout controls, desktop switcher,
 * and model settings — all in one accessible window.
 *
 * Accessible from the desktop as a pinned shortcut, not just a hover overlay.
 * The AI can also open it via the create_app mutation.
 */
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Columns2,
  Layers,
  Network,
  Play,
  Sparkles,
  Target,
  Zap,
  X,
} from "lucide-react";
import { AnimatedLogo } from "@/components/alpha/top-bar-logo";
import { ModelSettings } from "@/components/alpha/model-settings";
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

export function ControlCenterApp({ windowId: _windowId }: { windowId?: string } = {}) {
  const {
    aiState,
    agents,
    activeAgent,
    flowMode,
    synapseOpen,
    triggerCycle,
    toggleFlow,
    toggleSynapse,
    triggerGenerate,
    autonomyMode,
    toggleAutonomy,
    aiBusy,
    toggleChat,
    chatOpen,
    constraints,
    addConstraint,
    removeConstraint,
    realMetrics,
  } = useEvolution();

  const { layoutMode, setLayoutMode, activeDesktop, setActiveDesktop, windows } = useOS();

  const [newConstraint, setNewConstraint] = useState("");

  const busy = aiState !== "observing";
  const tiled = layoutMode === "tile";

  return (
    <div className="scroll-ae flex h-full w-full flex-col gap-4 overflow-y-auto bg-background p-4">
      {/* Logo at top */}
      <div className="flex justify-center">
        <AnimatedLogo />
      </div>

      {/* Council — compact inline chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mb-1 w-full">council</span>
        {agents.map((a) => {
          const isActive = activeAgent === a.role;
          return (
            <motion.div
              key={a.role}
              layout
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 transition-all",
                isActive
                  ? "border-transparent " + (a.hue === "cyan" ? "glow-cyan" : a.hue === "amethyst" ? "glow-amethyst" : "glow-gold")
                  : "border-border/40 bg-card/30"
              )}
            >
              <span className={cn("text-xs leading-none", HUE_TEXT[a.hue])}>{a.glyph}</span>
              <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
                {AGENT_META[a.role].name.replace("The ", "")}
              </span>
              {isActive && <span className={cn("h-1 w-1 rounded-full", HUE_BG[a.hue])} />}
            </motion.div>
          );
        })}
      </div>

      <div className="h-px w-full bg-border/40" />

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">actions</span>

        <button
          onClick={() => triggerCycle()}
          disabled={busy || aiBusy}
          className="flex items-center gap-2 rounded-lg border border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 px-3 py-2.5 text-xs text-[oklch(0.85_0.16_85)] transition-all hover:bg-[oklch(0.85_0.16_85)]/20 disabled:opacity-40"
          title="Force AI self-improvement cycle"
        >
          <Sparkles className={cn("h-4 w-4", aiState === "self-improving" && "animate-spin")} />
          <span className="font-mono-ae">{aiState === "self-improving" ? "mutating…" : "evolve"}</span>
        </button>

        <button
          onClick={triggerGenerate}
          disabled={busy || aiBusy}
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-xs transition-all hover:bg-card/70 disabled:opacity-40"
          title="Ask the brain to ghost-write"
        >
          <Zap className={cn("h-4 w-4", aiState === "generating" && "text-[oklch(0.74_0.22_300)]")} />
          <span className="font-mono-ae">generate</span>
        </button>

        <button
          onClick={toggleChat}
          className={cn(
            "relative flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-all",
            chatOpen ? "border-transparent glow-amethyst bg-card/70" : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Talk to N-Core"
        >
          <Bot className={cn("h-4 w-4", chatOpen && "text-[oklch(0.74_0.22_300)]")} />
          <span className="font-mono-ae">chat</span>
          {aiBusy && (
            <motion.span
              animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[oklch(0.74_0.22_300)]"
            />
          )}
        </button>

        <button
          onClick={toggleAutonomy}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-all",
            autonomyMode === "active"
              ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 text-[oklch(0.85_0.16_85)]"
              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
          )}
          title="Toggle autonomous mode (standby = AI waits, active = AI works on tasks)"
        >
          {autonomyMode === "active" ? <Sparkles className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="font-mono-ae">{autonomyMode === "active" ? "active" : "standby"}</span>
        </button>

        <button
          onClick={toggleSynapse}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-all",
            synapseOpen ? "border-transparent glow-cyan bg-card/70" : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Synapse Map"
        >
          <Network className="h-4 w-4" />
          <span className="font-mono-ae">synapse</span>
        </button>

        <button
          onClick={toggleFlow}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-all",
            flowMode ? "border-transparent glow-gold bg-card/70" : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Flow mode"
        >
          <Target className="h-4 w-4" />
          <span className="font-mono-ae">flow</span>
        </button>
      </div>

      <div className="h-px w-full bg-border/40" />

      {/* Layout + desktops */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">layout</span>

        <button
          onClick={() => setLayoutMode(tiled ? "float" : "tile")}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-all",
            tiled
              ? "border-transparent glow-cyan bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)]"
              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
          )}
          title={tiled ? "Tiling mode — click for floating" : "Floating mode — click for tiling"}
        >
          <Columns2 className="h-4 w-4" />
          <span className="font-mono-ae">{tiled ? "tile" : "float"}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">desktop</span>
          {DESKTOPS.map((d) => {
            const isActive = d.id === activeDesktop;
            const count = windows.filter((w) => w.desktop === d.id && !w.minimized).length;
            return (
              <button
                key={d.id}
                onClick={() => setActiveDesktop(d.id)}
                className={cn(
                  "relative flex h-6 w-6 items-center justify-center rounded-full font-mono-ae text-[0.6rem] transition-all",
                  isActive
                    ? "bg-[oklch(0.82_0.17_195)]/20 text-[oklch(0.82_0.17_195)] glow-cyan"
                    : "text-muted-foreground hover:bg-foreground/10"
                )}
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

      <div className="h-px w-full bg-border/40" />

      {/* Model settings */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">model</span>
        <ModelSettings />
      </div>

      {/* ---- Phase 3: Self-improvement metrics ---- */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">metrics</span>
        <div className="grid grid-cols-2 gap-1.5 font-mono-ae text-[0.6rem]">
          <div className="rounded-lg border border-border/40 bg-card/30 px-2 py-1.5">
            <div className="text-muted-foreground">error rate</div>
            <div className={cn("text-sm font-bold", realMetrics.errorRate > 0.3 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]")}>
              {(realMetrics.errorRate * 100).toFixed(0)}%
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/30 px-2 py-1.5">
            <div className="text-muted-foreground">satisfaction</div>
            <div className="text-sm font-bold text-[oklch(0.82_0.17_195)]">
              {(realMetrics.userSatisfaction * 100).toFixed(0)}%
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/30 px-2 py-1.5">
            <div className="text-muted-foreground">actions</div>
            <div className="text-sm font-bold text-foreground">{realMetrics.totalActions}</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/30 px-2 py-1.5">
            <div className="text-muted-foreground">rollbacks</div>
            <div className="text-sm font-bold text-[oklch(0.85_0.16_85)]">{realMetrics.totalRollbacks}</div>
          </div>
        </div>
      </div>

      {/* ---- Phase 4: User constraints ---- */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">constraints</span>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newConstraint}
            onChange={(e) => setNewConstraint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newConstraint.trim()) {
                void addConstraint(newConstraint.trim());
                setNewConstraint("");
              }
            }}
            placeholder="e.g. don't touch the kernel"
            className="flex-1 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 font-mono-ae text-[0.65rem] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-[oklch(0.82_0.17_195)]/40"
          />
          <button
            onClick={() => {
              if (newConstraint.trim()) {
                void addConstraint(newConstraint.trim());
                setNewConstraint("");
              }
            }}
            className="rounded-lg border border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 px-2 py-1.5 font-mono-ae text-[0.65rem] text-[oklch(0.82_0.17_195)] hover:bg-[oklch(0.82_0.17_195)]/20"
          >
            add
          </button>
        </div>
        {constraints.length > 0 && (
          <div className="space-y-1">
            {constraints.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/30 px-2 py-1">
                <span className="font-mono-ae text-[0.6rem] text-muted-foreground">[{c.scope}]</span>
                <span className="min-w-0 flex-1 truncate font-mono-ae text-[0.65rem] text-foreground/80">{c.text}</span>
                <button
                  onClick={() => void removeConstraint(c.id)}
                  className="text-muted-foreground/50 hover:text-[oklch(0.78_0.2_20)]"
                  title="Remove constraint"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2 font-mono-ae text-[0.6rem] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {aiState}
        </span>
        <span>{autonomyMode}</span>
      </div>
    </div>
  );
}
