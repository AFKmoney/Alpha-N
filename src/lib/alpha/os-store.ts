/**
 * os-store.ts — the window manager state of Alpha-OS: windows, desktops,
 * tiling, snapshots/rollback, security ledger and the terminal command
 * queue the AI drives through run_terminal mutations.
 *
 * NOTE: this store must NOT import the evolution store (the evolution store
 * reaches back into this one via useOS.getState()).
 */
import { create } from "zustand";
import {
  clampRect,
  computeTiledLayout,
  defaultSplits,
  snapRect,
  winRect,
  SECURITY_FOUNDATION,
  DESKTOPS,
  MIN_WINDOW,
  WORKSPACE,
  type AppKind,
  type OSWindow,
  type Rect,
  type SnapState,
  type SplitRatios,
  type Viewport,
  type DockApp,
} from "./os-types";
import type { Agent, CodeLine } from "./evolution-data";
import { DOCK_APPS } from "./os-types";

export interface OsMetrics {
  cpu: number;
  ram: number;
  entropy: number;
  coherence: number;
}

export interface OSSnapshot {
  id: string;
  label: string;
  time: number;
  state: {
    windows: OSWindow[];
    codeLines: CodeLine[];
    agents: Agent[];
    metrics: OsMetrics;
    version: string;
    generation: number;
  };
}

export interface RollbackEvent {
  id: string;
  snapshotLabel: string;
  reason: string;
  time: number;
}

export interface ViolationAttempt {
  path: string;
  reason: string;
  time: number;
}

export interface PinnedDesktopApp {
  kind: AppKind;
  label: string;
  icon: string;
  data?: Record<string, unknown>;
}

/** Default window size per app kind. */
function defaultRect(kind: AppKind, z: number): Rect {
  const base: Record<string, { w: number; h: number }> = {
    terminal: { w: 780, h: 460 },
    editor: { w: 860, h: 560 },
    loom: { w: 820, h: 540 },
    files: { w: 640, h: 480 },
    browser: { w: 900, h: 600 },
    monitor: { w: 520, h: 480 },
    evolution: { w: 560, h: 520 },
    agents: { w: 520, h: 480 },
    security: { w: 660, h: 540 },
    custom: { w: 720, h: 520 },
    options: { w: 560, h: 440 },
    vault: { w: 560, h: 440 },
    memory: { w: 780, h: 560 },
    wallpaper: { w: 620, h: 480 },
    appstore: { w: 760, h: 540 },
    control: { w: 560, h: 460 },
    calculator: { w: 480, h: 600 },
    notes: { w: 780, h: 540 },
    clipboard: { w: 520, h: 520 },
    ambient: { w: 560, h: 520 },
    stats: { w: 640, h: 520 },
    clock: { w: 620, h: 480 },
    weather: { w: 520, h: 560 },
    music: { w: 560, h: 480 },
  };
  const size = base[kind] ?? { w: 680, h: 480 };
  const cascade = (z % 6) * 28;
  return { x: 90 + cascade, y: 70 + cascade, w: size.w, h: size.h };
}

function iconFor(kind: AppKind): string {
  return DOCK_APPS.find((a) => a.kind === kind)?.icon ?? "□";
}

function titleFor(kind: AppKind): string {
  return DOCK_APPS.find((a) => a.kind === kind)?.title ?? (kind as string);
}

interface OSState {
  windows: OSWindow[];
  zCounter: number;
  seq: number;
  activeDesktop: number;
  layoutMode: "tile" | "float";
  viewport: Viewport;
  splitRatios: Record<number, SplitRatios>;
  theme: "dark" | "light";
  snapPreview: Rect | null;
  pinnedTaskbar: AppKind[];
  pinnedDesktop: PinnedDesktopApp[];
  protectedFiles: typeof SECURITY_FOUNDATION;
  violationAttempts: ViolationAttempt[];
  snapshots: OSSnapshot[];
  rollbackEvents: RollbackEvent[];
  terminalQueue: string[];

  openApp: (kind: AppKind, opts?: { title?: string; data?: Record<string, unknown> }) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, rect: Partial<Rect>) => void;
  setWindowData: (id: string, patch: Record<string, unknown>) => void;
  setWindowOpacity: (id: string, opacity: number) => void;
  setAlwaysOnTop: (id: string, onTop: boolean) => void;
  moveWindowToDesktop: (id: string, desktop: number) => void;
  snapWindow: (id: string, snap: SnapState) => void;
  setSnapPreview: (rect: Rect | null) => void;
  minimizeAll: () => void;

  setActiveDesktop: (desktop: number) => void;
  setLayoutMode: (mode: "tile" | "float") => void;
  setViewport: (viewport: Viewport) => void;
  setSplitRatios: (desktop: number, ratios: SplitRatios) => void;

  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
  pinToTaskbar: (kind: AppKind) => void;
  unpinFromTaskbar: (kind: AppKind) => void;
  pinToDesktop: (kind: AppKind, opts?: { label?: string; icon?: string; data?: Record<string, unknown> }) => void;

  recordViolation: (path: string, reason: string) => void;
  takeSnapshot: (
    label: string,
    state: { windows: OSWindow[]; codeLines: CodeLine[]; agents: Agent[]; metrics: OsMetrics; version: string; generation: number }
  ) => OSSnapshot;
  rollback: (snapshot: OSSnapshot, reason: string) => { codeLines: CodeLine[]; agents: Agent[]; metrics: OsMetrics };
  queueTerminalCommand: (command: string) => void;
  dequeueTerminalCommand: () => string | undefined;
}

export const useOS = create<OSState>((set, get) => ({
  windows: [],
  zCounter: 10,
  seq: 0,
  activeDesktop: 1,
  layoutMode: "float",
  viewport: { x: 0, y: WORKSPACE.TOP, w: 1600, h: 900 - WORKSPACE.TOP - WORKSPACE.BOTTOM },
  splitRatios: Object.fromEntries(Array.from({ length: DESKTOPS }, (_, i) => [i + 1, defaultSplits(2)])),
  theme: "dark",
  snapPreview: null,
  pinnedTaskbar: ["terminal", "files", "browser"],
  pinnedDesktop: [],
  protectedFiles: SECURITY_FOUNDATION,
  violationAttempts: [],
  snapshots: [],
  rollbackEvents: [],
  terminalQueue: [],

  openApp: (kind, opts) => {
    const state = get();
    // single instance per kind per desktop — focus + update instead of dupe
    const existing = state.windows.find(
      (w) => w.kind === kind && w.desktop === state.activeDesktop && !w.minimized
    );
    if (existing) {
      set((s) => ({
        zCounter: s.zCounter + 1,
        windows: s.windows.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                z: s.zCounter + 1,
                minimized: false,
                title: opts?.title ?? w.title,
                data: opts?.data ? { ...w.data, ...opts.data } : w.data,
              }
            : w
        ),
      }));
      return existing.id;
    }

    const id = `win-${kind}-${Date.now()}-${++state.seq}`;
    const rect = clampRect(defaultRect(kind, state.zCounter), state.viewport);
    set((s) => ({
      zCounter: s.zCounter + 1,
      windows: [
        ...s.windows,
        {
          id,
          kind,
          title: opts?.title ?? titleFor(kind),
          icon: iconFor(kind),
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          minimized: false,
          maximized: false,
          z: s.zCounter + 1,
          desktop: s.activeDesktop,
          opacity: 1,
          snapState: "none" as SnapState,
          data: opts?.data,
        },
      ],
    }));
    return id;
  },

  closeWindow: (id) =>
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),

  focusWindow: (id) =>
    set((s) => ({
      zCounter: s.zCounter + 1,
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, z: s.zCounter + 1, minimized: false } : w
      ),
    })),

  minimizeWindow: (id) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) })),

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)),
    })),

  moveWindow: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const clamped = clampRect({ x, y, w: w.w, h: w.h }, s.viewport);
        return { ...w, x: clamped.x, y: clamped.y, snapState: "none" as SnapState };
      }),
    })),

  resizeWindow: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const clamped = clampRect(
          {
            x: rect.x ?? w.x,
            y: rect.y ?? w.y,
            w: Math.max(MIN_WINDOW.w, rect.w ?? w.w),
            h: Math.max(MIN_WINDOW.h, rect.h ?? w.h),
          },
          s.viewport
        );
        return { ...w, x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
      }),
    })),

  setWindowData: (id, patch) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, data: { ...w.data, ...patch } } : w
      ),
    })),

  setWindowOpacity: (id, opacity) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, opacity: Math.max(0.3, Math.min(1, opacity)) } : w
      ),
    })),

  setAlwaysOnTop: (id, onTop) =>
    set((s) => {
      if (onTop) {
        const topZ = Math.max(...s.windows.map((w) => w.z), s.zCounter) + 100;
        return {
          zCounter: s.zCounter + 1,
          windows: s.windows.map((w) => (w.id === id ? { ...w, onTop: true, z: topZ } : w)),
        };
      }
      return {
        windows: s.windows.map((w) => (w.id === id ? { ...w, onTop: false } : w)),
      };
    }),

  moveWindowToDesktop: (id, desktop) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, desktop: Math.max(1, Math.min(DESKTOPS, desktop)) } : w
      ),
    })),

  snapWindow: (id, snap) =>
    set((s) => {
      const target = snapRect(snap, s.viewport);
      return {
        windows: s.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                snapState: snap,
                x: target.x,
                y: target.y,
                w: target.w,
                h: target.h,
                maximized: snap === "top",
              }
            : w
        ),
        snapPreview: null,
      };
    }),

  setSnapPreview: (rect) => set({ snapPreview: rect }),

  minimizeAll: () =>
    set((s) => ({ windows: s.windows.map((w) => ({ ...w, minimized: true })) })),

  setActiveDesktop: (desktop) =>
    set({ activeDesktop: Math.max(1, Math.min(DESKTOPS, desktop)) }),

  setLayoutMode: (mode) =>
    set((s) => {
      // entering tile mode: distribute splits evenly for the current window count
      const count = s.windows.filter(
        (w) => w.desktop === s.activeDesktop && !w.minimized
      ).length;
      const ratios = defaultSplits(Math.max(count, 1));
      return { layoutMode: mode, splitRatios: { ...s.splitRatios, [s.activeDesktop]: ratios } };
    }),

  setViewport: (viewport) =>
    set((s) => ({
      viewport,
      windows: s.windows.map((w) => {
        const clamped = clampRect(winRect(w), viewport);
        return { ...w, x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
      }),
    })),

  setSplitRatios: (desktop, ratios) =>
    set((s) => ({ splitRatios: { ...s.splitRatios, [desktop]: ratios } })),

  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
        else document.documentElement.removeAttribute("data-theme");
      }
      return { theme };
    }),

  setTheme: (theme) => {
    if (typeof document !== "undefined") {
      if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
    }
    set({ theme });
  },

  pinToTaskbar: (kind) =>
    set((s) => ({
      pinnedTaskbar: s.pinnedTaskbar.includes(kind) ? s.pinnedTaskbar : [...s.pinnedTaskbar, kind],
    })),

  unpinFromTaskbar: (kind) =>
    set((s) => ({ pinnedTaskbar: s.pinnedTaskbar.filter((k) => k !== kind) })),

  pinToDesktop: (kind, opts) =>
    set((s) => ({
      pinnedDesktop: [
        ...s.pinnedDesktop.filter((p) => p.kind !== kind),
        {
          kind,
          label: opts?.label ?? titleFor(kind),
          icon: opts?.icon ?? iconFor(kind),
          data: opts?.data,
        },
      ],
    })),

  recordViolation: (path, reason) =>
    set((s) => ({
      violationAttempts: [{ path, reason, time: Date.now() }, ...s.violationAttempts].slice(0, 50),
    })),

  takeSnapshot: (label, state) => {
    const snapshot: OSSnapshot = {
      id: `snap-${Date.now()}`,
      label,
      time: Date.now(),
      state: {
        windows: state.windows,
        codeLines: state.codeLines,
        agents: state.agents,
        metrics: state.metrics,
        version: state.version,
        generation: state.generation,
      },
    };
    set((s) => ({ snapshots: [snapshot, ...s.snapshots].slice(0, 30) }));
    return snapshot;
  },

  rollback: (snapshot, reason) => {
    set((s) => ({
      windows: snapshot.state.windows,
      rollbackEvents: [
        { id: `rb-${Date.now()}`, snapshotLabel: snapshot.label, reason, time: Date.now() },
        ...s.rollbackEvents,
      ].slice(0, 50),
    }));
    return {
      codeLines: snapshot.state.codeLines,
      agents: snapshot.state.agents,
      metrics: snapshot.state.metrics,
    };
  },

  queueTerminalCommand: (command) =>
    set((s) => ({ terminalQueue: [...s.terminalQueue, command] })),

  dequeueTerminalCommand: () => {
    const [first, ...rest] = get().terminalQueue;
    if (first) set({ terminalQueue: rest });
    return first;
  },
}));

/** Tiled layout for the current desktop (helper consumed by window-manager). */
export function computeDesktopLayout(
  windows: OSWindow[],
  viewport: Viewport,
  desktop: number,
  splitRatios: Record<number, SplitRatios>
) {
  const visible = windows.filter((w) => w.desktop === desktop && !w.minimized);
  const ratios = splitRatios[desktop] ?? defaultSplits(Math.max(visible.length, 1));
  return computeTiledLayout(visible, viewport, ratios);
}
