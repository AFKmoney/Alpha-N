/**
 * wallpaper-presets.ts — procedural wallpaper presets for the desktop.
 * Each preset carries the palette + style consumed by obsidian-background
 * (gradient blobs) and the wallpaper app (live preview + apply).
 */

export interface WallpaperPreset {
  id: string;
  name: string;
  /** oklch/hex colors for the drifting gradient blobs */
  colors: string[];
  /** "oil" = large slow blobs, "grid" = faint grid overlay, "particles" = stars */
  style: "oil" | "grid" | "particles";
  speed: number;
}

const c = {
  cyan: "oklch(0.82 0.17 195)",
  amethyst: "oklch(0.74 0.22 300)",
  gold: "oklch(0.85 0.16 85)",
  emerald: "oklch(0.7 0.18 145)",
  rose: "oklch(0.65 0.24 25)",
  obsidian: "oklch(0.13 0.02 280)",
  deep: "oklch(0.09 0.02 280)",
  violet: "oklch(0.55 0.2 285)",
  teal: "oklch(0.6 0.12 175)",
};

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: "preset-0", name: "Obsidian Oil", colors: [c.deep, c.obsidian, c.amethyst, c.cyan], style: "oil", speed: 0.5 },
  { id: "preset-1", name: "Neural Dusk", colors: [c.deep, c.violet, c.amethyst, c.gold], style: "oil", speed: 0.4 },
  { id: "preset-2", name: "Cyan Abyss", colors: [c.deep, c.teal, c.cyan, c.obsidian], style: "oil", speed: 0.6 },
  { id: "preset-3", name: "Emerald Drift", colors: [c.deep, c.emerald, c.teal, c.obsidian], style: "oil", speed: 0.45 },
  { id: "preset-4", name: "Solar Obsidian", colors: [c.deep, c.rose, c.gold, c.obsidian], style: "oil", speed: 0.35 },
  { id: "preset-5", name: "Amethyst Veil", colors: [c.obsidian, c.amethyst, c.violet, c.deep], style: "oil", speed: 0.55 },
  { id: "preset-6", name: "Particle Galaxy", colors: [c.deep, c.obsidian, c.cyan], style: "particles", speed: 0.3 },
  { id: "preset-7", name: "Starfall", colors: [c.deep, c.violet, c.cyan], style: "particles", speed: 0.5 },
  { id: "preset-8", name: "Neural Grid", colors: [c.deep, c.obsidian, c.cyan], style: "grid", speed: 0.2 },
  { id: "preset-9", name: "Blueprint (no blue)", colors: [c.deep, c.teal, c.emerald], style: "grid", speed: 0.25 },
  { id: "preset-10", name: "Golden Fog", colors: [c.obsidian, c.gold, c.deep], style: "oil", speed: 0.4 },
  { id: "preset-11", name: "Void Minimal", colors: [c.deep, c.obsidian], style: "oil", speed: 0.15 },
  { id: "preset-12", name: "Aurora Field", colors: [c.deep, c.emerald, c.cyan, c.amethyst], style: "oil", speed: 0.65 },
  { id: "preset-13", name: "Ember Glass", colors: [c.deep, c.rose, c.gold, c.amethyst], style: "oil", speed: 0.5 },
  { id: "preset-14", name: "Ion Storm", colors: [c.obsidian, c.cyan, c.amethyst, c.emerald], style: "particles", speed: 0.8 },
  { id: "preset-15", name: "Moon Cradle", colors: [c.deep, c.cyan, c.obsidian], style: "oil", speed: 0.3 },
];

export function presetById(id: string): WallpaperPreset {
  return WALLPAPER_PRESETS.find((p) => p.id === id) ?? WALLPAPER_PRESETS[0];
}
