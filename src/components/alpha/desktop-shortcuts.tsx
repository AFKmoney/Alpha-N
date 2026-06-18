/**
 * desktop-shortcuts.tsx — renders pinnable app icons on the desktop.
 * Each shortcut is a draggable icon (like Windows desktop icons).
 * Double-click to open the app, right-click for context menu (pin/unpin/remove).
 *
 * Part of the OS-killer taskbar/desktop rework: the dock stays minimal, and
 * most apps live on the desktop as shortcuts that the user can arrange.
 */
"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useOS } from "@/lib/alpha/os-store";
import type { DesktopShortcut } from "@/lib/alpha/os-types";
import {
  triggerContextMenu,
  buildDesktopShortcutActions,
} from "@/components/alpha/context-menu";
import { cn } from "@/lib/utils";

export function DesktopShortcuts() {
  const { desktopShortcuts, openApp, moveDesktopShortcut } = useOS();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Start dragging a shortcut (stores the offset so the icon doesn't jump). */
  const startDrag = (e: React.MouseEvent, sc: DesktopShortcut) => {
    // Only start drag on left-click (button 0)
    if (e.button !== 0) return;
    setDraggingId(sc.id);
    dragOffset.current = { x: e.clientX - sc.x, y: e.clientY - sc.y };
  };

  /** Handle drag move — updates the shortcut position in real time. */
  const onDragMove = (e: React.MouseEvent) => {
    if (!draggingId) return;
    const x = e.clientX - dragOffset.current.x;
    const y = e.clientY - dragOffset.current.y;
    // Clamp to viewport (keep icon fully visible)
    const clampedX = Math.max(4, Math.min(window.innerWidth - 80, x));
    const clampedY = Math.max(4, Math.min(window.innerHeight - 100, y));
    moveDesktopShortcut(draggingId, clampedX, clampedY);
  };

  /** End dragging. */
  const endDrag = () => {
    setDraggingId(null);
  };

  if (desktopShortcuts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      data-ai-skip="true"
      onMouseMove={onDragMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {desktopShortcuts.map((sc) => (
        <motion.div
          key={sc.id}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-auto absolute flex w-20 select-none flex-col items-center gap-1"
          style={{ left: sc.x, top: sc.y }}
          onMouseDown={(e) => startDrag(e, sc)}
          onDoubleClick={() => openApp(sc.kind, sc.data ? { data: sc.data } : undefined)}
          onContextMenu={(e) => {
            triggerContextMenu(
              e,
              buildDesktopShortcutActions(sc.id, sc.kind, sc.label, useOS.getState())
            );
          }}
        >
          {/* Icon tile */}
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl border backdrop-blur transition-all",
              "border-border/40 bg-card/40 hover:border-[oklch(0.82_0.17_195)]/40 hover:bg-card/60",
              draggingId === sc.id && "cursor-grabbing border-[oklch(0.82_0.17_195)]/60",
              draggingId !== sc.id && "cursor-grab"
            )}
          >
            <span className="font-mono-ae text-xl text-foreground/80">
              {sc.icon}
            </span>
          </div>
          {/* Label */}
          <span className="max-w-[72px] truncate text-center font-mono-ae text-[0.62rem] text-foreground/70">
            {sc.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
