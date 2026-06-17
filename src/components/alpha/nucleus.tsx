"use client";

import { useEffect, useRef } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { AiState } from "@/lib/alpha/evolution-data";

const STATE_COLORS: Record<AiState, { core: string; halo: string; particle: string; label: string }> = {
  observing: {
    core: "oklch(0.82 0.17 195)",
    halo: "oklch(0.7 0.16 200 / 0.5)",
    particle: "oklch(0.82 0.17 195)",
    label: "OBSERVING",
  },
  "self-improving": {
    core: "oklch(0.85 0.16 85)",
    halo: "oklch(0.78 0.16 80 / 0.6)",
    particle: "oklch(0.85 0.16 85)",
    label: "MUTATING",
  },
  generating: {
    core: "oklch(0.74 0.22 300)",
    halo: "oklch(0.66 0.22 300 / 0.6)",
    particle: "oklch(0.74 0.22 300)",
    label: "GENERATING",
  },
};

interface NucleusProps {
  size?: number;
  showLabel?: boolean;
}

/**
 * Nucleus — the 3D energy sphere at the heart of Alpha-N.
 * A cloud of particles projected onto a sphere, rotating, with a
 * luminous core and reactive halo. Color shifts with the AI state.
 */
export function Nucleus({ size = 120, showLabel = true }: NucleusProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AiState>("observing");
  const aiState = useEvolution((s) => s.aiState);

  useEffect(() => {
    stateRef.current = aiState;
  }, [aiState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = size;
    canvas.width = Math.floor(px * dpr);
    canvas.height = Math.floor(px * dpr);
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    ctx.scale(dpr, dpr);

    // Generate a fibresphere of particles
    const N = 220;
    const pts: { x: number; y: number; z: number; r: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = golden * i;
      pts.push({
        x: Math.cos(theta) * radius,
        y,
        z: Math.sin(theta) * radius,
        r: 0.6 + Math.random() * 1.1,
      });
    }

    let raf = 0;
    let t = 0;
    const R = px * 0.34;

    const draw = () => {
      t += 0.006;
      ctx.clearRect(0, 0, px, px);
      const cx = px / 2;
      const cy = px / 2;

      const colors = STATE_COLORS[stateRef.current];
      const pulse = 1 + Math.sin(t * 2.4) * (stateRef.current === "self-improving" ? 0.08 : 0.03);

      // Outer halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.1 * pulse);
      halo.addColorStop(0, colors.halo);
      halo.addColorStop(0.4, colors.halo.replace(/0\.\d+\)/, "0.18)"));
      halo.addColorStop(1, colors.halo.replace(/0\.\d+\)/, "0)"));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.1 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Core orb
      const core = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, 1, cx, cy, R * 0.7);
      core.addColorStop(0, "oklch(0.98 0.02 0)");
      core.addColorStop(0.25, colors.core);
      core.addColorStop(1, colors.core.replace(/\)/, " / 0.0)").replace(/oklch\(([^)]+)\)/, "oklch($1"));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.62 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Rotating particle shell
      const cosY = Math.cos(t);
      const sinY = Math.sin(t);
      const cosX = Math.cos(t * 0.5);
      const sinX = Math.sin(t * 0.5);

      // sort by z so far points draw first
      const proj = pts
        .map((p) => {
          // rotate Y
          let x = p.x * cosY - p.z * sinY;
          let z = p.x * sinY + p.z * cosY;
          // rotate X
          let y = p.y * cosX - z * sinX;
          z = p.y * sinX + z * cosX;
          return { sx: cx + x * R, sy: cy + y * R, z, r: p.r };
        })
        .sort((a, b) => a.z - b.z);

      for (const p of proj) {
        const depth = (p.z + 1) / 2; // 0 back .. 1 front
        const alpha = 0.12 + depth * 0.7;
        const rad = p.r * (0.5 + depth * 0.9);
        ctx.fillStyle = colors.particle.replace(/\)/, ` / ${alpha.toFixed(3)})`);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Equatorial rings (electric)
      ctx.strokeStyle = colors.core.replace(/\)/, " / 0.25)");
      ctx.lineWidth = 1;
      for (let ring = 0; ring < 3; ring++) {
        const rr = R * (0.78 + ring * 0.18) * pulse;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * (0.18 + Math.abs(Math.sin(t + ring)) * 0.12), t * (0.4 + ring * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const colors = STATE_COLORS[aiState];

  return (
    <div className="relative flex items-center gap-3" style={{ width: size }}>
      <canvas ref={canvasRef} aria-label={`Nucleus — ${colors.label}`} />
      {showLabel && (
        <div className="flex flex-col leading-none">
          <span className="eyebrow text-glow-cyan" style={{ color: colors.core }}>
            {colors.label}
          </span>
          <span className="mt-1 font-mono-ae text-[0.6rem] text-muted-foreground">
            N-CORE
          </span>
        </div>
      )}
    </div>
  );
}
