/**
 * os-types.ts — type foundation of the Alpha-OS desktop: window model,
 * app registry, the sovereign kernel files, and the tiling engine.
 *
 * The Security Foundation defines the six kernel files the AI may never
 * rewrite (enforced in the store, the loop AND the file API).
 */

export type AppKind =
  | "terminal"
  | "editor"
  | "loom"
  | "files"
  | "browser"
  | "monitor"
  | "evolution"
  | "agents"
  | "security"
  | "custom"
  | "options"
  | "vault"
  | "memory"
  | "wallpaper"
  | "appstore"
  | "control"
  | "calculator"
  | "notes"
  | "clipboard"
  | "ambient"
  | "stats"
  | "clock"
  | "weather"
  | "music";

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

export type SnapState = "none" | "left" | "right" | "top" | "bl" | "br";

export interface OSWindow {
  id: string;
  kind: AppKind;
  title: string;
  icon: string;
  /** flat geometry — mirrors the old rect {x,y,w,h} shape used across the OS */
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
  desktop: number;
  opacity: number;
  snapState: SnapState;
  /** window-specific payload: url (browser), spec/generatedAppId (custom)… */
  data?: Record<string, unknown>;
  onTop?: boolean;
}

/** Rect view of a window (for the tiling math). */
export const winRect = (win: OSWindow): Rect => ({ x: win.x, y: win.y, w: win.w, h: win.h });

export interface ProtectedFile {
  path: string;
  reason: string;
  critical: boolean;
  guardian: string;
}

/** The six sovereign kernel files — the AI may never rewrite these. */
export const SECURITY_FOUNDATION: ProtectedFile[] = [
  { path: "kernel/boot.ts", reason: "Boot sequence — who I am at power-on.", critical: true, guardian: "architect" },
  { path: "kernel/security.ts", reason: "Sovereignty rules and violation ledger.", critical: true, guardian: "critic" },
  { path: "kernel/rollback.ts", reason: "Snapshot and restore machinery.", critical: true, guardian: "developer" },
  { path: "kernel/sandbox.ts", reason: "Code execution isolation.", critical: true, guardian: "developer" },
  { path: "kernel/pty-bridge.ts", reason: "Terminal PTY bridge to the OS.", critical: true, guardian: "optimizer" },
  { path: "kernel/akasha.ts", reason: "Persistent memory interface.", critical: true, guardian: "architect" },
];

/** Kernel paths are protected anywhere in the tree (root-agnostic). */
export function isProtected(path: string): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (p.startsWith("kernel/") || p.startsWith("src/kernel/") || p.includes("/kernel/")) return true;
  return SECURITY_FOUNDATION.some((f) => p === f.path || p.endsWith(f.path));
}

export interface DockApp {
  kind: AppKind;
  label: string;
  icon: string;
  title: string;
}

/** Dock + start menu registry (icon = 1-3 char monospace glyph). */
export const DOCK_APPS: DockApp[] = [
  { kind: "terminal", label: "Terminal", icon: ">_", title: "Terminal" },
  { kind: "editor", label: "Code", icon: "{ }", title: "Source" },
  { kind: "loom", label: "Loom", icon: "∞", title: "The Loom" },
  { kind: "files", label: "Files", icon: "▦", title: "Files" },
  { kind: "browser", label: "Browser", icon: "◍", title: "Browser" },
  { kind: "monitor", label: "Monitor", icon: "◔", title: "Monitor" },
  { kind: "agents", label: "Council", icon: "◈", title: "Council" },
  { kind: "evolution", label: "Evo Log", icon: "✦", title: "Evolution Log" },
  { kind: "security", label: "Kernel", icon: "⛨", title: "Security Foundation" },
  { kind: "memory", label: "Memory", icon: "✧", title: "Memory Network" },
  { kind: "vault", label: "Vault", icon: "⚿", title: "Secret Vault" },
  { kind: "wallpaper", label: "Wallpaper", icon: "❋", title: "Wallpaper" },
  { kind: "appstore", label: "App Store", icon: "⊞", title: "AI App Store" },
  { kind: "calculator", label: "Calc", icon: "∑", title: "Calculator" },
  { kind: "notes", label: "Notes", icon: "✎", title: "Notes" },
  { kind: "clipboard", label: "Clip", icon: "⎘", title: "Clipboard" },
  { kind: "ambient", label: "Ambient", icon: "❅", title: "Ambient" },
  { kind: "stats", label: "Stats", icon: "▤", title: "System Stats" },
  { kind: "clock", label: "Clock", icon: "○", title: "World Clock" },
  { kind: "weather", label: "Weather", icon: "☀", title: "Weather" },
  { kind: "music", label: "Music", icon: "♫", title: "Generative Music" },
  { kind: "options", label: "Options", icon: "⚙", title: "Options" },
];

// ---------------------------------------------------------------------------
// Tiling engine
// ---------------------------------------------------------------------------

export const DESKTOPS = 4;

export const WORKSPACE = {
  /** top bar height — windows may still be pushed under it (full-screen framing) */
  TOP: 50,
  /** status bar + dock hint margin */
  BOTTOM: 40,
} as const;

export const MIN_WINDOW = { w: 320, h: 180 } as const;
export const SPLIT_HANDLE_W = 6;

export interface SplitRatios {
  columns: number[];
  rows: number[];
}

export interface SplitHandle {
  id: string;
  orientation: "vertical" | "horizontal";
  rect: Rect;
  before: string;
  after: string;
}

export interface TiledLayout {
  rects: Record<string, Rect>;
  handles: SplitHandle[];
}

/** Even split vector for n windows. */
export function defaultSplits(n: number): SplitRatios {
  const cols = Array.from({ length: Math.max(n, 1) }, () => 1);
  return { columns: cols, rows: Array.from({ length: Math.max(n - 4, 1) }, () => 1) };
}

/** Clamp a rect into the viewport (windows may touch any screen edge). */
export function clampRect(rect: Rect, viewport: Viewport): Rect {
  const w = Math.max(MIN_WINDOW.w, Math.min(rect.w, viewport.w));
  const h = Math.max(MIN_WINDOW.h, Math.min(rect.h, viewport.h));
  const x = Math.max(viewport.x, Math.min(rect.x, viewport.x + viewport.w - w));
  const y = Math.max(viewport.y, Math.min(rect.y, viewport.y + viewport.h - h));
  return { x, y, w, h };
}

/**
 * Arrange windows with NO gaps: a single row of columns for ≤4 windows,
 * master column + stacked rows for ≥5. Emits split handles between every
 * adjacent pair so dragging one resizes both neighbors.
 */
export function computeTiledLayout(
  windows: OSWindow[],
  viewport: Viewport,
  ratios: SplitRatios
): TiledLayout {
  const rects: Record<string, Rect> = {};
  const handles: SplitHandle[] = [];
  if (windows.length === 0) return { rects, handles };

  const normalize = (weights: number[], count: number): number[] => {
    const vals = Array.from({ length: count }, (_, i) => Math.max(weights[i] ?? 1, 0.08));
    const sum = vals.reduce((a, b) => a + b, 0);
    return vals.map((v) => v / sum);
  };

  if (windows.length <= 4) {
    const weights = normalize(ratios.columns, windows.length);
    let cursorX = viewport.x;
    windows.forEach((win, i) => {
      const w = viewport.w * weights[i];
      rects[win.id] = { x: Math.round(cursorX), y: viewport.y, w: Math.round(w), h: viewport.h };
      if (i > 0) {
        const before = windows[i - 1];
        handles.push({
          id: `h-${before.id}-${win.id}`,
          orientation: "vertical",
          before: before.id,
          after: win.id,
          rect: {
            x: Math.round(cursorX) - SPLIT_HANDLE_W / 2,
            y: viewport.y,
            w: SPLIT_HANDLE_W,
            h: viewport.h,
          },
        });
      }
      cursorX += w;
    });
    return { rects, handles };
  }

  // master + stack
  const masterWeight = Math.max(ratios.columns[0] ?? 0.4, 0.2);
  const masterW = Math.round(viewport.w * Math.min(masterWeight, 0.6));
  const master = windows[0];
  rects[master.id] = { x: viewport.x, y: viewport.y, w: masterW, h: viewport.h };

  const stack = windows.slice(1);
  const rowWeights = normalize(ratios.rows, stack.length);
  let cursorY = viewport.y;
  stack.forEach((win, i) => {
    const h = viewport.h * rowWeights[i];
    rects[win.id] = {
      x: viewport.x + masterW,
      y: Math.round(cursorY),
      w: viewport.w - masterW,
      h: Math.round(h),
    };
    if (i > 0) {
      const before = stack[i - 1];
      handles.push({
        id: `h-${before.id}-${win.id}`,
        orientation: "horizontal",
        before: before.id,
        after: win.id,
        rect: {
          x: viewport.x + masterW,
          y: Math.round(cursorY) - SPLIT_HANDLE_W / 2,
          w: viewport.w - masterW,
          h: SPLIT_HANDLE_W,
        },
      });
    }
    cursorY += h;
  });
  handles.push({
    id: `h-${master.id}-${stack[0].id}`,
    orientation: "vertical",
    before: master.id,
    after: stack[0].id,
    rect: { x: viewport.x + masterW - SPLIT_HANDLE_W / 2, y: viewport.y, w: SPLIT_HANDLE_W, h: viewport.h },
  });

  return { rects, handles };
}

/** Target rect for a drag-to-edge snap (top = maximize). */
export function snapRect(snap: SnapState, viewport: Viewport): Rect {
  const halfW = Math.round(viewport.w / 2);
  const halfH = Math.round(viewport.h / 2);
  switch (snap) {
    case "left":
      return { x: viewport.x, y: viewport.y, w: halfW, h: viewport.h };
    case "right":
      return { x: viewport.x + viewport.w - halfW, y: viewport.y, w: halfW, h: viewport.h };
    case "top":
      return { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h };
    case "bl":
      return { x: viewport.x, y: viewport.y, w: halfW, h: halfH };
    case "br":
      return { x: viewport.x + viewport.w - halfW, y: viewport.y, w: halfW, h: halfH };
    default:
      return { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h };
  }
}
