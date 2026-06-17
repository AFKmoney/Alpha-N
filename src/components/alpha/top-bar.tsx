"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { AnimatedLogo } from "./top-bar-logo";
import { ModelSettings } from "./model-settings";
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

export function TopBar() {
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
    autonomy,
    toggleAutonomy,
    aiBusy,
    toggleChat,
    chatOpen,
  } = useEvolution();

  const busy = aiState !== "observing";

  return (
    <SideBar>
      {/* Logo at top */}
      <AnimatedLogo />

      {/* Council — compact inline chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow w-full mb-1">council</span>
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

      {/* Divider */}
      <div className="h-px w-full bg-border/40" />

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => triggerCycle()}
          disabled={busy || aiBusy}
          className="flex items-center gap-2 rounded-lg border border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 px-3 py-2 text-xs text-[oklch(0.85_0.16_85)] transition-all hover:bg-[oklch(0.85_0.16_85)]/20 disabled:opacity-40"
          title="Force AI self-improvement cycle"
        >
          <Sparkles className={cn("h-4 w-4", aiState === "self-improving" && "animate-spin")} />
          <span className="font-mono-ae">{aiState === "self-improving" ? "mutating…" : "evolve"}</span>
        </button>

        <button
          onClick={triggerGenerate}
          disabled={busy || aiBusy}
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs transition-all hover:bg-card/70 disabled:opacity-40"
          title="Ask the brain to ghost-write"
        >
          <Zap className={cn("h-4 w-4", aiState === "generating" && "text-[oklch(0.74_0.22_300)]")} />
          <span className="font-mono-ae">generate</span>
        </button>

        <button
          onClick={toggleChat}
          className={cn(
            "relative flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
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
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
            autonomy
              ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 text-[oklch(0.85_0.16_85)]"
              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
          )}
          title="Toggle autonomous self-improvement"
        >
          {autonomy ? <Sparkles className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="font-mono-ae">{autonomy ? "autonomous" : "paused"}</span>
        </button>

        <button
          onClick={toggleSynapse}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
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
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
            flowMode ? "border-transparent glow-gold bg-card/70" : "border-border/60 bg-card/40 hover:bg-card/70"
          )}
          title="Flow mode"
        >
          <Target className="h-4 w-4" />
          <span className="font-mono-ae">flow</span>
        </button>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-border/40" />

      {/* Layout + desktops + model settings */}
      <div className="flex flex-col gap-2">
        <LayoutControls />
        <ModelSettings />
      </div>
    </SideBar>
  );
}

/**
 * SideBar — a left-edge floating panel that appears on mouse proximity.
 * Same pattern as the bottom Dock: hidden by default, slides in when
 * the cursor approaches the left edge of the screen.
 */
function SideBar({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for child modals opening/closing — when a modal is open,
  // the sidebar stays pinned and doesn't auto-hide on mouse leave.
  useEffect(() => {
    const onModalOpen = () => { setModalOpen(true); if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
    const onModalClose = () => setModalOpen(false);
    window.addEventListener("alpha-modal-open", onModalOpen);
    window.addEventListener("alpha-modal-close", onModalClose);
    return () => {
      window.removeEventListener("alpha-modal-open", onModalOpen);
      window.removeEventListener("alpha-modal-close", onModalClose);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (e.clientX < 60) {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
        setVisible(true);
      } else if (e.clientX > 320 && !modalOpen) {
        if (!hideTimer.current) {
          hideTimer.current = setTimeout(() => setVisible(false), 400);
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [modalOpen]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="glass-strong fixed left-2 top-2 z-40 flex max-h-[96vh] w-[300px] flex-col gap-3 overflow-y-auto rounded-2xl border border-border/60 p-4 scroll-ae"
          data-ai-skip="true"
          onMouseEnter={() => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } }}
          onMouseLeave={() => { if (!modalOpen) { hideTimer.current = setTimeout(() => setVisible(false), 400); } }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * SideBarHint — a small tab on the left edge to invite the sidebar.
 */
export function SideBarHint() {
  return (
    <div className="pointer-events-none fixed left-0 top-1/2 z-30 -translate-y-1/2" data-ai-skip="true">
      <div className="h-16 w-1 rounded-r-full bg-foreground/15" />
    </div>
  );
}

/** LayoutControls — tile/float toggle + desktop switcher (compact vertical) */
function LayoutControls() {
  const { layoutMode, setLayoutMode, activeDesktop, setActiveDesktop, windows } = useOS();
  const tiled = layoutMode === "tile";

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setLayoutMode(tiled ? "float" : "tile")}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
          tiled
            ? "border-transparent glow-cyan bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)]"
            : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70"
          )}
        title={tiled ? "Tiling mode — click for floating" : "Floating mode — click for tiling"}
      >
        <Columns2 className="h-4 w-4" />
        <span className="font-mono-ae">{tiled ? "tile" : "float"}</span>
      </button>

      <div className="flex items-center gap-1">
        <Layers className="h-3 w-3 text-muted-foreground" />
        {DESKTOPS.map((d) => {
          const isActive = d.id === activeDesktop;
          const count = windows.filter((w) => w.desktop === d.id && !w.minimized).length;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDesktop(d.id)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full font-mono-ae text-[0.6rem] transition-all",
                isActive
                  ? "bg-[oklch(0.82_0.17_195)]/20 text-[oklch(0.82_0.17_195)] glow-cyan"
                  : "text-muted-foreground hover:bg-foreground/10"
              )}
            >
              {d.name}
              {count > 0 && !isActive && <span className="absolute -bottom-0.5 -right-0.5 h-1 w-1 rounded-full bg-muted-foreground/60" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
