/**
 * wallpaper-app.tsx — the wallpaper picker: live previews of every preset,
 * one click applies (POST /api/alpha/wallpaper + alpha-wallpaper-change so
 * the desktop canvas swaps instantly).
 */
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { WALLPAPER_PRESETS } from "@/lib/alpha/wallpaper-presets";

function resolveColor(color: string): string {
  const map: Record<string, string> = {
    "oklch(0.82 0.17 195)": "#67e8f9",
    "oklch(0.74 0.22 300)": "#a78bfa",
    "oklch(0.85 0.16 85)": "#fbbf24",
    "oklch(0.7 0.18 145)": "#34d399",
    "oklch(0.65 0.24 25)": "#fb923c",
    "oklch(0.55 0.2 285)": "#8b5cf6",
    "oklch(0.6 0.12 175)": "#2dd4bf",
    "oklch(0.13 0.02 280)": "#181423",
    "oklch(0.09 0.02 280)": "#0a0910",
  };
  return map[color] ?? "#1a1826";
}

export function WallpaperApp(): React.ReactElement {
  const [activeId, setActiveId] = useState<string>("preset-0");

  const apply = async (presetId: string, name: string) => {
    setActiveId(presetId);
    try {
      await fetch("/api/alpha/wallpaper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", presetId, config: {}, name }),
      });
    } catch {
      /* preview still applies */
    }
    window.dispatchEvent(new CustomEvent("alpha-wallpaper-change", { detail: { presetId } }));
  };

  return (
    <div className="scroll-ae h-full overflow-y-auto p-4">
      <p className="eyebrow mb-3">wallpaper — liquid obsidian presets</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {WALLPAPER_PRESETS.map((preset, i) => (
          <motion.button
            key={preset.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => void apply(preset.id, preset.name)}
            className={cn(
              "group relative h-20 overflow-hidden rounded-xl border transition-all",
              activeId === preset.id ? "border-[--ae-cyan] glow-cyan" : "border-white/10 hover:border-white/25"
            )}
            style={{
              background: `radial-gradient(circle at 25% 40%, ${resolveColor(preset.colors[2] ?? preset.colors[0])}55, transparent 60%), radial-gradient(circle at 75% 65%, ${resolveColor(preset.colors[3] ?? preset.colors[1] ?? preset.colors[0])}44, transparent 55%), ${resolveColor(preset.colors[0])}`,
            }}
          >
            <span className="font-mono-ae absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-2 py-1 text-[9.5px] text-zinc-300 backdrop-blur-sm">
              {preset.name}
              {activeId === preset.id && <Check className="h-3 w-3 text-[--ae-cyan]" />}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export default WallpaperApp;
