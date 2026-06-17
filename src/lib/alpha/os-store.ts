"use client";

import { create } from "zustand";
import {
  DOCK_APPS,
  type AppKind,
  type AppWindow,
  type ProtectedFile,
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

  // security
  protectedFiles: ProtectedFile[];
  violationAttempts: { time: number; path: string; reason: string }[];

  // snapshots & rollback
  snapshots: OSSnapshot[];
  rollbackEvents: RollbackEvent[];

  // terminal command queue (AI can queue commands)
  terminalCommands: { id: string; command: string; time: number }[];

  // actions
  openApp: (kind: AppKind, opts?: Partial<AppWindow>) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  setWindowData: (id: string, data: Record<string, unknown>) => void;

  takeSnapshot: (label: string, state: Omit<OSSnapshot, "id" | "time" | "label" | "windows"> & { windows?: AppWindow[] }) => OSSnapshot;
  rollback: (snapshot: OSSnapshot, reason: string) => Omit<OSSnapshot, "id" | "time" | "windows"> & { windows: AppWindow[] };
  recordViolation: (path: string, reason: string) => void;
  queueTerminalCommand: (command: string) => void;
  clearTerminalCommand: (id: string) => void;
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
    custom: { w: 560, h: 400 },
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

export const useOS = create<OSStore>((set, get) => ({
  windows: [],
  zTop: 10,
  activeWindowId: null,

  protectedFiles: SECURITY_FOUNDATION,
  violationAttempts: [],

  snapshots: [],
  rollbackEvents: [],

  terminalCommands: [],

  openApp: (kind, opts) => {
    const id = `win-${winId++}`;
    const dockApp = DOCK_APPS.find((d) => d.kind === kind);
    const rect = defaultRect(kind, get().windows.length);
    const z = get().zTop + 1;
    const win: AppWindow = {
      id,
      kind,
      title: opts?.title ?? dockApp?.defaultTitle ?? kind,
      icon: opts?.icon ?? dockApp?.icon ?? "▢",
      x: opts?.x ?? rect.x,
      y: opts?.y ?? rect.y,
      w: opts?.w ?? rect.w,
      h: opts?.h ?? rect.h,
      z,
      minimized: false,
      maximized: false,
      data: opts?.data,
    };
    set((s) => ({
      windows: [...s.windows, win],
      zTop: z,
      activeWindowId: id,
    }));
    return id;
  },

  closeWindow: (id) =>
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
      activeWindowId: s.activeWindowId === id ? null : s.activeWindowId,
    })),

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

  minimizeWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      ),
      activeWindowId: s.activeWindowId === id ? null : s.activeWindowId,
    })),

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.prevRect) {
          return { ...w, maximized: false, ...w.prevRect, prevRect: undefined };
        }
        return {
          ...w,
          maximized: true,
          prevRect: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: 12,
          y: 52,
          w: typeof window !== "undefined" ? window.innerWidth - 24 : 1200,
          h: typeof window !== "undefined" ? window.innerHeight - 140 : 700,
        };
      }),
    })),

  moveWindow: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, x, y } : w
      ),
    })),

  resizeWindow: (id, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) =>
        win.id === id ? { ...win, w, h } : win
      ),
    })),

  setWindowData: (id, data) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, data: { ...w.data, ...data } } : w
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
}));

export type { AppWindow, ProtectedFile, OSSnapshot, RollbackEvent };
export { SECURITY_FOUNDATION };
