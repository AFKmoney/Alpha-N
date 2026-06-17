"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Columns2, Minus, Square, X, Copy, RotateCw, Brain, Layers } from "lucide-react";
import { useOS, type AppWindow } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { Rect } from "@/lib/alpha/os-types";
import { triggerContextMenu, buildWindowActions } from "./context-menu";
import { cn } from "@/lib/utils";

interface WindowFrameProps {
  win: AppWindow;
  tiledRect?: Rect;
  children: React.ReactNode;
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

export function WindowFrame({ win, tiledRect, children }: WindowFrameProps) {
  const {
    focusWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximize,
    moveWindow,
    resizeWindow,
    layoutMode,
    activeDesktop,
  } = useOS();

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origX: number; origY: number; edge: ResizeEdge } | null>(null);
  const [active, setActive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isTiled = layoutMode === "tile" && !!tiledRect;
  const rect = tiledRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };

  const onPointerDownDrag = (e: React.PointerEvent) => {
    if (isTiled || win.maximized) return;
    focusWindow(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };
    setActive(true);
    e.preventDefault();
  };

  const onPointerDownResize = (e: React.PointerEvent, edge: ResizeEdge) => {
    if (isTiled || win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    focusWindow(win.id);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: win.w, origH: win.h, origX: win.x, origY: win.y, edge };
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        moveWindow(win.id, dragRef.current.origX + dx, dragRef.current.origY + dy);
      } else if (resizeRef.current) {
        const r = resizeRef.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        let newW = r.origW;
        let newH = r.origH;
        let newX = r.origX;
        let newY = r.origY;

        if (r.edge?.includes("e")) newW = Math.max(260, r.origW + dx);
        if (r.edge?.includes("s")) newH = Math.max(200, r.origH + dy);
        if (r.edge?.includes("w")) {
          newW = Math.max(260, r.origW - dx);
          newX = r.origX + (r.origW - newW);
        }
        if (r.edge?.includes("n")) {
          newH = Math.max(200, r.origH - dy);
          newY = r.origY + (r.origH - newH);
        }

        // Apply both resize and move if needed
        resizeWindow(win.id, newW, newH);
        if (newX !== r.origX || newY !== r.origY) {
          moveWindow(win.id, newX, newY);
        }
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      setActive(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [active, win.id, moveWindow, resizeWindow]);

  if (win.minimized) return null;
  if (win.desktop !== activeDesktop) return null;

  const handleReload = () => setReloadKey(k => k + 1);
  const handleExplain = () => {
    // Trigger an AI explanation of this window
    const event = new CustomEvent("alpha-explain-window", { detail: { windowId: win.id, kind: win.kind, title: win.title } });
    window.dispatchEvent(event);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    triggerContextMenu(e, buildWindowActions(win.id, win.title, useOS.getState(), useEvolution.getState()));
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={cn(
        "glass absolute flex flex-col overflow-hidden rounded-xl",
        isTiled && "rounded-none"
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: win.z }}
      onPointerDown={() => focusWindow(win.id)}
      onContextMenu={handleContextMenu}
      data-ai-skip={win.kind === "terminal" ? undefined : "true"}
    >
      {/* Title bar */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2"
        onPointerDown={onPointerDownDrag}
        style={{ cursor: isTiled || win.maximized ? "default" : "grab" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isTiled ? (
            <Columns2 className="h-4 w-4 shrink-0 text-[oklch(0.82_0.17_195)]" />
          ) : (
            <span className="font-mono-ae text-sm text-[oklch(0.82_0.17_195)]">{win.icon}</span>
          )}
          <span className="truncate font-mono-ae text-[0.8rem] text-foreground/80">{win.title}</span>
          {win.desktop !== 0 && (
            <span className="flex items-center gap-0.5 rounded-full border border-border/50 px-1.5 py-0 font-mono-ae text-[0.55rem] text-muted-foreground">
              <Layers className="h-2.5 w-2.5" /> {win.desktop + 1}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Explain with AI */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleExplain}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[oklch(0.74_0.22_300)]/15 hover:text-[oklch(0.74_0.22_300)]"
            aria-label="Explain with AI"
            title="Explain with AI"
          >
            <Brain className="h-3.5 w-3.5" />
          </button>
          {/* Reload */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleReload}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Reload"
            title="Reload"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          {/* Minimize */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => minimizeWindow(win.id)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {/* Maximize */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleMaximize(win.id)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Maximize"
          >
            {win.maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          {/* Close */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => closeWindow(win.id)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[oklch(0.65_0.24_25)]/30 hover:text-[oklch(0.78_0.2_20)]"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content — keyed by reloadKey so reload re-mounts the content */}
      <div key={reloadKey} className="relative min-h-0 flex-1 overflow-hidden">
        {children}
      </div>

      {/* 4-side resize handles (only in float mode, not maximized) */}
      {!isTiled && !win.maximized && (
        <>
          {/* East (right) */}
          <div
            onPointerDown={(e) => onPointerDownResize(e, "e")}
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize"
          />
          {/* West (left) */}
          <div
            onPointerDown={(e) => onPointerDownResize(e, "w")}
            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize"
          />
          {/* South (bottom) */}
          <div
            onPointerDown={(e) => onPointerDownResize(e, "s")}
            className="absolute bottom-0 left-0 h-1.5 w-full cursor-ns-resize"
          />
          {/* North (top) */}
          <div
            onPointerDown={(e) => onPointerDownResize(e, "n")}
            className="absolute top-0 left-0 h-1.5 w-full cursor-ns-resize"
          />
          {/* Corners */}
          <div onPointerDown={(e) => onPointerDownResize(e, "se")} className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize" />
          <div onPointerDown={(e) => onPointerDownResize(e, "sw")} className="absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize" />
          <div onPointerDown={(e) => onPointerDownResize(e, "ne")} className="absolute top-0 right-0 h-3 w-3 cursor-nesw-resize" />
          <div onPointerDown={(e) => onPointerDownResize(e, "nw")} className="absolute top-0 left-0 h-3 w-3 cursor-nwse-resize" />
        </>
      )}
    </motion.div>
  );
}
