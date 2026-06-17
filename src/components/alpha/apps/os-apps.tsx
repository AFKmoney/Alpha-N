"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Globe, Lock, RotateCw, Shield, ShieldAlert } from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { AgentPanel } from "../agent-panel";
import { EvolutionLog } from "../evolution-log";
import { EvolutionTree } from "../evolution-tree";
import { CodeEditor } from "../code-editor";
import { cn } from "@/lib/utils";

// ============ BROWSER APP ============
export function BrowserApp({ windowId }: { windowId: string }) {
  const { windows, setWindowData } = useOS();
  const win = windows.find((w) => w.id === windowId);
  const [input, setInput] = useState((win?.data?.url as string) ?? "https://example.com");

  const currentUrl = (win?.data?.url as string) ?? "https://example.com";
  const navigate = (url: string) => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    setWindowData(windowId, { url: u });
    setInput(u);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/50 p-2">
        <button className="rounded p-1 text-muted-foreground hover:bg-foreground/10" aria-label="Back">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-foreground/10" aria-label="Forward">
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setWindowData(windowId, { url: currentUrl })} className="rounded p-1 text-muted-foreground hover:bg-foreground/10" aria-label="Reload">
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <form
          onSubmit={(e) => { e.preventDefault(); navigate(input); }}
          className="flex flex-1 items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1"
        >
          <Globe className="h-3 w-3 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
            placeholder="Enter URL…"
          />
        </form>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe
          key={currentUrl}
          src={currentUrl}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="browser"
        />
      </div>
    </div>
  );
}

// ============ FILES APP ============
const DEMO_FILES = [
  { name: "core/", type: "dir", children: ["nucleus.ts", "perception.ts", "forge.ts", "akashic.ts"] },
  { name: "kernel/", type: "dir", locked: true, children: ["boot.ts", "security.ts", "rollback.ts", "sandbox.ts"] },
  { name: "agents/", type: "dir", children: ["architect.ts", "developer.ts", "critic.ts", "optimizer.ts"] },
  { name: "plugins/", type: "dir", children: ["python-df/", "zig/", "rust/"] },
  { name: "EVOLUTION.md", type: "file" },
  { name: "package.json", type: "file" },
];

export function FilesApp() {
  const [expanded, setExpanded] = useState<string | null>("core/");
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/50 px-3 py-1.5 font-mono-ae text-xs text-muted-foreground">
        /home/z/my-project
      </div>
      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-2 font-mono-ae text-xs">
        {DEMO_FILES.map((f) => (
          <div key={f.name}>
            <button
              onClick={() => f.type === "dir" && setExpanded(expanded === f.name ? null : f.name)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-foreground/[0.06]",
                f.locked && "text-[oklch(0.85_0.16_85)]"
              )}
            >
              <span>{f.type === "dir" ? (expanded === f.name ? "▾" : "▸") : "·"}</span>
              <span className={f.type === "dir" ? "text-[oklch(0.82_0.17_195)]" : "text-foreground/80"}>{f.name}</span>
              {f.locked && <Lock className="ml-auto h-2.5 w-2.5 text-[oklch(0.85_0.16_85)]" />}
            </button>
            {expanded === f.name && f.children && (
              <div className="ml-4 border-l border-border/30 pl-2">
                {f.children.map((c) => (
                  <div key={c} className="flex items-center gap-1.5 rounded px-2 py-0.5 text-muted-foreground hover:bg-foreground/[0.04]">
                    <span>·</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ MONITOR APP ============
export function MonitorApp() {
  const { metrics, agents, generation, version, heartbeat } = useEvolution();
  const { violationAttempts, snapshots, rollbackEvents } = useOS();

  return (
    <div className="scroll-ae h-full overflow-y-auto bg-background p-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="CPU" value={`${metrics.cpu.toFixed(0)}%`} pct={metrics.cpu / 100} color="oklch(0.82 0.17 195)" />
        <MetricCard label="RAM" value={`${metrics.ram.toFixed(2)}GB`} pct={metrics.ram / 4} color="oklch(0.74 0.22 300)" />
        <MetricCard label="Entropy" value={metrics.entropy.toFixed(2)} pct={metrics.entropy} color="oklch(0.85 0.16 85)" />
        <MetricCard label="Coherence" value={`${(metrics.coherence * 100).toFixed(0)}%`} pct={metrics.coherence} color="oklch(0.7 0.18 145)" />
      </div>

      <div className="mt-3 rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="eyebrow mb-1.5">council load</div>
        <div className="space-y-1.5">
          {agents.map((a) => (
            <div key={a.role} className="flex items-center gap-2">
              <span className="w-16 font-mono-ae text-[0.65rem] text-muted-foreground">{a.role}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: a.hue === "cyan" ? "oklch(0.82 0.17 195)" : a.hue === "amethyst" ? "oklch(0.74 0.22 300)" : a.hue === "gold" ? "oklch(0.85 0.16 85)" : "oklch(0.7 0.22 15)" }}
                  animate={{ width: `${a.load * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono-ae text-[0.6rem] text-muted-foreground">{(a.load * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
          <div className="eyebrow">generation</div>
          <div className="mt-0.5 font-mono-ae text-lg font-semibold text-[oklch(0.82_0.17_195)]">{generation}</div>
          <div className="font-mono-ae text-[0.6rem] text-muted-foreground">v{version}</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
          <div className="eyebrow">heartbeat</div>
          <div className="mt-0.5 font-mono-ae text-lg font-semibold text-[oklch(0.7_0.18_145)]">{heartbeat}</div>
          <div className="font-mono-ae text-[0.6rem] text-muted-foreground">beats/s</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="eyebrow mb-1.5">snapshots ({snapshots.length})</div>
        <div className="space-y-1 max-h-24 overflow-y-auto scroll-ae">
          {snapshots.length === 0 ? (
            <p className="font-mono-ae text-[0.6rem] text-muted-foreground/60">No snapshots yet.</p>
          ) : (
            snapshots.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between font-mono-ae text-[0.62rem]">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-muted-foreground/50">{new Date(s.time).toLocaleTimeString("en-US", { hour12: false })}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {rollbackEvents.length > 0 && (
        <div className="mt-2 rounded-lg border border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.06] p-2.5">
          <div className="eyebrow mb-1.5 text-[oklch(0.78_0.2_20)]">rollbacks ({rollbackEvents.length})</div>
          {rollbackEvents.slice(0, 4).map((r) => (
            <div key={r.id} className="font-mono-ae text-[0.62rem] text-[oklch(0.78_0.2_20)]/80">
              ↺ {r.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 font-mono-ae text-sm font-semibold">{value}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10">
        <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${Math.max(2, Math.min(100, pct * 100))}%` }} />
      </div>
    </div>
  );
}

// ============ SECURITY FOUNDATION APP ============
export function SecurityApp() {
  const { protectedFiles, violationAttempts } = useOS();
  return (
    <div className="scroll-ae flex h-full flex-col overflow-y-auto bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
        <h3 className="font-mono-ae text-sm font-semibold">Security Foundation</h3>
      </div>
      <p className="mb-2 font-mono-ae text-[0.65rem] leading-snug text-muted-foreground">
        The kernel the AI may never rewrite. These files are sovereign — N-Core can mutate everything else, but touching these triggers an automatic block.
      </p>
      <div className="space-y-1.5">
        {protectedFiles.map((f) => (
          <div key={f.path} className={cn("rounded-lg border p-2", f.critical ? "border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.05]" : "border-border/40 bg-card/30")}>
            <div className="flex items-center gap-1.5">
              <Lock className={cn("h-3 w-3", f.critical ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.85_0.16_85)]")} />
              <span className="font-mono-ae text-xs text-foreground/90">{f.path}</span>
              {f.critical && (
                <span className="ml-auto rounded-full border border-[oklch(0.65_0.24_25)]/40 px-1.5 py-0 font-mono-ae text-[0.5rem] text-[oklch(0.78_0.2_20)]">
                  CRITICAL
                </span>
              )}
            </div>
            <p className="mt-1 text-[0.65rem] leading-snug text-muted-foreground">{f.reason}</p>
            <p className="mt-0.5 font-mono-ae text-[0.55rem] text-muted-foreground/60">guardian: {f.guardian}</p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-[oklch(0.78_0.2_20)]" />
          <span className="eyebrow text-[oklch(0.78_0.2_20)]">violation log</span>
        </div>
        {violationAttempts.length === 0 ? (
          <p className="font-mono-ae text-[0.62rem] text-muted-foreground/60">No violations. The AI has respected the kernel.</p>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto scroll-ae">
            {violationAttempts.slice(0, 10).map((v, i) => (
              <div key={i} className="rounded border border-[oklch(0.65_0.24_25)]/20 bg-[oklch(0.65_0.24_25)]/[0.04] px-2 py-1 font-mono-ae text-[0.6rem] text-[oklch(0.78_0.2_20)]/80">
                ⛔ {v.path}: {v.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ CUSTOM APP (AI-spawned) ============
export function CustomApp({ windowId }: { windowId: string }) {
  const { windows } = useOS();
  const win = windows.find((w) => w.id === windowId);
  const spec = (win?.data?.spec as string) ?? "A custom app spawned by N-Core.";
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6 text-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        className="mb-3 text-3xl text-[oklch(0.82_0.17_195)]"
      >
        ❖
      </motion.div>
      <p className="font-mono-ae text-xs text-foreground/80">{win?.title}</p>
      <p className="mt-2 max-w-xs text-[0.7rem] leading-snug text-muted-foreground">{spec}</p>
      <p className="mt-3 font-mono-ae text-[0.55rem] text-muted-foreground/50">spawned by N-Core</p>
    </div>
  );
}
