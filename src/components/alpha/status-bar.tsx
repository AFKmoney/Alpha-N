/**
 * status-bar.tsx — sticky footer showing live telemetry (CPU, RAM, entropy,
 * coherence), AI state, generation, version, and uptime.
 */
"use client";

import { motion } from "framer-motion";
import { Cpu, Database, Gauge, Sparkles, Waves } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AutonomyModeSelector } from "@/components/alpha/autonomy-mode-selector";
import { AUTONOMY_POLICIES } from "@/lib/alpha/autonomy-policy";
import { cn } from "@/lib/utils";

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function StatusBar() {
  const metrics = useEvolution((s) => s.metrics);
  const version = useEvolution((s) => s.version);
  const generation = useEvolution((s) => s.generation);
  const aiState = useEvolution((s) => s.aiState);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const uptimeMs = useEvolution((s) => s.uptimeMs);
  const autonomyLevel = useEvolution((s) => s.autonomyLevel);
  const autonomyMode = useEvolution((s) => s.autonomyMode);
  const policy = AUTONOMY_POLICIES[autonomyLevel];

  const stateLabel =
    aiState === "observing"
      ? "at rest"
      : aiState === "generating"
        ? "generating"
        : `mutating · phase ${activeEvolution ? activeEvolution.phase + 1 : 0}/${activeEvolution?.scenario.logs.length ?? 0}`;

  const stateColor =
    aiState === "observing"
      ? "text-[oklch(0.82_0.17_195)]"
      : aiState === "generating"
        ? "text-[oklch(0.74_0.22_300)]"
        : "text-[oklch(0.85_0.16_85)]";

  return (
    <footer className="relative z-30 mt-auto flex items-center justify-between gap-3 border-t border-border/60 bg-card/40 px-4 py-1.5 backdrop-blur-xl">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <motion.span
            animate={{ scale: aiState === "observing" ? [1, 1.3, 1] : 1 }}
            transition={{ duration: 2, repeat: Infinity }}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              aiState === "observing"
                ? "bg-[oklch(0.82_0.17_195)]"
                : aiState === "generating"
                  ? "bg-[oklch(0.74_0.22_300)]"
                  : "bg-[oklch(0.85_0.16_85)]"
            )}
          />
          <span className={cn("font-mono-ae text-[0.62rem] font-semibold", stateColor)}>
            {stateLabel}
          </span>
        </div>
        <div className="hidden h-3 w-px bg-border/60 sm:block" />
        <Metric icon={<Cpu className="h-3 w-3" />} label="cpu" value={`${metrics.cpu.toFixed(0)}%`} bar={metrics.cpu / 100} color="oklch(0.82 0.17 195)" />
        <Metric icon={<Database className="h-3 w-3" />} label="ram" value={`${metrics.ram.toFixed(1)}GB`} bar={metrics.ram / 4} color="oklch(0.74 0.22 300)" />
        <Metric icon={<Waves className="h-3 w-3" />} label="entropy" value={metrics.entropy.toFixed(2)} bar={metrics.entropy} color="oklch(0.85 0.16 85)" />
        <Metric icon={<Gauge className="h-3 w-3" />} label="coherence" value={`${(metrics.coherence * 100).toFixed(0)}%`} bar={metrics.coherence} color="oklch(0.7 0.18 145)" />
      </div>

      <div className="flex items-center gap-3">
        {/* Autonomy trust level — always visible so the user knows what
            the AI is currently allowed to do. Click cycles levels. */}
        <div className="hidden items-center gap-1.5 md:flex" title={policy.description}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: policy.accent }}
          />
          <span className="font-mono-ae text-[0.62rem]" style={{ color: policy.accent }}>
            {policy.label}
          </span>
          <span className="font-mono-ae text-[0.62rem] text-muted-foreground">
            · {autonomyMode === "active" ? "active" : "standby"}
          </span>
        </div>
        <div className="hidden md:block">
          <AutonomyModeSelector variant="compact" />
        </div>
        <div className="hidden items-center gap-1.5 sm:flex">
          <Sparkles className="h-3 w-3 text-[oklch(0.85_0.16_85)]" />
          <span className="font-mono-ae text-[0.62rem] text-muted-foreground">
            gen {generation} · v{version} · up {formatUptime(uptimeMs)}
          </span>
        </div>
        <div className="hidden h-3 w-px bg-border/60 md:block" />
        <span className="font-mono-ae text-[0.62rem] text-muted-foreground">
          alpha-n · recursive self-improving ide
        </span>
      </div>
    </footer>
  );
}

function Metric({
  icon,
  label,
  value,
  bar,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bar: number;
  color: string;
}) {
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <span className="text-muted-foreground">{icon}</span>
      <span className="eyebrow hidden lg:inline">{label}</span>
      <span className="font-mono-ae text-[0.62rem] tabular-nums text-foreground/80">{value}</span>
      <div className="h-1 w-10 overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${Math.max(4, Math.min(100, bar * 100))}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
    </div>
  );
}
