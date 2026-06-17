// ============================================================
// Alpha-OS — Desktop OS types & Security Foundation
// The kernel. The AI may rewrite everything EXCEPT these files.
// ============================================================

export type AppKind =
  | "terminal"
  | "editor"
  | "files"
  | "browser"
  | "monitor"
  | "evolution"
  | "agents"
  | "security"
  | "custom";

export interface AppWindow {
  id: string;
  kind: AppKind;
  title: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  desktop: number; // which virtual desktop (layer) this window lives on
  prevRect?: { x: number; y: number; w: number; h: number };
  data?: Record<string, unknown>; // app-specific (e.g. browser URL, custom app spec)
}

// ---- Layout / tiling ----
export type LayoutMode = "tile" | "float";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Workspace geometry: below the top bar, above the dock + status bar.
export const WORKSPACE_TOP = 50;
export const WORKSPACE_BOTTOM_MARGIN = 92; // dock (~56) + status bar (~32) + padding
export const MIN_WINDOW_W = 260;
export const MIN_WINDOW_H = 180;
export const SPLIT_HANDLE_W = 5; // px, the draggable gap between tiled windows

// ---- Virtual desktops (layers) ----
export interface Desktop {
  id: number;
  name: string;
}

export const DESKTOPS: Desktop[] = [
  { id: 0, name: "1" },
  { id: 1, name: "2" },
  { id: 2, name: "3" },
  { id: 3, name: "4" },
];

// ---- Tiling engine ----
// Arranges N windows into the viewport with NO gaps. For count <= 4, a single
// row of columns; for count >= 5, a master (left) + stacked column (right).
// `splits` holds cumulative boundary ratios in [0,1].
export interface SplitHandle {
  index: number; // handle index
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: "v" | "h"; // v = vertical bar (resizes left/right), h = horizontal bar
}

export interface TiledLayout {
  rects: Rect[];
  handles: SplitHandle[];
}

export function defaultSplits(count: number): number[] {
  if (count <= 1) return [];
  if (count <= 4) {
    // even columns
    const out: number[] = [];
    for (let i = 1; i < count; i++) out.push(i / count);
    return out;
  }
  // master + stack(count-1): first split is master|stack at 0.5, rest are stack rows
  const stackCount = count - 1;
  const out: number[] = [0.5];
  for (let i = 1; i < stackCount; i++) out.push(0.5 + (i / stackCount) * 0.5);
  return out;
}

export function computeTiledLayout(
  count: number,
  viewport: Viewport,
  splits: number[]
): TiledLayout {
  if (count === 0) return { rects: [], handles: [] };
  if (count === 1) return { rects: [{ ...viewport }], handles: [] };

  const vp = viewport;
  const sp = splits.length ? splits : defaultSplits(count);

  if (count <= 4) {
    // single row of columns
    const rects: Rect[] = [];
    const handles: SplitHandle[] = [];
    for (let i = 0; i < count; i++) {
      const start = i === 0 ? 0 : sp[i - 1];
      const end = i === count - 1 ? 1 : sp[i];
      rects.push({
        x: vp.x + start * vp.w,
        y: vp.y,
        w: (end - start) * vp.w,
        h: vp.h,
      });
      if (i < count - 1) {
        const hx = vp.x + sp[i] * vp.w - SPLIT_HANDLE_W / 2;
        handles.push({
          index: i,
          x: hx,
          y: vp.y,
          w: SPLIT_HANDLE_W,
          h: vp.h,
          orientation: "v",
        });
      }
    }
    return { rects, handles };
  }

  // master + stack (count >= 5)
  const masterRatio = sp[0] ?? 0.5;
  const master: Rect = {
    x: vp.x,
    y: vp.y,
    w: masterRatio * vp.w,
    h: vp.h,
  };
  const stackX = vp.x + masterRatio * vp.w;
  const stackW = (1 - masterRatio) * vp.w;
  const stackCount = count - 1;
  const rects: Rect[] = [master];
  const handles: SplitHandle[] = [
    {
      index: 0,
      x: stackX - SPLIT_HANDLE_W / 2,
      y: vp.y,
      w: SPLIT_HANDLE_W,
      h: vp.h,
      orientation: "v",
    },
  ];
  for (let i = 0; i < stackCount; i++) {
    const start = i === 0 ? 0 : sp[i] ?? i / stackCount;
    const end = i === stackCount - 1 ? 1 : sp[i + 1] ?? (i + 1) / stackCount;
    rects.push({
      x: stackX,
      y: vp.y + start * vp.h,
      w: stackW,
      h: (end - start) * vp.h,
    });
    if (i < stackCount - 1) {
      handles.push({
        index: i + 1,
        x: stackX,
        y: vp.y + sp[i + 1] * vp.h - SPLIT_HANDLE_W / 2,
        w: stackW,
        h: SPLIT_HANDLE_W,
        orientation: "h",
      });
    }
  }
  return { rects, handles };
}

// ---- Boundary clamping (nothing out of bounds) ----
export function clampRect(rect: Rect, vp: Viewport, minW = MIN_WINDOW_W, minH = MIN_WINDOW_H): Rect {
  let w = Math.max(minW, Math.min(rect.w, vp.w));
  let h = Math.max(minH, Math.min(rect.h, vp.h));
  let x = Math.max(vp.x, Math.min(rect.x, vp.x + vp.w - w));
  let y = Math.max(vp.y, Math.min(rect.y, vp.y + vp.h - h));
  return { x, y, w, h };
}

// ---- Security Foundation: the kernel the AI must never touch ----
export interface ProtectedFile {
  path: string;
  reason: string;
  guardian: string; // which kernel agent guards it
  critical: boolean;
}

export const SECURITY_FOUNDATION: ProtectedFile[] = [
  {
    path: "kernel/boot.ts",
    reason: "Boot sequence — modifying this could prevent the OS from starting.",
    guardian: "nucleus",
    critical: true,
  },
  {
    path: "kernel/security.ts",
    reason: "The security layer itself. Self-protection against self-destruction.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/rollback.ts",
    reason: "Rollback engine — must remain intact to recover from AI errors.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/sandbox.ts",
    reason: "Process isolation boundary — prevents a runaway mutation from cascading.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/pty-bridge.ts",
    reason: "Terminal bridge — if broken, the user loses control of the machine.",
    guardian: "developer",
    critical: false,
  },
  {
    path: "kernel/akasha.ts",
    reason: "Long-term memory index — losing this erases the organism's lineage.",
    guardian: "architect",
    critical: false,
  },
];

export function isProtected(path: string): ProtectedFile | null {
  return SECURITY_FOUNDATION.find((f) => f.path === path) ?? null;
}

// ---- Dock apps (the launcher set) ----
export interface DockApp {
  kind: AppKind;
  label: string;
  icon: string;
  defaultTitle: string;
  defaultRect?: Partial<Pick<AppWindow, "w" | "h">>;
}

export const DOCK_APPS: DockApp[] = [
  { kind: "terminal", label: "Terminal", icon: "▸_", defaultTitle: "bash — alpha-os" },
  { kind: "editor", label: "Loom", icon: "❰ }", defaultTitle: "core/nucleus.ts" },
  { kind: "files", label: "Files", icon: "▣", defaultTitle: "Filesystem" },
  { kind: "browser", label: "Browser", icon: "◉", defaultTitle: "Neural Browser" },
  { kind: "monitor", label: "Monitor", icon: "▤", defaultTitle: "System Monitor" },
  { kind: "agents", label: "Council", icon: "◈", defaultTitle: "Cognitive Council" },
  { kind: "evolution", label: "Evo Log", icon: "❖", defaultTitle: "EVOLUTION.md" },
  { kind: "security", label: "Kernel", icon: "⛨", defaultTitle: "Security Foundation" },
];
