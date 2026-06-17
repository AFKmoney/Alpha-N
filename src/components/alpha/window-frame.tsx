"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Minus, Square, X, Copy } from "lucide-react";
import { useOS, type AppWindow } from "@/lib/alpha/os-store";
import { cn } from "@/lib/utils";

interface WindowFrameProps {
  win: AppWindow;
  children: React.ReactNode;
}

export function WindowFrame({ win, children }: WindowFrameProps) {
  const { focusWindow, closeWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow } = useOS();
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDownDrag = (e: React.PointerEvent) => {
    if (win.maximized) return;
    focusWindow(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };
    setActive(true);
    e.preventDefault();
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (win.maximized) return;
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
        resizeWindow(
          win.id,
          Math.max(280, resizeRef.current.origW + dw),
          Math.max(200, resizeRef.current.origH + dh)
        );
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={cn("glass absolute flex flex-col overflow-hidden rounded-xl")}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDown={() => focusWindow(win.id)}
      data-ai-skip={win.kind === "terminal" ? undefined : "true"}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-1.5"
        onPointerDown={onPointerDownDrag}
        style={{ cursor: win.maximized ? "default" : "grab" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono-ae text-xs text-[oklch(0.82_0.17_195)]">{win.icon}</span>
          <span className="truncate font-mono-ae text-[0.7rem] text-foreground/80">{win.title}</span>
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

      {!win.maximized && (
        <div
          onPointerDown={onPointerDownResize}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ background: "linear-gradient(135deg, transparent 50%, oklch(0.7 0.05 250 / 0.4) 50%)" }}
        />
      )}
    </motion.div>
  );
}
