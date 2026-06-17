"use client";

import { useEffect, useRef } from "react";

/**
 * ObsidianBackground — "oil under the moon".
 * A deep obsidian surface with slow-drifting dark gradient waves.
 * Pure canvas, GPU-cheap, never blocks the main thread for long.
 */
export function ObsidianBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const blobs = [
      { x: 0.2, y: 0.25, r: 0.55, hue: 265, sat: 0.5, l: 0.16, speed: 0.00018, phase: 0 },
      { x: 0.8, y: 0.7, r: 0.6, hue: 290, sat: 0.45, l: 0.13, speed: 0.00013, phase: 2 },
      { x: 0.55, y: 0.5, r: 0.7, hue: 200, sat: 0.4, l: 0.1, speed: 0.00009, phase: 4 },
      { x: 0.15, y: 0.85, r: 0.4, hue: 310, sat: 0.4, l: 0.12, speed: 0.00021, phase: 1 },
    ];

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      // Base obsidian fill
      ctx.fillStyle = "oklch(0.09 0.012 265)";
      ctx.fillRect(0, 0, w, h);

      // Soft vignette
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, "oklch(0.12 0.02 265 / 0.0)");
      vg.addColorStop(1, "oklch(0.03 0.01 265 / 0.85)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // Drifting oil blobs
      ctx.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        const px = (b.x + Math.sin(t * b.speed + b.phase) * 0.12) * w;
        const py = (b.y + Math.cos(t * b.speed * 1.3 + b.phase) * 0.1) * h;
        const radius = Math.max(40, b.r * Math.min(w, h));
        const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
        g.addColorStop(0, `oklch(${b.l + 0.06} ${b.sat} ${b.hue} / 0.55)`);
        g.addColorStop(0.5, `oklch(${b.l} ${b.sat} ${b.hue} / 0.18)`);
        g.addColorStop(1, `oklch(${b.l} ${b.sat} ${b.hue} / 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Fine grain noise for "organic" texture (cheap, sparse)
      if ((t | 0) % 3 === 0) {
        ctx.globalAlpha = 0.025;
        for (let i = 0; i < 40; i++) {
          const nx = Math.random() * w;
          const ny = Math.random() * h;
          ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
          ctx.fillRect(nx, ny, 1, 1);
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
