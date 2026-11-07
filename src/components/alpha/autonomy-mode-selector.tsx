/**
 * autonomy-mode-selector.tsx — the trust-level switch.
 *
 * Renders the three autonomy levels (Bac à sable / Modéré / YOLO) as a
 * segmented control with a live description + capability readout. This is
 * the single surface through which the user grants or revokes the AI's
 * reach. Wired to the evolution-store autonomyLevel, which the autonomous
 * loop consults via authorize() before applying any mutation.
 *
 * Variants:
 *   "full"  — segmented control + description + capability list (Control Center)
 *   "compact" — just the segmented chips (status bar / dock)
 */
"use client";

import { motion } from "framer-motion";
import { Shield, ShieldCheck, Flame, Lock, FileText, Terminal, Code2, Brain, Wifi } from "lucide-react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AUTONOMY_POLICIES, type AutonomyLevel } from "@/lib/alpha/autonomy-policy";
import { cn } from "@/lib/utils";

const LEVEL_ORDER: AutonomyLevel[] = ["sandbox", "moderate", "yolo"];

const LEVEL_META: Record<
  AutonomyLevel,
  { icon: typeof Shield; label: string; short: string }
> = {
  sandbox: { icon: Shield, label: "Bac à sable", short: "Sécurisé" },
  moderate: { icon: ShieldCheck, label: "Modéré", short: "Modéré" },
  yolo: { icon: Flame, label: "YOLO", short: "YOLO" },
};

export function AutonomyModeSelector({ variant = "full" }: { variant?: "full" | "compact" }) {
  const autonomyLevel = useEvolution((s) => s.autonomyLevel);
  const setAutonomyLevel = useEvolution((s) => s.setAutonomyLevel);
  const policy = AUTONOMY_POLICIES[autonomyLevel];

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
        {LEVEL_ORDER.map((lvl) => {
          const meta = LEVEL_META[lvl];
          const Icon = meta.icon;
          const active = autonomyLevel === lvl;
          return (
            <button
              key={lvl}
              onClick={() => setAutonomyLevel(lvl)}
              title={`${meta.label} — ${AUTONOMY_POLICIES[lvl].description}`}
              className={cn(
                "relative flex h-6 w-6 items-center justify-center rounded transition-all",
                active ? "text-white" : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={active}
              aria-label={`Autonomie: ${meta.label}`}
            >
              {active && (
                <motion.div
                  layoutId="autonomy-pill-compact"
                  className="absolute inset-0 rounded"
                  style={{ background: AUTONOMY_POLICIES[lvl].accent.replace(")", " / 0.22)") }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative h-3.5 w-3.5" style={active ? { color: AUTONOMY_POLICIES[lvl].accent } : undefined} />
            </button>
          );
        })}
      </div>
    );
  }

  const caps = policy.capabilities;

  // Capability checklist rows: icon, label, on/off.
  const capRows: { icon: typeof FileText; label: string; on: boolean }[] = [
    { icon: FileText, label: "Écriture de fichiers", on: caps.fileWrite },
    { icon: Lock, label: "Suppression de fichiers", on: caps.fileDelete },
    { icon: Terminal, label: "Terminal (shell)", on: caps.runTerminal },
    { icon: Code2, label: "Exécution de code", on: caps.executeCode },
    { icon: Wifi, label: "Réseau sortant (exec)", on: caps.execNetwork },
    { icon: Brain, label: "Auto-modification du prompt", on: caps.selfPrompt },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">niveau d&apos;autonomie</span>
        <span className="font-mono-ae text-[0.6rem] text-muted-foreground">kernel protégé</span>
      </div>

      {/* Segmented control */}
      <div className="relative grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
        {LEVEL_ORDER.map((lvl) => {
          const meta = LEVEL_META[lvl];
          const Icon = meta.icon;
          const active = autonomyLevel === lvl;
          const accent = AUTONOMY_POLICIES[lvl].accent;
          return (
            <button
              key={lvl}
              onClick={() => setAutonomyLevel(lvl)}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs transition-all",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={active}
            >
              {active && (
                <motion.div
                  layoutId="autonomy-pill-full"
                  className="absolute inset-0 rounded-md border"
                  style={{
                    background: `${accent} / 0.15)`,
                    borderColor: `${accent} / 0.5)`,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon
                className="relative h-4 w-4"
                style={active ? { color: accent } : undefined}
              />
              <span className="relative font-mono-ae text-[0.65rem]">{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Live description */}
      <motion.p
        key={autonomyLevel}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2.5 px-1 text-[0.7rem] leading-relaxed text-muted-foreground"
      >
        {policy.description}
      </motion.p>

      {/* Capability checklist */}
      <div className="mt-2.5 grid grid-cols-1 gap-1 border-t border-border/40 pt-2.5">
        {capRows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-center gap-2 px-1 text-[0.7rem]">
              <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              <span className={cn("flex-1", row.on ? "text-foreground" : "text-muted-foreground/60")}>
                {row.label}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  row.on ? "bg-[oklch(0.78_0.18_145)]" : "bg-muted-foreground/30"
                )}
                title={row.on ? "Autorisé" : "Bloqué"}
              />
            </div>
          );
        })}
      </div>

      {/* Rate limit hint */}
      {caps.actionsPerMinute > 0 && (
        <p className="mt-2 px-1 text-[0.6rem] text-muted-foreground/60">
          Plafond: {caps.actionsPerMinute} actions conséquentes / minute.
        </p>
      )}
      {autonomyLevel === "yolo" && (
        <p className="mt-2 px-1 text-[0.6rem] text-[oklch(0.7_0.22_20)]/80">
          ⚠ Aucun plafond. Le kernel reste sacré quoi qu&apos;il arrive.
        </p>
      )}
    </div>
  );
}
