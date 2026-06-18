/**
 * os-store.ts — Zustand store for the Alpha-OS window manager.
 * Tracks windows, layout (tile/float), virtual desktops, snapshots,
 * rollback events, security violations, and the terminal command queue.
 * The AI rewrites everything EXCEPT the kernel — this store is sovereign.
 */
"use client";

import { create } from "zustand";
import {
  DOCK_APPS,
  WORKSPACE_TOP,
  WORKSPACE_BOTTOM_MARGIN,
  MIN_WINDOW_W,
  MIN_WINDOW_H,
  clampRect,
  defaultSplits,
  type AppKind,
  type AppWindow,
  type LayoutMode,
  type ProtectedFile,
  type Viewport,
  type Rect,
  type SnapState,
  SECURITY_FOUNDATION,
} from "./os-types";
import type { CodeLine, Agent, MetricDelta } from "./evolution-data";

export interface OSSnapshot {
  id: string;
  time: number;
  windows: AppWindow[];
  codeLines: CodeLine[];
  agents: Agent[];
  metrics: { cpu: number; ram: number; entropy: number; coherence: number };
  version: string;
  generation: number;
  label: string;
}

export interface RollbackEvent {
  id: string;
  time: number;
  reason: string;
  snapshotLabel: string;
}

interface OSStore {
  // windows
  windows: AppWindow[];
  zTop: number;
  activeWindowId: string | null;

  // layout: tile (no overlap, resize affects neighbors) vs float (overlap)
  layoutMode: LayoutMode;
  activeDesktop: number;
  viewport: Viewport;
  splitRatios: Record<number, number[]>; // per-desktop split ratios keyed by desktop

  // security
  protectedFiles: ProtectedFile[];
  violationAttempts: { time: number; path: string; reason: string }[];

  // snapshots & rollback
  snapshots: OSSnapshot[];
  rollbackEvents: RollbackEvent[];

  // terminal command queue (AI can queue commands)
  terminalCommands: { id: string; command: string; time: number }[];

  // ---- SA3-WINDOW-OS extensions ----
  /** Active UI theme ("dark" by default; "light" injects overrides via dock). */
  theme: "dark" | "light";
  /**
   * Live snap-preview rect shown during window drag-near-edge.
   * Null when no snap zone is currently hovered. Set by window-frame.
   */
  snapPreview: Rect | null;

  // actions
  openApp: (kind: AppKind, opts?: Partial<AppWindow>) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  setWindowData: (id: string, data: Record<string, unknown>) => void;

  // layout actions
  setLayoutMode: (mode: LayoutMode) => void;
  setActiveDesktop: (d: number) => void;
  setSplitRatio: (desktop: number, handleIndex: number, ratio: number) => void;
  setViewport: (vp: Viewport) => void;
  reflowWindows: () => void; // re-clamp all windows into the viewport
  moveWindowToDesktop: (id: string, desktop: number) => void;

  takeSnapshot: (label: string, state: Omit<OSSnapshot, "id" | "time" | "label" | "windows"> & { windows?: AppWindow[] }) => OSSnapshot;
  rollback: (snapshot: OSSnapshot, reason: string) => Omit<OSSnapshot, "id" | "time" | "windows"> & { windows: AppWindow[] };
  recordViolation: (path: string, reason: string) => void;
  queueTerminalCommand: (command: string) => void;
  clearTerminalCommand: (id: string) => void;

  // ---- SA3-WINDOW-OS: new actions ----
  /** Toggle between dark and light theme. */
  toggleTheme: () => void;
  /** Set theme explicitly. */
  setTheme: (theme: "dark" | "light") => void;
  /** Update the snap-preview rect during a drag (null clears it). */
  setSnapPreview: (rect: Rect | null) => void;
  /**
   * Snap a window to one of the five dock-edge zones (left/right/top/bl/br).
   * Stores prevRect so the window can be restored later. Float mode only.
   */
  snapWindow: (id: string, snap: SnapState) => void;
  /** Set per-window opacity (clamped 0.3..1.0). */
  setWindowOpacity: (id: string, opacity: number) => void;
  /** Minimize every window on the active desktop ("show desktop"). */
  minimizeAll: () => void;
}

let winId = 0;
let snapId = 0;
let rbId = 0;
let tcId = 0;
let violId = 0;

function defaultRect(kind: AppKind, index: number): { x: number; y: number; w: number; h: number } {
  const base: Record<AppKind, { w: number; h: number }> = {
    terminal: { w: 520, h: 360 },
    editor: { w: 600, h: 460 },
    files: { w: 480, h: 380 },
    browser: { w: 720, h: 480 },
    monitor: { w: 420, h: 360 },
    evolution: { w: 400, h: 420 },
    agents: { w: 320, h: 460 },
    security: { w: 460, h: 380 },
    options: { w: 420, h: 400 },
    vault: { w: 420, h: 460 },
    realcode: { w: 720, h: 500 },
    memory: { w: 680, h: 500 },
    repository: { w: 560, h: 460 },
    wallpaper: { w: 600, h: 500 },
    custom: { w: 560, h: 400 },
    // ---- SA3-WINDOW-OS: new app default sizes ----
    calculator: { w: 360, h: 480 },
    notes: { w: 640, h: 480 },
    clipboard: { w: 460, h: 420 },
    ambient: { w: 520, h: 460 },
    stats: { w: 560, h: 460 },
    clock: { w: 560, h: 460 },
    weather: { w: 480, h: 540 },
    music: { w: 520, h: 480 },
  };
  const r = base[kind];
  // cascade position
  const offset = (index % 6) * 32;
  return {
    x: 80 + offset,
    y: 70 + offset,
    w: r.w,
    h: r.h,
  };
}

/**
 * Compute the target rect for a snap zone, given the workspace viewport.
 * Used by both snapWindow (apply) and window-frame (preview).
 */
export function snapRect(snap: SnapState, vp: Viewport): Rect {
  switch (snap) {
    case "left":
      return { x: vp.x, y: vp.y, w: Math.floor(vp.w / 2), h: vp.h };
    case "right":
      return { x: vp.x + Math.ceil(vp.w / 2), y: vp.y, w: Math.floor(vp.w / 2), h: vp.h };
    case "top":
      // "top" snap = maximize
      return { x: vp.x, y: vp.y, w: vp.w, h: vp.h };
    case "bl":
      return { x: vp.x, y: vp.y + Math.ceil(vp.h / 2), w: Math.floor(vp.w / 2), h: Math.floor(vp.h / 2) };
    case "br":
      return { x: vp.x + Math.ceil(vp.w / 2), y: vp.y + Math.ceil(vp.h / 2), w: Math.floor(vp.w / 2), h: Math.floor(vp.h / 2) };
    case "none":
    default:
      return { x: vp.x, y: vp.y, w: vp.w, h: vp.h };
  }
}

export const useOS = create<OSStore>((set, get) => ({
  windows: [],
  zTop: 10,
  activeWindowId: null,

  layoutMode: "float",
  activeDesktop: 0,
  viewport: { x: 0, y: WORKSPACE_TOP, w: 1280, h: 600 },
  splitRatios: {},

  protectedFiles: SECURITY_FOUNDATION,
  violationAttempts: [],

  snapshots: [],
  rollbackEvents: [],

  terminalCommands: [],

  // ---- SA3-WINDOW-OS: default state ----
  theme: "dark",
  snapPreview: null,

  openApp: (kind, opts) => {
    // PREVENT DUPLICATE APPS: if an app of this kind is already open on the
    // active desktop, focus it instead of opening a second instance.
    const activeDesktop = get().activeDesktop;
    const existing = get().windows.find(
      (w) => w.kind === kind && w.desktop === activeDesktop
    );
    if (existing) {
      get().focusWindow(existing.id);
      // update data if provided (e.g. browser URL change)
      if (opts?.data) {
        get().setWindowData(existing.id, opts.data);
      }
      if (opts?.title) {
        set((s) => ({
          windows: s.windows.map((w) =>
            w.id === existing.id ? { ...w, title: opts.title! } : w
          ),
        }));
      }
      return existing.id;
    }

    const id = `win-${winId++}`;
    const dockApp = DOCK_APPS.find((d) => d.kind === kind);
    const rect = defaultRect(kind, get().windows.length);
    const vp = get().viewport;
    const desktop = opts?.desktop ?? activeDesktop;
    // clamp the initial rect into the viewport so nothing spawns out of bounds
    const clamped = clampRect(
      {
        x: opts?.x ?? rect.x,
        y: opts?.y ?? rect.y,
        w: opts?.w ?? rect.w,
        h: opts?.h ?? rect.h,
      },
      vp
    );
    const z = get().zTop + 1;
    const win: AppWindow = {
      id,
      kind,
      title: opts?.title ?? dockApp?.defaultTitle ?? kind,
      icon: opts?.icon ?? dockApp?.icon ?? "▢",
      x: clamped.x,
      y: clamped.y,
      w: clamped.w,
      h: clamped.h,
      z,
      minimized: false,
      maximized: false,
      desktop,
      data: opts?.data,
      // SA3-WINDOW-OS: default opacity + snap state
      opacity: opts?.opacity ?? 1,
      snapState: "none",
    };
    // when opening in tile mode, reset splits for that desktop to even
    const newWindows = [...get().windows, win];
    const onDesktop = newWindows.filter((w) => w.desktop === desktop && !w.minimized);
    let newSplits = get().splitRatios;
    if (get().layoutMode === "tile") {
      newSplits = { ...newSplits, [desktop]: defaultSplits(onDesktop.length) };
    }
    set((s) => ({
      windows: newWindows,
      zTop: z,
      activeWindowId: id,
      splitRatios: newSplits,
    }));
    return id;
  },

  closeWindow: (id) => {
    const closed = get().windows.find((w) => w.id === id);
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
      activeWindowId: s.activeWindowId === id ? null : s.activeWindowId,
    }));
    // reflow splits for that desktop if in tile mode
    if (closed && get().layoutMode === "tile") {
      const onDesktop = get().windows.filter((w) => w.desktop === closed.desktop && !w.minimized);
      set((s) => ({
        splitRatios: { ...s.splitRatios, [closed.desktop]: defaultSplits(onDesktop.length) },
      }));
    }
  },

  focusWindow: (id) => {
    const z = get().zTop + 1;
    set((s) => ({
      zTop: z,
      activeWindowId: id,
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, z, minimized: false } : w
      ),
    }));
  },

  minimizeWindow: (id) => {
    const win = get().windows.find((w) => w.id === id);
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      ),
      activeWindowId: s.activeWindowId === id ? null : s.activeWindowId,
    }));
    // reflow splits if tiled
    if (win && get().layoutMode === "tile") {
      const onDesktop = get().windows.filter((w) => w.desktop === win.desktop && !w.minimized && w.id !== id);
      set((s) => ({
        splitRatios: { ...s.splitRatios, [win.desktop]: defaultSplits(onDesktop.length) },
      }));
    }
  },

  toggleMaximize: (id) => {
    const vp = get().viewport;
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.prevRect) {
          // restore, clamped to viewport
          const r = clampRect(w.prevRect, vp);
          return { ...w, maximized: false, ...r, prevRect: undefined };
        }
        // maximize fills the whole workspace viewport
        return {
          ...w,
          maximized: true,
          prevRect: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: vp.x,
          y: vp.y,
          w: vp.w,
          h: vp.h,
        };
      }),
    }));
  },

  moveWindow: (id, x, y) => {
    // In tile mode, free movement is disabled (windows are tiled).
    if (get().layoutMode === "tile") return;
    const vp = get().viewport;
    const win = get().windows.find((w) => w.id === id);
    if (!win) return;
    const clamped = clampRect({ x, y, w: win.w, h: win.h }, vp);
    set((s) => ({
      windows: s.windows.map((w) =>
        // Clear snapState when the user starts dragging a snapped window free.
        w.id === id ? { ...w, x: clamped.x, y: clamped.y, snapState: "none" } : w
      ),
    }));
  },

  resizeWindow: (id, w, h) => {
    if (get().layoutMode === "tile") return; // tiled windows resize via split handles
    const vp = get().viewport;
    const win = get().windows.find((w2) => w2.id === id);
    if (!win) return;
    const clamped = clampRect({ x: win.x, y: win.y, w, h }, vp);
    set((s) => ({
      windows: s.windows.map((win2) =>
        win2.id === id ? { ...win2, w: clamped.w, h: clamped.h } : win2
      ),
    }));
  },

  setWindowData: (id, data) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, data: { ...w.data, ...data } } : w
      ),
    })),

  // ---------------- layout actions ----------------
  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    // when entering tile mode, compute even splits for each desktop
    if (mode === "tile") {
      const wins = get().windows;
      const splits: Record<number, number[]> = {};
      for (let d = 0; d < 4; d++) {
        const count = wins.filter((w) => w.desktop === d && !w.minimized).length;
        if (count > 1) splits[d] = defaultSplits(count);
      }
      set({ splitRatios: splits });
    }
  },

  setActiveDesktop: (d) => set({ activeDesktop: d }),

  setSplitRatio: (desktop, handleIndex, ratio) => {
    const wins = get().windows.filter((w) => w.desktop === desktop && !w.minimized);
    const count = wins.length;
    const cur = get().splitRatios[desktop] ?? defaultSplits(count);
    const next = [...cur];
    // clamp the new ratio between its neighbors
    const lower = handleIndex === 0 ? 0.05 : (next[handleIndex - 1] ?? 0) + 0.05;
    const upper = handleIndex === next.length - 1 ? 0.95 : (next[handleIndex + 1] ?? 1) - 0.05;
    next[handleIndex] = Math.max(lower, Math.min(upper, ratio));
    set((s) => ({ splitRatios: { ...s.splitRatios, [desktop]: next } }));
  },

  setViewport: (vp) => {
    set({ viewport: vp });
    // re-clamp every floating window into the new viewport
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.maximized) {
          return { ...w, x: vp.x, y: vp.y, w: vp.w, h: vp.h };
        }
        const r = clampRect({ x: w.x, y: w.y, w: w.w, h: w.h }, vp);
        return { ...w, ...r };
      }),
    }));
  },

  reflowWindows: () => {
    const vp = get().viewport;
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.maximized) return { ...w, x: vp.x, y: vp.y, w: vp.w, h: vp.h };
        const r = clampRect({ x: w.x, y: w.y, w: w.w, h: w.h }, vp);
        return { ...w, ...r };
      }),
    }));
  },

  moveWindowToDesktop: (id, desktop) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, desktop } : w
      ),
    })),

  takeSnapshot: (label, state) => {
    const snap: OSSnapshot = {
      id: `snap-${snapId++}`,
      time: Date.now(),
      label,
      windows: state.windows ?? get().windows,
      codeLines: state.codeLines,
      agents: state.agents,
      metrics: state.metrics,
      version: state.version,
      generation: state.generation,
    };
    set((s) => ({ snapshots: [snap, ...s.snapshots].slice(0, 12) }));
    return snap;
  },

  rollback: (snapshot, reason) => {
    const ev: RollbackEvent = {
      id: `rb-${rbId++}`,
      time: Date.now(),
      reason,
      snapshotLabel: snapshot.label,
    };
    set((s) => ({ rollbackEvents: [ev, ...s.rollbackEvents].slice(0, 20) }));
    return {
      windows: snapshot.windows,
      codeLines: snapshot.codeLines,
      agents: snapshot.agents,
      metrics: snapshot.metrics,
      version: snapshot.version,
      generation: snapshot.generation,
    };
  },

  recordViolation: (path, reason) => {
    const v = { time: Date.now(), path, reason, id: `viol-${violId++}` };
    set((s) => ({ violationAttempts: [v, ...s.violationAttempts].slice(0, 30) }));
  },

  queueTerminalCommand: (command) => {
    const c = { id: `tc-${tcId++}`, command, time: Date.now() };
    set((s) => ({ terminalCommands: [...s.terminalCommands, c] }));
  },

  clearTerminalCommand: (id) =>
    set((s) => ({ terminalCommands: s.terminalCommands.filter((c) => c.id !== id) })),

  // ---------------- SA3-WINDOW-OS: new actions ----------------

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
  },

  setTheme: (theme) => set({ theme }),

  setSnapPreview: (rect) => set({ snapPreview: rect }),

  snapWindow: (id, snap) => {
    // Snapping only applies in float mode (tile mode owns window geometry).
    if (get().layoutMode === "tile") return;
    if (snap === "none") return;
    const vp = get().viewport;
    const target = snapRect(snap, vp);
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        // Capture prevRect on first snap so the window can be restored later.
        const shouldStorePrev = !w.snapState || w.snapState === "none";
        return {
          ...w,
          x: target.x,
          y: target.y,
          w: target.w,
          h: target.h,
          snapState: snap,
          maximized: false,
          prevRect: shouldStorePrev && !w.maximized
            ? { x: w.x, y: w.y, w: w.w, h: w.h }
            : w.prevRect,
        };
      }),
    }));
  },

  setWindowOpacity: (id, opacity) => {
    // Clamp to a sensible range — anything below 0.3 makes a window unusable.
    const clamped = Math.max(0.3, Math.min(1, opacity));
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, opacity: clamped } : w
      ),
    }));
  },

  minimizeAll: () => {
    const desktop = get().activeDesktop;
    set((s) => ({
      windows: s.windows.map((w) =>
        w.desktop === desktop && !w.minimized ? { ...w, minimized: true } : w
      ),
      activeWindowId: null,
    }));
  },
}));

export type { AppWindow, ProtectedFile, OSSnapshot, RollbackEvent };
export { SECURITY_FOUNDATION };
