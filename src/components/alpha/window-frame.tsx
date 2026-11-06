/**
 * window-frame.tsx — the OS window chrome: drag, 8-way resize, minimize /
 * maximize / close, drag-to-edge snapping with a portal preview, tiled mode
 * (rect imposed by the WM, free drag disabled), opacity + snap badges.
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Columns2, Maximize2, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOS } from "@/lib/alpha/os-store";
import { clampRect, snapRect, MIN_WINDOW, SPLIT_HANDLE_W, type OSWindow, type Rect, type SnapState, type Viewport } from "@/lib/alpha/os-types";

const EDGE = 6;

function detectSnap(x: number, y: number, viewport: Viewport): SnapState {
  const edge = 14;
  const nearLeft = x <= viewport.x + edge;
  const nearRight = x >= viewport.x + viewport.w - edge;
  const nearTop = y <= viewport.y + edge;
  const nearBottom = y >= viewport.y + viewport.h - edge;
  if (nearTop && nearLeft) return "bl"; // corner order: top-left handled as quarter
  if (nearTop && nearRight) return "br";
  if (nearTop) return "top";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return "none";
}

export function WindowFrame({
  win,
  tiledRect,
  children,
}: {
  win: OSWindow;
  tiledRect?: Rect;
  children: React.ReactNode;
}): React.ReactElement {
  const focusWindow = useOS((s) => s.focusWindow);
  const closeWindow = useOS((s) => s.closeWindow);
  const minimizeWindow = useOS((s) => s.minimizeWindow);
  const toggleMaximize = useOS((s) => s.toggleMaximize);
  const moveWindow = useOS((s) => s.moveWindow);
  const resizeWindow = useOS((s) => s.resizeWindow);
  const snapWindow = useOS((s) => s.snapWindow);
  const setSnapPreview = useOS((s) => s.setSnapPreview);
  const viewport = useOS((s) => s.viewport);
  const layoutMode = useOS((s) => s.layoutMode);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const resizeState = useRef<{ dir: string; startX: number; startY: number; rect: Rect }>({
    dir: "",
    startX: 0,
    startY: 0,
    rect: { x: 0, y: 0, w: 0, h: 0 },
  });

  const rect: Rect = tiledRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };
  const tiled = layoutMode === "tile" && Boolean(tiledRect);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (tiled || win.maximized) return;
      const os = useOS.getState();
      os.focusWindow(win.id);
      dragState.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [tiled, win.id, win.x, win.y, win.maximized]
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const os = useOS.getState();
      const x = e.clientX - dragState.current.dx;
      const y = e.clientY - dragState.current.dy;
      moveWindow(win.id, x, y);
      const snap = detectSnap(e.clientX, e.clientY, os.viewport);
      setSnapPreview(snap === "none" ? null : snapRect(snap, os.viewport));
    },
    [dragging, moveWindow, setSnapPreview, win.id]
  );

  const onDragEnd = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    const os = useOS.getState();
    if (os.snapPreview) {
      const snap = detectSnap(win.x, win.y, os.viewport);
      if (snap !== "none") snapWindow(win.id, snap);
      else setSnapPreview(null);
    } else {
      setSnapPreview(null);
    }
  }, [dragging, snapWindow, setSnapPreview, win.id, win.x, win.y]);

  const startResize = useCallback(
    (dir: string) => (e: React.PointerEvent) => {
      e.stopPropagation();
      if (tiled || win.maximized) return;
      const os = useOS.getState();
      os.focusWindow(win.id);
      resizeState.current = { dir, startX: e.clientX, startY: e.clientY, rect: { x: win.x, y: win.y, w: win.w, h: win.h } };
      setResizing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [tiled, win.id, win.x, win.y, win.w, win.h, win.maximized]
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizing) return;
      const { dir, startX, startY, rect: base } = resizeState.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let next: Rect = { ...base };
      if (dir.includes("e")) next.w = Math.max(MIN_WINDOW.w, base.w + dx);
      if (dir.includes("s")) next.h = Math.max(MIN_WINDOW.h, base.h + dy);
      if (dir.includes("w")) {
        next.w = Math.max(MIN_WINDOW.w, base.w - dx);
        next.x = base.x + (base.w - next.w);
      }
      if (dir.includes("n")) {
        next.h = Math.max(MIN_WINDOW.h, base.h - dy);
        next.y = base.y + (base.h - next.h);
      }
      resizeWindow(win.id, next);
    },
    [resizing, resizeWindow, win.id]
  );

  const endResize = useCallback(() => setResizing(false), []);

  const handles = useMemo(
    () => [
      { dir: "n", className: "top-0 left-2 right-2 h-1 cursor-n-resize" },
      { dir: "s", className: "bottom-0 left-2 right-2 h-1 cursor-s-resize" },
      { dir: "w", className: "left-0 top-2 bottom-2 w-1 cursor-w-resize" },
      { dir: "e", className: "right-0 top-2 bottom-2 w-1 cursor-e-resize" },
      { dir: "nw", className: "top-0 left-0 h-2.5 w-2.5 cursor-nw-resize" },
      { dir: "ne", className: "top-0 right-0 h-2.5 w-2.5 cursor-ne-resize" },
      { dir: "sw", className: "bottom-0 left-0 h-2.5 w-2.5 cursor-sw-resize" },
      { dir: "se", className: "bottom-0 right-0 h-2.5 w-2.5 cursor-se-resize" },
    ],
    []
  );

  const snapPreview = useOS((s) => s.snapPreview);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className={cn(
          "glass-strong absolute flex flex-col overflow-hidden rounded-xl",
          dragging || resizing ? "select-none" : "",
          win.onTop ? "ring-1 ring-(--ae-amethyst)/40" : ""
        )}
        data-window-id={win.id}
        data-app-kind={win.kind}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          zIndex: win.z,
          opacity: win.opacity,
          display: win.minimized ? "none" : undefined,
        }}
        onPointerDown={() => focusWindow(win.id)}
      >
        {/* title bar */}
        <div
          className={cn(
            "font-mono-ae flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-white/8 px-3 active:cursor-grabbing",
            tiled && "cursor-default active:cursor-default"
          )}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onDoubleClick={() => !tiled && toggleMaximize(win.id)}
        >
          <span className="text-xs text-(--ae-cyan)">{win.icon}</span>
          <span className="flex-1 truncate text-[11px] tracking-wide text-zinc-300">{win.title}</span>
          {!tiled && (
            <>
              {win.snapState !== "none" && (
                <span className="rounded bg-(--ae-cyan)/15 px-1 text-[9px] text-(--ae-cyan)">{win.snapState}</span>
              )}
              {win.opacity < 1 && <span className="text-[9px] text-zinc-500">{Math.round(win.opacity * 100)}%</span>}
              {win.onTop && <span className="text-[9px] text-(--ae-amethyst)">on top</span>}
            </>
          )}
          {tiled && <Columns2 className="h-3 w-3 text-(--ae-cyan)/70" />}
          <span className="rounded bg-white/5 px-1 text-[9px] text-zinc-500">d{win.desktop}</span>
          <div className="ml-1 flex items-center gap-1.5" data-ai-skip>
            <button
              type="button"
              aria-label="Minimize"
              className="rounded p-0.5 text-zinc-400 hover:bg-white/10 hover:text-(--ae-gold)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => minimizeWindow(win.id)}
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Maximize"
              className="rounded p-0.5 text-zinc-400 hover:bg-white/10 hover:text-(--ae-cyan)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => !tiled && toggleMaximize(win.id)}
            >
              {win.maximized ? <Square className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-0.5 text-zinc-400 hover:bg-(--ae-rose)/25 hover:text-(--ae-rose)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => closeWindow(win.id)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* content */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

        {/* resize handles */}
        {!tiled && !win.maximized &&
          handles.map((h) => (
            <div
              key={h.dir}
              className={cn("absolute z-10", h.className)}
              onPointerDown={startResize(h.dir)}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
            />
          ))}
      </motion.div>

      {/* snap preview overlay (portal escapes the transformed window) */}
      {snapPreview &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9998] rounded-xl border-2 border-(--ae-cyan)/50 bg-(--ae-cyan)/8"
            style={{
              left: snapPreview.x,
              top: snapPreview.y,
              width: snapPreview.w,
              height: snapPreview.h,
              transition: "all 90ms ease-out",
            }}
          />,
          document.body
        )}
    </>
  );
}

/** Draggable gap between tiled windows — resizing one side resizes both. */
export function SplitHandleBar({
  handle,
  viewport,
  onRatioDelta,
}: {
  handle: { id: string; orientation: "vertical" | "horizontal"; rect: Rect; before: string; after: string };
  viewport: Viewport;
  onRatioDelta: (handleId: string, before: string, after: string, deltaPixels: number) => void;
}): React.ReactElement {
  const [active, setActive] = useState(false);
  const lastPos = useRef(0);

  const onDown = (e: React.PointerEvent) => {
    setActive(true);
    lastPos.current = handle.orientation === "vertical" ? e.clientX : e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!active) return;
    const pos = handle.orientation === "vertical" ? e.clientX : e.clientY;
    const delta = pos - lastPos.current;
    lastPos.current = pos;
    onRatioDelta(handle.id, handle.before, handle.after, delta);
  };
  const onUp = () => setActive(false);

  return (
    <div
      className={cn(
        "absolute z-[8000] rounded-full transition-colors",
        handle.orientation === "vertical" ? "cursor-col-resize" : "cursor-row-resize",
        active ? "bg-(--ae-cyan)/70" : "bg-white/10 hover:bg-(--ae-cyan)/40"
      )}
      style={{
        left: handle.rect.x,
        top: handle.rect.y,
        width: handle.orientation === "vertical" ? SPLIT_HANDLE_W : handle.rect.w,
        height: handle.orientation === "horizontal" ? SPLIT_HANDLE_W : handle.rect.h,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      data-ai-skip
    />
  );
}

/** Maximized geometry for a window. */
export function maximizedRect(viewport: Viewport): Rect {
  return clampRect({ x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }, viewport);
}
