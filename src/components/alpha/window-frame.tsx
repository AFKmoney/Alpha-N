"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Columns2, Minus, Square, X, Copy, Layers } from "lucide-react";
import { useOS, type AppWindow } from "@/lib/alpha/os-store";
import type { Rect } from "@/lib/alpha/os-types";
import { cn } from "@/lib/utils";

interface WindowFrameProps {
  win: AppWindow;
  tiledRect?: Rect; // when in tile mode, the computed rect overrides stored x/y/w/h
  children: React.ReactNode;
}

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
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const [active, setActive] = useState(false);

  const isTiled = layoutMode === "tile" && !!tiledRect;
  const rect = tiledRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };

  const onPointerDownDrag = (e: React.PointerEvent) => {
    if (isTiled || win.maximized) return;
    focusWindow(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };
    setActive(true);
    e.preventDefault();
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (isTiled || win.maximized) return;
    focusWindow(win.id);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: win.w, origH: win.h };
    setActive(true);
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        moveWindow(win.id, dragRef.current.origX + dx, dragRef.current.origY + dy);
      } else if (resizeRef.current) {
        const dw = e.clientX - resizeRef.current.startX;
        const dh = e.clientY - resizeRef.current.startY;
        resizeWindow(win.id, resizeRef.current.origW + dw, resizeRef.current.origH + dh);
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
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: win.z,
      }}
      onPointerDown={() => focusWindow(win.id)}
      data-ai-skip={win.kind === "terminal" ? undefined : "true"}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-1.5"
        onPointerDown={onPointerDownDrag}
        style={{ cursor: isTiled || win.maximized ? "default" : "grab" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isTiled ? (
            <Columns2 className="h-3 w-3 shrink-0 text-[oklch(0.82_0.17_195)]" />
          ) : (
            <span className="font-mono-ae text-xs text-[oklch(0.82_0.17_195)]">{win.icon}</span>
          )}
          <span className="truncate font-mono-ae text-[0.7rem] text-foreground/80">{win.title}</span>
          {win.desktop !== 0 && (
            <span className="flex items-center gap-0.5 rounded-full border border-border/50 px-1 py-0 font-mono-ae text-[0.5rem] text-muted-foreground">
              <Layers className="h-2 w-2" /> {win.desktop + 1}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => minimizeWindow(win.id)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Minimize"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleMaximize(win.id)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Maximize"
          >
            {win.maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => closeWindow(win.id)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-[oklch(0.65_0.24_25)]/30 hover:text-[oklch(0.78_0.2_20)]"
            aria-label="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

      {!isTiled && !win.maximized && (
        <div
          onPointerDown={onPointerDownResize}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, oklch(0.7 0.05 250 / 0.4) 50%)" }}
        />
      )}
    </motion.div>
  );
}
