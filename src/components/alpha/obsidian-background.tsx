/**
 * obsidian-background.tsx — the desktop's living backdrop: canvas gradients
 * drifting like oil under moonlight over obsidian, plus a fine grain.
 * The active palette comes from the wallpaper API (fallback: Obsidian Oil).
 */
"use client";

import { useEffect, useRef } from "react";
import { presetById, type WallpaperPreset } from "@/lib/alpha/wallpaper-presets";

interface Blob {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  colorIndex: number;
  phase: number;
}

function resolveColor(color: string): string {
  // canvas2d cannot parse oklch in every runtime — map known tokens to rgb
  const map: Record<string, string> = {
    "oklch(0.82 0.17 195)": "rgba(103,232,249,0.16)",
    "oklch(0.74 0.22 300)": "rgba(167,139,250,0.17)",
    "oklch(0.85 0.16 85)": "rgba(251,191,36,0.13)",
    "oklch(0.7 0.18 145)": "rgba(52,211,153,0.13)",
    "oklch(0.65 0.24 25)": "rgba(251,146,60,0.12)",
    "oklch(0.55 0.2 285)": "rgba(139,92,246,0.15)",
    "oklch(0.6 0.12 175)": "rgba(45,212,191,0.13)",
    "oklch(0.13 0.02 280)": "rgba(24,20,35,0.55)",
    "oklch(0.09 0.02 280)": "rgba(10,9,16,0.7)",
  };
  return map[color] ?? "rgba(80,70,120,0.12)";
}

export function ObsidianBackground(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const presetRef = useRef<WallpaperPreset>(presetById("preset-0"));

  useEffect(() => {
    const loadPreset = () => {
      void fetch("/api/alpha/wallpaper")
        .then((res) => res.json())
        .then((data: { active?: { presetId?: string } | null }) => {
          if (data.active?.presetId) {
            presetRef.current = presetById(data.active.presetId);
          }
        })
        .catch(() => {});
    };
    loadPreset();
    const onWallpaperChange = () => loadPreset();
    window.addEventListener("alpha-wallpaper-change", onWallpaperChange);
    return () => window.removeEventListener("alpha-wallpaper-change", onWallpaperChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let raf = 0;

    const makeBlobs = (count: number): Blob[] =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 220 + Math.random() * 380,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        colorIndex: i,
        phase: Math.random() * Math.PI * 2,
      }));

    let blobs: Blob[] = [];

    const seedBlobs = () => {
      const preset = presetRef.current;
      const count = preset.style === "grid" ? 3 : preset.colors.length * 2;
      blobs = makeBlobs(Math.max(count, 4));
      if (preset.style === "particles") {
        blobs = blobs.map((b) => ({ ...b, r: 120 + Math.random() * 160, vx: b.vx * 2.2, vy: b.vy * 2.2 }));
      }
    };
    seedBlobs();

    // seeded pseudo-random star field (deterministic per size)
    const stars = Array.from({ length: 140 }, (_, i) => {
      const a = Math.sin(i * 127.1) * 43758.5453;
      const b = Math.sin(i * 311.7) * 12543.1259;
      return {
        x: (a - Math.floor(a)) * width,
        y: (b - Math.floor(b)) * height,
        r: 0.4 + ((a - Math.floor(a)) % 1) * 1.1,
        alpha: 0.08 + ((b - Math.floor(b)) % 1) * 0.22,
      };
    });

    const draw = (time: number) => {
      const preset = presetRef.current;
      const speed = reduced ? 0 : preset.speed;

      ctx.fillStyle = "#0a0910";
      ctx.fillRect(0, 0, width, height);

      // star particles layer
      if (preset.style === "particles") {
        for (const star of stars) {
          ctx.globalAlpha = star.alpha;
          ctx.fillStyle = "#cbd5f5";
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // drifting oil blobs
      for (const blob of blobs) {
        blob.phase += 0.003 * speed;
        blob.x += blob.vx * speed + Math.sin(blob.phase) * 0.35 * speed;
        blob.y += blob.vy * speed + Math.cos(blob.phase * 0.8) * 0.3 * speed;
        if (blob.x < -blob.r) blob.x = width + blob.r;
        if (blob.x > width + blob.r) blob.x = -blob.r;
        if (blob.y < -blob.r) blob.y = height + blob.r;
        if (blob.y > height + blob.r) blob.y = -blob.r;

        const color = resolveColor(preset.colors[blob.colorIndex % preset.colors.length]);
        const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // faint grid overlay
      if (preset.style === "grid") {
        ctx.strokeStyle = "rgba(103,232,249,0.05)";
        ctx.lineWidth = 1;
        const step = 56;
        for (let gx = (time / 90) % step; gx < width; gx += step) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, height);
          ctx.stroke();
        }
        for (let gy = 0; gy < height; gy += step) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" data-ai-skip aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
      {/* grain */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(5,4,10,0.55) 100%)" }}
      />
    </div>
  );
}

export default ObsidianBackground;
