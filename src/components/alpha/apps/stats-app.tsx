/**
 * stats-app.tsx — Alpha-OS System Statistics Dashboard.
 *
 * Purpose: 9 live cards — CPU cores (hardwareConcurrency), device RAM
 * (deviceMemory), JS heap (performance.memory), live FPS (rAF + EMA smoothing
 * with min/max), network (connection API), battery (getBattery with live
 * listeners), screen (size + DPR), viewport (live resize) and uptime
 * (performance.timeOrigin). Progress bars animate with framer-motion; memory
 * and uptime refresh every 2 s.
 *
 * Browser-API compatibility: deviceMemory and performance.memory are
 * Chromium-only, connection is Chromium-only, getBattery is Chromium/Firefox —
 * every card degrades to "N/A" with a short explanatory subtext instead of
 * erroring. localStorage is not required.
 */
"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Cpu, MemoryStick, Database, Gauge, Wifi, BatteryCharging, Battery, Monitor, AppWindow, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ==================================== TYPES ==================================

interface NetworkInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

interface HeapInfo {
  used: number;
  total: number;
  limit: number;
}

interface BatteryInfo {
  level: number;
  charging: boolean;
}

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  getBattery?: () => Promise<BatteryLike>;
  connection?: NetworkInfo;
};

type PerformanceWithMemory = Performance & {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
};

// =================================== ACCENTS =================================

type Accent = "cyan" | "amethyst" | "gold" | "emerald" | "rose";

const ACCENTS: Record<Accent, { text: string; border: string; chip: string; bar: string }> = {
  cyan: {
    text: "text-(--ae-cyan)",
    border: "border-(--ae-cyan)/25",
    chip: "bg-(--ae-cyan)/10",
    bar: "bg-(--ae-cyan)",
  },
  amethyst: {
    text: "text-(--ae-amethyst)",
    border: "border-(--ae-amethyst)/25",
    chip: "bg-(--ae-amethyst)/10",
    bar: "bg-(--ae-amethyst)",
  },
  gold: {
    text: "text-(--ae-gold)",
    border: "border-(--ae-gold)/25",
    chip: "bg-(--ae-gold)/10",
    bar: "bg-(--ae-gold)",
  },
  emerald: {
    text: "text-(--ae-emerald)",
    border: "border-(--ae-emerald)/25",
    chip: "bg-(--ae-emerald)/10",
    bar: "bg-(--ae-emerald)",
  },
  rose: {
    text: "text-(--ae-rose)",
    border: "border-(--ae-rose)/25",
    chip: "bg-(--ae-rose)/10",
    bar: "bg-(--ae-rose)",
  },
};

// ================================== HELPERS ==================================

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Presentational stat card (module-level component — stable identity). */
function StatCard({
  icon: Icon,
  label,
  accent,
  value,
  subtext,
  progress,
  live,
}: {
  icon: typeof Cpu;
  label: string;
  accent: Accent;
  value: string;
  subtext: string;
  progress?: number | null;
  live?: boolean;
}) {
  const a = ACCENTS[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("glass flex flex-col rounded-xl p-2.5", a.border)}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className={cn("rounded-md p-1", a.chip)}>
          <Icon className={cn("h-3.5 w-3.5", a.text)} />
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn("font-mono-ae text-xl font-semibold leading-none", a.text)}>{value}</span>
        {live && <span className="neural-dot" style={{ marginBottom: 2 }} />}
      </div>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className={cn("h-full rounded-full", a.bar)}
            initial={false}
            animate={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 22 }}
          />
        </div>
      )}
      <p className="mt-1.5 text-[9px] leading-snug text-zinc-500">{subtext}</p>
    </motion.div>
  );
}

// ================================== THE APP ==================================

export function StatsApp({ windowId: _windowId }: { windowId?: string }) {
  const [cores, setCores] = useState<number | null>(null);
  const [deviceRam, setDeviceRam] = useState<number | null>(null);
  const [heap, setHeap] = useState<HeapInfo | null>(null);
  const [fps, setFps] = useState<{ current: number; min: number; max: number } | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [screenInfo, setScreenInfo] = useState<{ w: number; h: number; dpr: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [uptime, setUptime] = useState<number | null>(null);

  // One deferred mount probe for static capabilities (no sync setState here).
  useEffect(() => {
    Promise.resolve().then(() => {
      const nav = navigator as NavigatorExtras;
      setCores(typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null);
      setDeviceRam(typeof nav.deviceMemory === "number" ? nav.deviceMemory : null);

      const mem = (performance as PerformanceWithMemory).memory;
      if (mem) setHeap({ used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit });

      if (nav.connection) setNetwork(nav.connection);

      setScreenInfo({ w: window.screen.width, h: window.screen.height, dpr: window.devicePixelRatio || 1 });
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setUptime(performance.timeOrigin ? Date.now() - performance.timeOrigin : null);
    });
  }, []);

  // Battery with live listeners (Chromium/Firefox only).
  useEffect(() => {
    let battery: BatteryLike | null = null;
    const update = () => {
      if (battery) setBattery({ level: battery.level, charging: battery.charging });
    };
    Promise.resolve().then(() => {
      const nav = navigator as NavigatorExtras;
      if (typeof nav.getBattery !== "function") return;
      nav
        .getBattery()
        .then((b) => {
          battery = b;
          update();
          b.addEventListener("levelchange", update);
          b.addEventListener("chargingchange", update);
        })
        .catch(() => undefined);
    });
    return () => {
      if (battery) {
        battery.removeEventListener("levelchange", update);
        battery.removeEventListener("chargingchange", update);
      }
    };
  }, []);

  // Live FPS via rAF + EMA smoothing (state pushed ~2x per second).
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let ema = 60;
    let min = 60;
    let max = 60;
    let acc = 0;
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      if (dt > 0 && dt < 1000) {
        const inst = 1000 / dt;
        ema = ema * 0.9 + inst * 0.1;
        min = Math.min(min, ema);
        max = Math.max(max, ema);
      }
      acc += dt;
      if (acc >= 500) {
        acc = 0;
        setFps({ current: ema, min, max });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 2 s auto-refresh for heap + uptime.
  useEffect(() => {
    const t = window.setInterval(() => {
      const mem = (performance as PerformanceWithMemory).memory;
      if (mem) setHeap({ used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit });
      setUptime(performance.timeOrigin ? Date.now() - performance.timeOrigin : null);
    }, 2000);
    return () => window.clearInterval(t);
  }, []);

  // Live viewport on resize.
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const heapPct = heap && heap.limit > 0 ? (heap.used / heap.limit) * 100 : null;

  return (
    <div className="scroll-ae h-full overflow-y-auto bg-(--ae-obsidian-deep) p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">System Statistics</span>
        <span className="flex items-center gap-1.5 font-mono-ae text-[10px] text-zinc-500">
          <span className="neural-dot" /> live · 2 s refresh
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <StatCard
          icon={Cpu}
          label="CPU cores"
          accent="cyan"
          value={cores !== null ? String(cores) : "N/A"}
          subtext={cores !== null ? "logical processors · hardwareConcurrency" : "hardwareConcurrency unavailable in this browser"}
        />
        <StatCard
          icon={MemoryStick}
          label="Device RAM"
          accent="amethyst"
          value={deviceRam !== null ? `${deviceRam} GB` : "N/A"}
          progress={deviceRam !== null ? (deviceRam / 8) * 100 : null}
          subtext={deviceRam !== null ? "approximate · rounded to powers of 2" : "navigator.deviceMemory is Chromium-only"}
        />
        <StatCard
          icon={Database}
          label="JS heap"
          accent="gold"
          value={heap ? formatMB(heap.used) : "N/A"}
          progress={heapPct}
          subtext={
            heap
              ? `allocated ${formatMB(heap.total)} · limit ${formatMB(heap.limit)}`
              : "performance.memory is Chromium-only"
          }
          live
        />
        <StatCard
          icon={Gauge}
          label="Live FPS"
          accent="emerald"
          value={fps ? fps.current.toFixed(0) : "…"}
          progress={fps ? (fps.current / 144) * 100 : null}
          subtext={fps ? `min ${fps.min.toFixed(0)} · max ${fps.max.toFixed(0)} · EMA smoothed` : "sampling frame rate"}
          live
        />
        <StatCard
          icon={Wifi}
          label="Network"
          accent="cyan"
          value={network?.effectiveType ?? "N/A"}
          subtext={
            network
              ? `${network.downlink?.toFixed(1) ?? "?"} Mb/s down · ${network.rtt ?? "?"} ms rtt`
              : "navigator.connection is Chromium-only"
          }
        />
        <StatCard
          icon={battery?.charging ? BatteryCharging : Battery}
          label="Battery"
          accent={battery ? (battery.charging ? "emerald" : "gold") : "rose"}
          value={battery ? `${Math.round(battery.level * 100)}%` : "N/A"}
          progress={battery ? battery.level * 100 : null}
          subtext={
            battery
              ? battery.charging
                ? "charging · live level listeners"
                : "discharging · live level listeners"
              : "getBattery is Chromium/Firefox only"
          }
        />
        <StatCard
          icon={Monitor}
          label="Screen"
          accent="amethyst"
          value={screenInfo ? `${screenInfo.w}×${screenInfo.h}` : "…"}
          subtext={screenInfo ? `devicePixelRatio ${screenInfo.dpr.toFixed(2)}` : "reading display metrics"}
        />
        <StatCard
          icon={AppWindow}
          label="Viewport"
          accent="cyan"
          value={viewport ? `${viewport.w}×${viewport.h}` : "…"}
          subtext={viewport ? "updates live on resize" : "reading window size"}
          live
        />
        <StatCard
          icon={Timer}
          label="Uptime"
          accent="gold"
          value={uptime !== null ? formatUptime(uptime) : "…"}
          subtext={uptime !== null ? "since page load · performance.timeOrigin" : "timeOrigin unavailable"}
          live
        />
      </div>
    </div>
  );
}

export default StatsApp;
