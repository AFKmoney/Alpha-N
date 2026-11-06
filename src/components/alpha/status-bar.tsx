/**
 * status-bar.tsx — the sticky footer: CPU/RAM/entropy/coherence telemetry,
 * heartbeat, autonomy state, and the clock (hydration-safe).
 */
"use client";

import { cn } from "@/lib/utils";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { useMounted } from "@/lib/alpha/use-mounted";

function Metric({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <span className={cn("w-14 overflow-hidden rounded-full bg-white/12", color)}>
        <span
          className="block h-1 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: "currentColor", boxShadow: "0 0 3px currentColor" }}
        />
      </span>
      <span className="text-zinc-300">{value}</span>
    </span>
  );
}

export function StatusBar(): React.ReactElement {
  const metrics = useEvolution((s) => s.metrics);
  const heartbeat = useEvolution((s) => s.heartbeat);
  const autonomyMode = useEvolution((s) => s.autonomyMode);
  const autonomyLevel = useEvolution((s) => s.autonomyLevel);
  const aiState = useEvolution((s) => s.aiState);
  const mounted = useMounted();
  const windows = useOS((s) => s.windows);
  const activeDesktop = useOS((s) => s.activeDesktop);

  const openCount = windows.filter((w) => w.desktop === activeDesktop && !w.minimized).length;

  return (
    <footer
      className="font-mono-ae glass fixed inset-x-0 bottom-0 z-[7000] flex h-7 items-center gap-4 border-t border-white/8 px-3 text-[10px]"
      data-ai-skip
    >
      <Metric label="cpu" value={`${metrics.cpu.toFixed(0)}%`} pct={metrics.cpu} color="text-(--ae-cyan)" />
      <Metric label="ram" value={`${metrics.ram.toFixed(1)}G`} pct={(metrics.ram / 4) * 100} color="text-(--ae-emerald)" />
      <Metric label="entropy" value={`${(metrics.entropy * 100).toFixed(0)}%`} pct={metrics.entropy * 100} color="text-(--ae-gold)" />
      <Metric label="coherence" value={`${(metrics.coherence * 100).toFixed(0)}%`} pct={metrics.coherence * 100} color="text-(--ae-amethyst)" />
      <span className="text-zinc-600">
        ♥ {mounted ? (heartbeat % 1000).toString().padStart(2, "0") : "--"}
      </span>
      <span className={cn(autonomyMode === "active" ? "text-(--ae-emerald)" : "text-zinc-500")}>
        autonomy {autonomyMode} · {autonomyLevel}
      </span>
      <span className="text-zinc-500">{aiState}</span>
      <span className="ml-auto text-zinc-600">
        {openCount} window{openCount === 1 ? "" : "s"} · desktop {activeDesktop}/4
      </span>
      <span className="text-zinc-500">{mounted ? new Date().toLocaleTimeString() : "--:--:--"}</span>
    </footer>
  );
}

export default StatusBar;
