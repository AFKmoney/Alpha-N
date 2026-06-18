/**
 * context-menu.tsx — the global right-click menu system for Alpha-OS.
 * Exposes the ContextMenu overlay component plus builder helpers for the
 * standard window / desktop / dock action sets.
 *
 * SA3-WINDOW-OS additions:
 * - Submenu support (hover-to-open flyout) so the desktop right-click can
 *   surface a wallpaper picker and the window right-click can surface a
 *   transparency picker without overflowing the top-level menu.
 * - buildDesktopActions now includes a "Change Wallpaper" submenu showing
 *   the first 6 wallpaper presets; clicking one POSTs to /api/alpha/wallpaper
 *   and dispatches alpha-wallpaper-change so the desktop updates instantly.
 * - buildWindowActions now includes a "Transparency" submenu with 4 opacity
 *   presets that call setWindowOpacity on the os-store.
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Minus,
  Square,
  X,
  Brain,
  Sparkles,
  Send,
  Monitor,
  RotateCw,
  Copy,
  ChevronRight,
} from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import type { AppKind } from "@/lib/alpha/os-types";
import { WALLPAPER_PRESETS } from "@/lib/alpha/wallpaper-presets";
import { cn } from "@/lib/utils";

/**
 * ContextMenuItem — represents a single action in the right-click menu.
 * A `submenu` (non-empty array) renders the item as a parent with a
 * hover-to-open flyout containing the child actions.
 */
interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
  /** Optional submenu flyout (rendered on hover). Parent onClick is unused. */
  submenu?: ContextMenuAction[];
}

/**
 * ContextMenu — a floating, adaptive right-click context menu.
 *
 * Appears at the cursor position. Automatically adjusts if it would
 * overflow the viewport edge. Closes on click-outside or Escape.
 *
 * This component is controlled by a global event system: any component
 * can trigger it by dispatching a `alpha-context-menu` CustomEvent
 * with { x, y, actions } in the detail.
 */
export function ContextMenu() {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    actions: ContextMenuAction[];
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Index of the action whose submenu is currently open (hover). */
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  const show = useCallback((x: number, y: number, actions: ContextMenuAction[]) => {
    // Adjust position to prevent viewport overflow
    const adjustedX = x + 200 > window.innerWidth ? x - 200 : x;
    const adjustedY = y + (actions.length * 36) > window.innerHeight ? y - (actions.length * 36) : y;
    setMenu({ x: adjustedX, y: adjustedY, actions });
    setOpenSubmenu(null);
  }, []);

  const hide = useCallback(() => {
    setMenu(null);
    setOpenSubmenu(null);
  }, []);

  useEffect(() => {
    const onContextMenu = (e: CustomEvent) => {
      e.preventDefault();
      const { x, y, actions } = e.detail;
      show(x, y, actions);
    };

    const onNativeContext = (e: MouseEvent) => {
      // Prevent the browser's default right-click menu
      e.preventDefault();
    };

    const onClickAway = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    window.addEventListener("alpha-context-menu", onContextMenu as EventListener);
    window.addEventListener("contextmenu", onNativeContext);
    window.addEventListener("mousedown", onClickAway);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("alpha-context-menu", onContextMenu as EventListener);
      window.removeEventListener("contextmenu", onNativeContext);
      window.removeEventListener("mousedown", onClickAway);
      window.removeEventListener("keydown", onEscape);
    };
  }, [show, hide]);

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.12 }}
          className="glass-strong fixed z-[100] min-w-[200px] overflow-visible rounded-xl border border-border/60 p-1.5 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.actions.map((action, i) => (
            <div key={i} className="relative">
              {action.separator && <div className="my-1 h-px bg-border/40" />}
              <button
                onClick={() => {
                  // Only fire onClick for leaf items — parents with submenus
                  // toggle their flyout via hover, not click.
                  if (!action.submenu || action.submenu.length === 0) {
                    action.onClick();
                    hide();
                  }
                }}
                onMouseEnter={() => {
                  if (action.submenu && action.submenu.length > 0) {
                    setOpenSubmenu(i);
                  } else {
                    setOpenSubmenu(null);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-mono-ae text-xs transition-colors",
                  action.danger
                    ? "text-[oklch(0.78_0.2_20)] hover:bg-[oklch(0.65_0.24_25)]/15"
                    : "text-foreground/80 hover:bg-foreground/[0.08]"
                )}
              >
                <span className={cn(action.danger && "text-[oklch(0.78_0.2_20)]")}>{action.icon}</span>
                <span className="flex-1">{action.label}</span>
                {action.submenu && action.submenu.length > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </button>

              {/* ---- Submenu flyout ---- */}
              {action.submenu && action.submenu.length > 0 && openSubmenu === i && (
                <div
                  className="glass-strong absolute left-full top-0 z-[101] ml-1 min-w-[180px] overflow-visible rounded-xl border border-border/60 p-1.5 shadow-2xl"
                  // Keep the submenu open while the cursor is over the parent
                  // OR over the flyout itself. onMouseLeave on the parent
                  // already sets openSubmenu=null when the cursor leaves to
                  // a non-parent item; this wrapper just stops the
                  // click-away handler from firing on flyout interactions.
                  onMouseEnter={() => setOpenSubmenu(i)}
                  onMouseLeave={() => setOpenSubmenu(null)}
                >
                  {action.submenu.map((sub, j) => (
                    <div key={j}>
                      {sub.separator && <div className="my-1 h-px bg-border/40" />}
                      <button
                        onClick={() => {
                          sub.onClick();
                          hide();
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-mono-ae text-xs transition-colors",
                          sub.danger
                            ? "text-[oklch(0.78_0.2_20)] hover:bg-[oklch(0.65_0.24_25)]/15"
                            : "text-foreground/80 hover:bg-foreground/[0.08]"
                        )}
                      >
                        <span className={cn(sub.danger && "text-[oklch(0.78_0.2_20)]")}>{sub.icon}</span>
                        <span>{sub.label}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Helper to trigger the context menu from any component.
 * Usage:
 *   onContextMenu={(e) => showWindowContextMenu(e, win, { closeWindow, minimizeWindow, ... })}
 */
export function triggerContextMenu(
  e: React.MouseEvent,
  actions: ContextMenuAction[]
) {
  e.preventDefault();
  e.stopPropagation();
  window.dispatchEvent(
    new CustomEvent("alpha-context-menu", {
      detail: { x: e.clientX, y: e.clientY, actions },
    })
  );
}

/**
 * Build the standard window context menu actions.
 * Used by WindowFrame's onContextMenu handler.
 */
export function buildWindowActions(
  winId: string,
  winTitle: string,
  os: ReturnType<typeof useOS.getState>,
  evolution: ReturnType<typeof useEvolution.getState>
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];

  // Minimize
  actions.push({
    label: "Minimize",
    icon: <Minus className="h-3.5 w-3.5" />,
    onClick: () => os.minimizeWindow(winId),
  });

  // Maximize / Restore
  actions.push({
    label: os.windows.find((w) => w.id === winId)?.maximized ? "Restore" : "Maximize",
    icon: <Square className="h-3.5 w-3.5" />,
    onClick: () => os.toggleMaximize(winId),
  });

  // Reload (dispatches a custom event the WindowFrame listens for)
  actions.push({
    label: "Reload",
    icon: <RotateCw className="h-3.5 w-3.5" />,
    onClick: () => window.dispatchEvent(new CustomEvent("alpha-reload-window", { detail: { windowId: winId } })),
  });

  // ---- SA3-WINDOW-OS: Transparency submenu ----
  const currentOpacity = os.windows.find((w) => w.id === winId)?.opacity ?? 1;
  actions.push({
    label: "Transparency",
    icon: <Copy className="h-3.5 w-3.5" />,
    onClick: () => {},
    submenu: [
      { label: `100%${currentOpacity === 1 ? "  ✓" : ""}`, icon: <span className="font-mono-ae text-xs">▪</span>, onClick: () => os.setWindowOpacity(winId, 1) },
      { label: `80%${currentOpacity > 0.79 && currentOpacity < 0.81 ? "  ✓" : ""}`, icon: <span className="font-mono-ae text-xs">▫</span>, onClick: () => os.setWindowOpacity(winId, 0.8) },
      { label: `60%${currentOpacity > 0.59 && currentOpacity < 0.61 ? "  ✓" : ""}`, icon: <span className="font-mono-ae text-xs">◦</span>, onClick: () => os.setWindowOpacity(winId, 0.6) },
      { label: `40%${currentOpacity > 0.39 && currentOpacity < 0.41 ? "  ✓" : ""}`, icon: <span className="font-mono-ae text-xs">·</span>, onClick: () => os.setWindowOpacity(winId, 0.4) },
    ],
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // Ask AI — explain what this window does
  actions.push({
    label: "Ask AI about this",
    icon: <Brain className="h-3.5 w-3.5" />,
    onClick: () => {
      evolution.sendUserMessage(`Explain what the "${winTitle}" app is doing right now.`);
    },
  });

  // Improve with AI — suggest an improvement
  actions.push({
    label: "Improve with AI",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    onClick: () => {
      evolution.sendUserMessage(`Improve the "${winTitle}" app. Analyze its current state and suggest/make improvements.`);
    },
  });

  // Send to chat — opens chat with context about this window
  actions.push({
    label: "Send to Chat",
    icon: <Send className="h-3.5 w-3.5" />,
    onClick: () => {
      if (!evolution.chatOpen) evolution.toggleChat();
      evolution.sendUserMessage(`I'm looking at the "${winTitle}" window. What should I know about it?`);
    },
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // Add to desktop (if on another desktop, move to current)
  actions.push({
    label: "Move to this desktop",
    icon: <Monitor className="h-3.5 w-3.5" />,
    onClick: () => os.moveWindowToDesktop(winId, os.activeDesktop),
  });

  // Close
  actions.push({
    label: "Close",
    icon: <X className="h-3.5 w-3.5" />,
    onClick: () => os.closeWindow(winId),
    danger: true,
  });

  return actions;
}

/**
 * Apply a wallpaper preset by POSTing to the wallpaper API and dispatching
 * the alpha-wallpaper-change event so the desktop canvas swaps instantly.
 */
function applyWallpaperPreset(presetId: string, name: string): void {
  const wallpaper = { presetId, config: {}, name };
  void fetch("/api/alpha/wallpaper", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "set", presetId, config: {}, name }),
  }).then((r) => {
    if (!r.ok) return;
    // Notify the desktop background canvas to switch presets immediately.
    window.dispatchEvent(new CustomEvent("alpha-wallpaper-change", { detail: wallpaper }));
  }).catch(() => {
    // Swallow — the desktop just won't swap until next reload.
  });
}

/**
 * Build the desktop (empty area) context menu actions.
 */
export function buildDesktopActions(
  os: ReturnType<typeof useOS.getState>
): ContextMenuAction[] {
  // First 6 wallpaper presets — quick-picker submenu.
  const wallpaperSubmenu: ContextMenuAction[] = WALLPAPER_PRESETS.slice(0, 6).map(
    (p) => ({
      label: p.name,
      icon: <span className="font-mono-ae text-xs">◐</span>,
      onClick: () => applyWallpaperPreset(p.id, p.name),
    })
  );

  return [
    {
      label: "Open Terminal",
      icon: <span className="font-mono-ae text-sm">▸_</span>,
      onClick: () => os.openApp("terminal"),
    },
    {
      label: "Open Code Editor",
      icon: <span className="font-mono-ae text-sm">{`{}`}</span>,
      onClick: () => os.openApp("realcode"),
    },
    {
      label: "Open Browser",
      icon: <span className="font-mono-ae text-sm">◉</span>,
      onClick: () => os.openApp("browser"),
    },
    {
      label: "Open App Repository",
      icon: <span className="font-mono-ae text-sm">⊞</span>,
      onClick: () => os.openApp("repository"),
    },
    {
      label: "",
      icon: null,
      onClick: () => {},
      separator: true,
    },
    // ---- SA3-WINDOW-OS: Quick wallpaper picker submenu (first 6 presets) ----
    {
      label: "Change Wallpaper",
      icon: <span className="font-mono-ae text-sm">◐</span>,
      onClick: () => os.openApp("wallpaper"),
      submenu: wallpaperSubmenu,
    },
    {
      label: "",
      icon: null,
      onClick: () => {},
      separator: true,
    },
    // ---- SA3-WINDOW-OS: Show desktop (minimize all) shortcut ----
    {
      label: "Show Desktop",
      icon: <Minus className="h-3.5 w-3.5" />,
      onClick: () => os.minimizeAll(),
    },
  ];
}

/**
 * Build the dock app context menu actions.
 */
export function buildDockAppActions(
  kind: string,
  label: string,
  os: ReturnType<typeof useOS.getState>
): ContextMenuAction[] {
  const isOpen = os.windows.some((w) => w.kind === kind && !w.minimized);
  const openWin = os.windows.find((w) => w.kind === kind);

  const actions: ContextMenuAction[] = [];

  if (isOpen && openWin) {
    actions.push({
      label: "Focus",
      icon: <Square className="h-3.5 w-3.5" />,
      onClick: () => os.focusWindow(openWin.id),
    });
    actions.push({
      label: "Minimize",
      icon: <Minus className="h-3.5 w-3.5" />,
      onClick: () => os.minimizeWindow(openWin.id),
    });
    actions.push({
      label: "Close",
      icon: <X className="h-3.5 w-3.5" />,
      onClick: () => os.closeWindow(openWin.id),
      danger: true,
    });
  } else {
    actions.push({
      label: `Open ${label}`,
      icon: <Square className="h-3.5 w-3.5" />,
      onClick: () => os.openApp(kind as AppKind),
    });
  }

  return actions;
}
