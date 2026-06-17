"use client";

import { useEffect, useRef, useState } from "react";
import { WALLPAPER_PRESETS } from "@/lib/alpha/wallpaper-presets";

interface ActiveWallpaper {
  presetId: string;
  config: Record<string, unknown>;
  name: string;
}

/**
 * ObsidianBackground — the desktop wallpaper renderer.
 *
 * Loads the active wallpaper from the API on mount, then renders it
 * on a full-screen canvas. Listens for `alpha-wallpaper-change` events
 * to switch wallpapers instantly without reload.
 *
 * Falls back to "obsidian-oil" (preset-0) if no wallpaper is set.
 */
export function ObsidianBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wallpaper, setWallpaper] = useState<ActiveWallpaper | null>(null);

  // Load active wallpaper from API on mount
  useEffect(() => {
    void fetch("/api/alpha/wallpaper")
      .then((r) => r.json())
      .then((data) => {
        if (data.presetId) setWallpaper(data);
      })
      .catch(() => {});
  }, []);

  // Listen for live wallpaper changes
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as ActiveWallpaper;
      if (detail) setWallpaper(detail);
    };
    window.addEventListener("alpha-wallpaper-change", onChange);
    return () => window.removeEventListener("alpha-wallpaper-change", onChange);
  }, []);

  // Render the wallpaper
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Find the preset render function
    const presetId = wallpaper?.presetId || "preset-0";
    const preset = WALLPAPER_PRESETS.find((p) => p.id === presetId) || WALLPAPER_PRESETS[0];

    const start = Date.now();
    const draw = () => {
      const t = Date.now() - start;
      preset.render(ctx, w, h, t);
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [wallpaper]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
