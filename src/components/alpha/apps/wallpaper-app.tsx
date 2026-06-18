/**
 * wallpaper-app.tsx — select, preview, save, and delete animated wallpapers.
 * 79 built-in canvas presets + custom AI-created wallpapers. Live preview
 * thumbnails render the actual animation. Persists selection via
 * /api/alpha/wallpaper and dispatches `alpha-wallpaper-change` to the
 * ObsidianBackground so the desktop switches instantly.
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Trash2, Check, Search, X } from "lucide-react";
import { WALLPAPER_PRESETS, type WallpaperPreset } from "@/lib/alpha/wallpaper-presets";
import { cn } from "@/lib/utils";

interface SavedWallpaper {
  id: string;
  name: string;
  presetId: string;
  config: Record<string, unknown>;
  isCustom: boolean;
}

interface ActiveWallpaper {
  presetId: string;
  config: Record<string, unknown>;
  name: string;
}

/**
 * WallpaperApp — select, preview, save, and delete animated wallpapers.
 *
 * Features:
 * - 79 built-in animated presets (canvas-based generative art)
 * - Live preview: each thumbnail renders the actual animation
 * - Click to apply → persists to DB via /api/alpha/wallpaper
 * - Custom wallpapers (AI-created) can be saved and deleted
 * - Search by name
 */
export function WallpaperApp() {
  const [active, setActive] = useState<ActiveWallpaper | null>(null);
  const [saved, setSaved] = useState<SavedWallpaper[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Load active wallpaper + saved wallpapers on mount
  useEffect(() => {
    void Promise.all([
      fetch("/api/alpha/wallpaper").then((r) => r.json()),
      fetch("/api/alpha/wallpaper?list=true").then((r) => r.json()),
    ]).then(([activeData, savedData]) => {
      setActive(activeData);
      setSaved(savedData.wallpapers || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Apply a wallpaper
  const applyWallpaper = useCallback(async (presetId: string, name: string) => {
    const wallpaper = { presetId, config: {}, name };
    setActive(wallpaper);
    try {
      await fetch("/api/alpha/wallpaper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wallpaper),
      });
      // Notify the desktop to switch wallpaper
      window.dispatchEvent(new CustomEvent("alpha-wallpaper-change", { detail: wallpaper }));
    } catch {
      // ignore
    }
  }, []);

  // Delete a saved custom wallpaper
  const deleteSaved = useCallback(async (id: string) => {
    try {
      await fetch("/api/alpha/wallpaper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      setSaved((prev) => prev.filter((w) => w.id !== id));
    } catch {
      // ignore
    }
  }, []);

  // Filter presets by search
  const filtered = WALLPAPER_PRESETS.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h3 className="font-mono-ae text-base font-semibold">Wallpaper Selector</h3>
        <span className="font-mono-ae text-xs text-muted-foreground">
          {WALLPAPER_PRESETS.length} presets · {saved.length} saved
        </span>
      </div>

      {/* Search */}
      <div className="border-b border-border/50 p-3">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wallpapers..."
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-sm text-foreground focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Active wallpaper indicator */}
      {active && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
          <span className="eyebrow">active:</span>
          <span className="font-mono-ae text-xs text-[oklch(0.82_0.17_195)]">{active.name}</span>
        </div>
      )}

      {/* Wallpaper grid */}
      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[oklch(0.82_0.17_195)] border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filtered.map((preset) => (
              <WallpaperCard
                key={preset.id}
                preset={preset}
                isActive={active?.presetId === preset.id}
                onApply={() => applyWallpaper(preset.id, preset.name)}
              />
            ))}
          </div>
        )}

        {/* Saved custom wallpapers */}
        {saved.length > 0 && (
          <div className="mt-4">
            <div className="eyebrow mb-2">saved custom wallpapers</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {saved.map((w) => (
                <div
                  key={w.id}
                  className="group relative flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 p-2"
                >
                  <span className="font-mono-ae text-xs text-foreground/70 truncate">{w.name}</span>
                  <button
                    onClick={() => deleteSaved(w.id)}
                    className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-[oklch(0.78_0.2_20)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * WallpaperCard — a live-preview thumbnail of a wallpaper preset.
 * Renders the actual generative art animation in a small canvas.
 */
function WallpaperCard({
  preset,
  isActive,
  onApply,
}: {
  preset: WallpaperPreset;
  isActive: boolean;
  onApply: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ mx: 0.5, my: 0.5 });

  // Render the live preview animation (mouse-reactive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = Date.now();

    const draw = () => {
      const t = Date.now() - start;
      preset.render(ctx, canvas.width, canvas.height, t, mouseRef.current);
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(raf);
  }, [preset]);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = {
      mx: (e.clientX - rect.left) / rect.width,
      my: (e.clientY - rect.top) / rect.height,
    };
  };

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onApply}
      onMouseMove={handleMouseMove}
      className={cn(
        "group relative overflow-hidden rounded-xl border-2 transition-all",
        isActive
          ? "border-[oklch(0.82_0.17_195)] shadow-[0_0_16px_-2px_oklch(0.82_0.17_195/0.4)]"
          : "border-border/40 hover:border-[oklch(0.82_0.17_195)]/30"
      )}
    >
      {/* Live preview canvas */}
      <canvas
        ref={canvasRef}
        width={200}
        height={120}
        className="h-28 w-full object-cover"
      />

      {/* Overlay */}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-background/80 to-transparent p-2">
        <span className="font-mono-ae text-[0.7rem] font-semibold text-foreground/90 truncate">
          {preset.name}
        </span>
        <span className="font-mono-ae text-[0.55rem] text-muted-foreground/70">
          {preset.category}
        </span>
      </div>

      {/* Active checkmark */}
      {isActive && (
        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[oklch(0.82_0.17_195)]">
          <Check className="h-3 w-3 text-background" />
        </div>
      )}
    </motion.button>
  );
}
