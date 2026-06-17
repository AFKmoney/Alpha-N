"use client";

import { useEffect, useRef, useState } from "react";
import { useOS } from "@/lib/alpha/os-store";
import type { SplitHandle } from "@/lib/alpha/os-types";
import { cn } from "@/lib/utils";

interface SplitHandleBarProps {
  handle: SplitHandle;
  desktop: number;
}

/**
 * SplitHandleBar — the draggable gap between two tiled windows.
 * Dragging it changes the split ratio, which resizes BOTH neighbors
 * (one grows, the other shrinks). This is the core "resize one affects
 * others" behavior of a tiling window manager.
 */
export function SplitHandleBar({ handle, desktop }: SplitHandleBarProps) {
  const { viewport, setSplitRatio } = useOS();
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (handle.orientation === "v") {
        // vertical bar → adjusts horizontal split (ratio of x position)
        const ratio = (e.clientX - viewport.x) / viewport.w;
        setSplitRatio(desktop, handle.index, ratio);
      } else {
        // horizontal bar → adjusts vertical split within the stack
        // the stack starts at 50% of width; ratio is within the stack's height
        const ratio = (e.clientY - viewport.y) / viewport.h;
        setSplitRatio(desktop, handle.index, ratio);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, handle.orientation, handle.index, desktop, viewport, setSplitRatio]);

  const isVertical = handle.orientation === "v";

  return (
    <div
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "absolute z-[60] flex items-center justify-center",
        isVertical ? "cursor-col-resize" : "cursor-row-resize"
      )}
      style={{
        left: handle.x,
        top: handle.y,
        width: handle.w,
        height: handle.h,
      }}
    >
      {/* the visual bar */}
      <div
        className={cn(
          "rounded-full transition-all",
          isVertical ? "h-full w-[2px]" : "h-[2px] w-full",
          hover || dragging
            ? "bg-[oklch(0.82_0.17_195)] shadow-[0_0_8px_oklch(0.82_0.17_195/0.7)]"
            : "bg-border/60"
        )}
      />
      {/* a wider invisible hit area */}
      <div
        className={cn(
          "absolute",
          isVertical ? "inset-y-0 -inset-x-1" : "inset-x-0 -inset-y-1"
        )}
      />
    </div>
  );
}
