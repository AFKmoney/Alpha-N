/**
 * stats-app.tsx — a live system-stats dashboard.
 *
 * Reports everything the browser is willing to expose about the host:
 * - CPU cores          (navigator.hardwareConcurrency)
 * - RAM estimate       (navigator.deviceMemory, in GiB — Chromium only)
 * - JS heap usage      (performance.memory — Chromium only)
 * - Network type       (navigator.connection.effectiveType / downlink / rtt)
 * - Screen resolution  (screen.width × screen.height, devicePixelRatio)
 * - Viewport size      (window.innerWidth × innerHeight, live)
 * - Battery level      (navigator.getBattery() — Chromium/Firefox only)
 * - FPS counter        (requestAnimationFrame loop, EMA-smoothed)
 * - Page uptime        (Date.now() − performance.timeOrigin)
 *
 * Auto-refreshes non-FPS stats every 2 seconds. FPS is updated each frame via
 * rAF and reported every ~500 ms to avoid UI churn. Bars/gauges animate with
 * framer-motion.
 *
 * Browser compatibility notes:
 * - `navigator.deviceMemory`, `performance.memory`, `navigator.getBattery()`,
 *   and `navigator.connection` are NOT available in Safari/Firefox in most
 *   cases. Each card gracefully degrades to "N/A" when the API is missing.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, MemoryStick, Wifi, Monitor, Battery, Gauge, Activity, Clock, HardDrive } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface StatsAppProps {
  windowId?: string;
}

interface BatteryInfo {
  level: number;      // 0..1
  charging: boolean;
  supported: boolean;
}

interface NetworkInfo {
  effectiveType: string;
  downlink: number;   // Mbps
  rtt: number;        // ms
  saveData: boolean;
  supported: boolean;
}

interface MemoryInfo {
  used: number;       // bytes
  total: number;      // bytes
  limit: number;      // bytes
  supported: boolean;
}

interface FpsInfo {
  fps: number;
  min: number;
  max: number;
}

/** Format a byte count into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format milliseconds as a human-readable uptime string. */
function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * StatsApp — a live dashboard of every host metric the browser will expose.
 */
export function StatsApp({ windowId: _windowId }: StatsAppProps = {}) {
  const [cpuCores, setCpuCores] = useState<number | null>(null);
  const [deviceMemory, setDeviceMemory] = useState<number | null>(null);
  const [memory, setMemory] = useState<MemoryInfo>({ used: 0, total: 0, limit: 0, supported: false });
  const [network, setNetwork] = useState<NetworkInfo>({
    effectiveType: "unknown", downlink: 0, rtt: 0, saveData: false, supported: false,
  });
  const [screen, setScreen] = useState({ w: 0, h: 0, dpr: 1 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [battery, setBattery] = useState<BatteryInfo>({ level: 0, charging: false, supported: false });
  const [fps, setFps] = useState<FpsInfo>({ fps: 0, min: Infinity, max: 0 });
  const [uptime, setUptime] = useState(0);

  const fpsRef = useRef({ frames: 0, lastTime: performance.now(), ema: 0, min: Infinity, max: 0 });
  const lastReportRef = useRef(performance.now());

  // Static-once stats (CPU cores, device memory, screen)
  useEffect(() => {
    setCpuCores(navigator.hardwareConcurrency ?? null);
    setDeviceMemory(
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
        ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory!
        : null
    );

    const updateScreen = () => {
      setScreen({
        w: window.screen.width,
        h: window.screen.height,
        dpr: window.devicePixelRatio || 1,
      });
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    updateScreen();
    window.addEventListener("resize", updateScreen);
    return () => window.removeEventListener("resize", updateScreen);
  }, []);

  // Battery API (Chromium/Firefox only)
  useEffect(() => {
    type BatteryManager = {
      level: number;
      charging: boolean;
      addEventListener: (e: string, cb: () => void) => void;
      removeEventListener: (e: string, cb: () => void) => void;
    };
    type NavigatorWithBattery = Navigator & {
      getBattery?: () => Promise<BatteryManager>;
    };
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) {
      setBattery({ level: 0, charging: false, supported: false });
      return;
    }
    let batteryObj: BatteryManager | null = null;
    let onUpdate: (() => void) | null = null;
    nav.getBattery().then((b) => {
      batteryObj = b;
      const sync = () => setBattery({ level: b.level, charging: b.charging, supported: true });
      sync();
      onUpdate = sync;
      b.addEventListener("levelchange", sync);
      b.addEventListener("chargingchange", sync);
    }).catch(() => {
      setBattery({ level: 0, charging: false, supported: false });
    });
    return () => {
      if (batteryObj && onUpdate) {
        batteryObj.removeEventListener("levelchange", onUpdate);
        batteryObj.removeEventListener("chargingchange", onUpdate);
      }
    };
  }, []);

  // Network Information API
  useEffect(() => {
    type EffectiveConnectionType = "slow-2g" | "2g" | "3g" | "4g";
    type NetworkInformation = EventTarget & {
      effectiveType?: EffectiveConnectionType;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
    const nav = navigator as Navigator & { connection?: NetworkInformation; mozConnection?: NetworkInformation; webkitConnection?: NetworkInformation };
    const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
    if (!conn) {
      setNetwork({ effectiveType: "n/a", downlink: 0, rtt: 0, saveData: false, supported: false });
      return;
    }
    const sync = () => {
      setNetwork({
        effectiveType: conn.effectiveType ?? "unknown",
        downlink: conn.downlink ?? 0,
        rtt: conn.rtt ?? 0,
        saveData: conn.saveData ?? false,
        supported: true,
      });
    };
    sync();
    conn.addEventListener("change", sync);
    return () => conn.removeEventListener("change", sync);
  }, []);

  // FPS counter via requestAnimationFrame (EMA-smoothed)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const delta = now - fpsRef.current.lastTime;
      fpsRef.current.lastTime = now;
      const instant = delta > 0 ? 1000 / delta : 0;
      // EMA smoothing
      fpsRef.current.ema = fpsRef.current.ema === 0 ? instant : fpsRef.current.ema * 0.9 + instant * 0.1;
      fpsRef.current.frames++;
      // track min/max (ignore first 30 frames for warm-up)
      if (fpsRef.current.frames > 30) {
        fpsRef.current.min = Math.min(fpsRef.current.min, fpsRef.current.ema);
        fpsRef.current.max = Math.max(fpsRef.current.max, fpsRef.current.ema);
      }
      // report every 500 ms
      if (now - lastReportRef.current >= 500) {
        lastReportRef.current = now;
        setFps({
          fps: Math.round(fpsRef.current.ema),
          min: fpsRef.current.min === Infinity ? 0 : Math.round(fpsRef.current.min),
          max: Math.round(fpsRef.current.max),
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Periodic refresh (every 2 s): memory + uptime
  useEffect(() => {
    const refresh = () => {
      // performance.memory (Chromium only)
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      };
      if (perf.memory) {
        setMemory({
          used: perf.memory.usedJSHeapSize,
          total: perf.memory.totalJSHeapSize,
          limit: perf.memory.jsHeapSizeLimit,
          supported: true,
        });
      } else {
        setMemory({ used: 0, total: 0, limit: 0, supported: false });
      }
      setUptime(Date.now() - performance.timeOrigin);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  // Derived display values
  const memUsagePct = memory.supported && memory.limit > 0
    ? Math.min(100, (memory.used / memory.limit) * 100)
    : 0;
  const batteryPct = battery.supported ? Math.round(battery.level * 100) : 0;
  const fpsColor = fps.fps >= 55 ? "oklch(0.7 0.18 145)" : fps.fps >= 30 ? "oklch(0.85 0.16 85)" : "oklch(0.7 0.2 15)";

  const cards = useMemo(() => [
    {
      icon: Cpu,
      label: "CPU Cores",
      value: cpuCores ? `${cpuCores}` : "N/A",
      sub: cpuCores ? `${cpuCores} logical processors` : "hardwareConcurrency unavailable",
      color: "oklch(0.82 0.17 195)",
    },
    {
      icon: MemoryStick,
      label: "Device RAM",
      value: deviceMemory ? `${deviceMemory} GB` : "N/A",
      sub: deviceMemory ? `approximate (deviceMemory)` : "Chromium-only API",
      color: "oklch(0.85 0.16 85)",
    },
    {
      icon: HardDrive,
      label: "JS Heap",
      value: memory.supported ? formatBytes(memory.used) : "N/A",
      sub: memory.supported ? `${formatBytes(memory.total)} / ${formatBytes(memory.limit)}` : "performance.memory (Chromium)",
      progress: memUsagePct,
      color: "oklch(0.74 0.22 300)",
    },
    {
      icon: Activity,
      label: "FPS",
      value: `${fps.fps}`,
      sub: `min ${fps.min} · max ${fps.max}`,
      progress: Math.min(100, (fps.fps / 120) * 100),
      color: fpsColor,
    },
    {
      icon: Wifi,
      label: "Network",
      value: network.supported ? network.effectiveType.toUpperCase() : "N/A",
      sub: network.supported
        ? `${network.downlink} Mbps · ${network.rtt} ms rtt${network.saveData ? " · save-data" : ""}`
        : "navigator.connection unavailable",
      color: "oklch(0.7 0.18 145)",
    },
    {
      icon: Battery,
      label: "Battery",
      value: battery.supported ? `${batteryPct}%` : "N/A",
      sub: battery.supported ? (battery.charging ? "charging" : "on battery") : "getBattery() unavailable",
      progress: batteryPct,
      color: battery.supported
        ? batteryPct < 20 ? "oklch(0.7 0.2 15)" : battery.charging ? "oklch(0.7 0.18 145)" : "oklch(0.82 0.17 195)"
        : "oklch(0.62 0.06 220)",
    },
    {
      icon: Monitor,
      label: "Screen",
      value: `${screen.w}×${screen.h}`,
      sub: `${screen.dpr}× device pixel ratio`,
      color: "oklch(0.85 0.14 55)",
    },
    {
      icon: Gauge,
      label: "Viewport",
      value: `${viewport.w}×${viewport.h}`,
      sub: `aspect ${(viewport.w / Math.max(viewport.h, 1)).toFixed(2)}`,
      color: "oklch(0.74 0.22 300)",
    },
    {
      icon: Clock,
      label: "Uptime",
      value: formatUptime(uptime),
      sub: "since page load",
      color: "oklch(0.82 0.17 195)",
    },
  ], [cpuCores, deviceMemory, memory, memUsagePct, fps, fpsColor, network, battery, batteryPct, screen, viewport, uptime]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
          <h3 className="font-mono-ae text-sm font-semibold">System Monitor</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-[oklch(0.7_0.18_145)]"
          />
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
            live · 2s refresh
          </span>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="rounded-lg border border-border/50 bg-card/30 p-3.5"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" style={{ color: card.color }} />
                    <span className="font-mono-ae text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                      {card.label}
                    </span>
                  </div>
                </div>
                <div
                  className="font-mono-ae text-2xl font-semibold tabular-nums"
                  style={{ color: card.color }}
                >
                  {card.value}
                </div>
                <div className="font-mono-ae mt-0.5 text-[0.6rem] text-muted-foreground/70">
                  {card.sub}
                </div>
                {typeof card.progress === "number" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card/60">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: card.color }}
                      animate={{ width: `${card.progress}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Footnote on browser-API availability */}
        <div className="px-4 pb-4">
          <p className="font-mono-ae text-[0.55rem] leading-relaxed text-muted-foreground/60">
            Note: deviceMemory, performance.memory, getBattery(), and connection APIs
            are Chromium-specific and unavailable in Safari/Firefox. Cards fall back to
            "N/A" where the API is missing.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}

export default StatsApp;
