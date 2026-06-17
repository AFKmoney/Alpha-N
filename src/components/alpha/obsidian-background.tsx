/**
 * obsidian-background.tsx — the desktop wallpaper renderer. Loads the active
 * wallpaper from the API on mount (persistent), tracks mouse position, and
 * listens for `alpha-wallpaper-change` events to switch instantly.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { WALLPAPER_PRESETS, type WallpaperRenderCtx } from "@/lib/alpha/wallpaper-presets";

interface ActiveWallpaper {
  presetId: string;
  config: Record<string, unknown>;
  name: string;
}

/**
 * ObsidianBackground — the desktop wallpaper renderer.
 *
 * - Loads the active wallpaper from the API on mount (persistent).
 * - Tracks mouse position and passes it to every renderer (mouse-reactive).
 * - Listens for `alpha-wallpaper-change` events to switch instantly.
 */
export function ObsidianBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wallpaper, setWallpaper] = useState<ActiveWallpaper | null>(null);
  const mouseRef = useRef<WallpaperRenderCtx>({ mx: 0.5, my: 0.5 });

  // Load active wallpaper from API on mount
  useEffect(() => {
    void fetch("/api/alpha/wallpaper")
      .then((r) => r.json())
      .then((data) => { if (data.presetId) setWallpaper(data); })
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

  // Track mouse position (throttled to 60fps via rAF)
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        mouseRef.current = {
          mx: e.clientX / window.innerWidth,
          my: e.clientY / window.innerHeight,
        };
        raf = 0;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
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

    const presetId = wallpaper?.presetId || "preset-0";
    const preset = WALLPAPER_PRESETS.find((p) => p.id === presetId) || WALLPAPER_PRESETS[0];

    const start = Date.now();
    const draw = () => {
      const t = Date.now() - start;
      preset.render(ctx, w, h, t, mouseRef.current);
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
