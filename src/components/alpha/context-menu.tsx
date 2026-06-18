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
  FolderPlus,
  FilePlus,
  Trash2,
  Pencil,
  Pin,
  ArrowRightLeft,
  Move,
  Maximize2,
  Layers,
  Sun,
  FolderInput,
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
 *
 * AI-adaptive: includes minimize, maximize, scale (snap), reload,
 * transparency, always-on-top, move-to-desktop, and AI actions.
 */
export function buildWindowActions(
  winId: string,
  winTitle: string,
  os: ReturnType<typeof useOS.getState>,
  evolution: ReturnType<typeof useEvolution.getState>
): ContextMenuAction[] {
  const win = os.windows.find((w) => w.id === winId);
  const isMaximized = win?.maximized ?? false;
  const isOnTop = win?.alwaysOnTop ?? false;
  const currentOpacity = win?.opacity ?? 1;
  const currentSnap = win?.snapState ?? "none";
  const currentDesktop = win?.desktop ?? 0;

  const actions: ContextMenuAction[] = [];

  // ---- Window state: minimize / maximize / restore ----
  actions.push({
    label: "Minimize",
    icon: <Minus className="h-3.5 w-3.5" />,
    onClick: () => os.minimizeWindow(winId),
  });

  actions.push({
    label: isMaximized ? "Restore" : "Maximize",
    icon: <Square className="h-3.5 w-3.5" />,
    onClick: () => os.toggleMaximize(winId),
  });

  // ---- Scale: snap submenu (left/right/top/quarters) ----
  const snapSubmenu: ContextMenuAction[] = [
    { label: `Left Half${currentSnap === "left" ? "  ✓" : ""}`, icon: <Move className="h-3.5 w-3.5" />, onClick: () => os.snapWindow(winId, "left") },
    { label: `Right Half${currentSnap === "right" ? "  ✓" : ""}`, icon: <Move className="h-3.5 w-3.5" />, onClick: () => os.snapWindow(winId, "right") },
    { label: `Top (Maximize)${currentSnap === "top" ? "  ✓" : ""}`, icon: <Maximize2 className="h-3.5 w-3.5" />, onClick: () => os.snapWindow(winId, "top") },
    { label: `Bottom-Left${currentSnap === "bl" ? "  ✓" : ""}`, icon: <Move className="h-3.5 w-3.5" />, onClick: () => os.snapWindow(winId, "bl") },
    { label: `Bottom-Right${currentSnap === "br" ? "  ✓" : ""}`, icon: <Move className="h-3.5 w-3.5" />, onClick: () => os.snapWindow(winId, "br") },
  ];
  if (currentSnap !== "none") {
    snapSubmenu.push({
      label: "Unsnap (free)",
      icon: <Move className="h-3.5 w-3.5" />,
      onClick: () => os.snapWindow(winId, "none"),
    });
  }
  actions.push({
    label: "Scale (snap)",
    icon: <Maximize2 className="h-3.5 w-3.5" />,
    onClick: () => {},
    submenu: snapSubmenu,
  });

  // ---- Reload ----
  actions.push({
    label: "Reload",
    icon: <RotateCw className="h-3.5 w-3.5" />,
    onClick: () => window.dispatchEvent(new CustomEvent("alpha-reload-window", { detail: { windowId: winId } })),
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // ---- Transparency submenu ----
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

  // ---- Always on top ----
  actions.push({
    label: isOnTop ? "Disable Always-on-Top" : "Always on Top",
    icon: <Pin className="h-3.5 w-3.5" />,
    onClick: () => os.setAlwaysOnTop(winId, !isOnTop),
  });

  // ---- Move to desktop submenu ----
  const desktopSubmenu: ContextMenuAction[] = [0, 1, 2, 3].map((d) => ({
    label: `Desktop ${d + 1}${d === currentDesktop ? "  ✓" : ""}`,
    icon: <Monitor className="h-3.5 w-3.5" />,
    onClick: () => os.moveWindowToDesktop(winId, d),
  }));
  actions.push({
    label: "Move to Desktop",
    icon: <Layers className="h-3.5 w-3.5" />,
    onClick: () => {},
    submenu: desktopSubmenu,
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // ---- AI actions ----
  actions.push({
    label: "Ask AI about this",
    icon: <Brain className="h-3.5 w-3.5" />,
    onClick: () => {
      evolution.sendUserMessage(`Explain what the "${winTitle}" app is doing right now.`);
    },
  });

  actions.push({
    label: "Improve with AI",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    onClick: () => {
      evolution.sendUserMessage(`Improve the "${winTitle}" app. Analyze its current state and suggest/make improvements.`);
    },
  });

  actions.push({
    label: "Send to Chat",
    icon: <Send className="h-3.5 w-3.5" />,
    onClick: () => {
      if (!evolution.chatOpen) evolution.toggleChat();
      evolution.sendUserMessage(`I'm looking at the "${winTitle}" window. What should I know about it?`);
    },
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // ---- Close ----
  actions.push({
    label: "Close",
    icon: <X className="h-3.5 w-3.5" />,
    onClick: () => os.closeWindow(winId),
    danger: true,
  });

  return actions;
}

/**
 * Fire a toast notification via the global alpha-toast event.
 * Any component can call this — the ToastSystem component listens.
 */
function toast(type: "success" | "error" | "info" | "warning", title: string, message?: string): void {
  window.dispatchEvent(new CustomEvent("alpha-toast", { detail: { type, title, message } }));
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
    toast("success", "Wallpaper changed", name);
  }).catch(() => {
    toast("error", "Wallpaper change failed");
  });
}

/**
 * Create a sector (directory) at the given relative path via the files API.
 * Fires a toast and dispatches alpha-files-refresh so the Files app re-lists.
 */
function createSector(relPath: string): void {
  void fetch("/api/alpha/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: relPath, action: "mkdir" }),
  }).then((r) => r.json()).then((data) => {
    if (data.ok) {
      toast("success", "Sector created", relPath);
      window.dispatchEvent(new CustomEvent("alpha-files-refresh"));
    } else {
      toast("error", "Sector creation failed", data.error);
    }
  }).catch(() => toast("error", "Sector creation failed"));
}

/**
 * Create a vector (empty file) at the given relative path via the files API.
 */
function createVector(relPath: string): void {
  void fetch("/api/alpha/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: relPath, action: "touch" }),
  }).then((r) => r.json()).then((data) => {
    if (data.ok) {
      toast("success", "Vector created", relPath);
      window.dispatchEvent(new CustomEvent("alpha-files-refresh"));
    } else {
      toast("error", "Vector creation failed", data.error);
    }
  }).catch(() => toast("error", "Vector creation failed"));
}

/**
 * Prompt the user for a name (simple browser prompt) — used by create
 * sector/vector and rename actions. Returns null if cancelled.
 */
function promptName(defaultName: string, title: string): string | null {
  if (typeof window === "undefined") return null;
  return window.prompt(title, defaultName);
}

/**
 * Build the desktop (empty area) context menu actions.
 * This is the AI-adaptive desktop right-click: create sectors/vectors,
 * open apps, change wallpaper, show desktop, and trigger AI actions.
 */
export function buildDesktopActions(
  os: ReturnType<typeof useOS.getState>,
  evolution?: ReturnType<typeof useEvolution.getState>
): ContextMenuAction[] {
  // First 6 wallpaper presets — quick-picker submenu.
  const wallpaperSubmenu: ContextMenuAction[] = WALLPAPER_PRESETS.slice(0, 6).map(
    (p) => ({
      label: p.name,
      icon: <span className="font-mono-ae text-xs">◐</span>,
      onClick: () => applyWallpaperPreset(p.id, p.name),
    })
  );

  const actions: ContextMenuAction[] = [];

  // ---- New: create sector / vector ----
  actions.push({
    label: "New Sector",
    icon: <FolderPlus className="h-3.5 w-3.5" />,
    onClick: () => {
      const name = promptName("new-sector", "Sector name:");
      if (name) createSector(name.replace(/\s+/g, "-"));
    },
  });
  actions.push({
    label: "New Vector",
    icon: <FilePlus className="h-3.5 w-3.5" />,
    onClick: () => {
      const name = promptName("new-vector.txt", "Vector name:");
      if (name) createVector(name.replace(/\s+/g, "-"));
    },
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // ---- Open apps ----
  actions.push({
    label: "Open Terminal",
    icon: <span className="font-mono-ae text-sm">▸_</span>,
    onClick: () => os.openApp("terminal"),
  });
  actions.push({
    label: "Open Code Editor",
    icon: <span className="font-mono-ae text-sm">{`{}`}</span>,
    onClick: () => os.openApp("realcode"),
  });
  actions.push({
    label: "Open Files",
    icon: <span className="font-mono-ae text-sm">▣</span>,
    onClick: () => os.openApp("files"),
  });
  actions.push({
    label: "Open Browser",
    icon: <span className="font-mono-ae text-sm">◉</span>,
    onClick: () => os.openApp("browser"),
  });

  actions.push({ label: "", icon: null, onClick: () => {}, separator: true });

  // ---- Wallpaper submenu ----
  actions.push({
    label: "Change Wallpaper",
    icon: <span className="font-mono-ae text-sm">◐</span>,
    onClick: () => os.openApp("wallpaper"),
    submenu: wallpaperSubmenu,
  });

  // ---- Theme toggle ----
  actions.push({
    label: os.theme === "dark" ? "Light Theme" : "Dark Theme",
    icon: <Sun className="h-3.5 w-3.5" />,
    onClick: () => os.toggleTheme(),
  });

  // ---- Show desktop ----
  actions.push({
    label: "Show Desktop",
    icon: <Minus className="h-3.5 w-3.5" />,
    onClick: () => os.minimizeAll(),
  });

  // ---- AI actions (only if evolution store is available) ----
  if (evolution) {
    actions.push({ label: "", icon: null, onClick: () => {}, separator: true });
    actions.push({
      label: "Ask AI to organize",
      icon: <Brain className="h-3.5 w-3.5" />,
      onClick: () => {
        evolution.sendUserMessage("Analyze the desktop and suggest how I should organize my workspace. What apps should I open and how should I arrange them?");
      },
    });
    actions.push({
      label: "AI: improve this OS",
      icon: <Sparkles className="h-3.5 w-3.5" />,
      onClick: () => {
        evolution.sendUserMessage("Look at the current desktop state and propose an improvement you can make right now. Then make it.");
      },
    });
  }

  return actions;
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
      label: "Maximize",
      icon: <Maximize2 className="h-3.5 w-3.5" />,
      onClick: () => os.toggleMaximize(openWin.id),
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

/**
 * Build the file/sector context menu actions for the Files app.
 * Provides rename, delete, move, copy, and open-with actions for
 * vectors (files) and sectors (directories).
 *
 * @param entryName  — the name of the file/sector
 * @param entryPath  — the full relative path
 * @param isDir      — true if this is a sector (directory)
 * @param onOpen     — callback to open/navigate into the entry
 * @param onRefresh  — callback to refresh the listing after mutations
 */
export function buildFileActions(opts: {
  name: string;
  path: string;
  isDir: boolean;
  onOpen: () => void;
  onRefresh: () => void;
}): ContextMenuAction[] {
  const { name, path, isDir, onOpen, onRefresh } = opts;

  const deleteEntry = () => {
    void fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast("success", `${isDir ? "Sector" : "Vector"} deleted`, name);
          onRefresh();
        } else {
          toast("error", "Delete failed", data.error);
        }
      })
      .catch(() => toast("error", "Delete failed"));
  };

  const renameEntry = () => {
    const newName = promptName(name, `Rename ${isDir ? "sector" : "vector"}:`);
    if (!newName || newName === name) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const newPath = parent ? `${parent}/${newName}` : newName;
    void fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", from: path, to: newPath }),
    }).then((r) => r.json()).then((data) => {
      if (data.ok) {
        toast("success", "Renamed", `${name} → ${newName}`);
        onRefresh();
      } else {
        toast("error", "Rename failed", data.error);
      }
    }).catch(() => toast("error", "Rename failed"));
  };

  const moveEntry = () => {
    const dest = promptName("", `Move "${name}" to (relative path):`);
    if (!dest) return;
    const newPath = `${dest.replace(/\/$/, "")}/${name}`;
    void fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", from: path, to: newPath }),
    }).then((r) => r.json()).then((data) => {
      if (data.ok) {
        toast("success", "Moved", `${name} → ${newPath}`);
        onRefresh();
      } else {
        toast("error", "Move failed", data.error);
      }
    }).catch(() => toast("error", "Move failed"));
  };

  const copyEntry = () => {
    const dest = promptName("", `Copy "${name}" to (relative path):`);
    if (!dest) return;
    const newPath = `${dest.replace(/\/$/, "")}/${name}`;
    void fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "copy", from: path, to: newPath }),
    }).then((r) => r.json()).then((data) => {
      if (data.ok) {
        toast("success", "Copied", `${name} → ${newPath}`);
        onRefresh();
      } else {
        toast("error", "Copy failed", data.error);
      }
    }).catch(() => toast("error", "Copy failed"));
  };

  return [
    {
      label: isDir ? "Open Sector" : "Open Vector",
      icon: <span className="font-mono-ae text-sm">{isDir ? "▸" : "·"}</span>,
      onClick: onOpen,
    },
    { label: "", icon: null, onClick: () => {}, separator: true },
    {
      label: "Rename",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: renameEntry,
    },
    {
      label: "Move to…",
      icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
      onClick: moveEntry,
    },
    {
      label: "Copy to…",
      icon: <FolderInput className="h-3.5 w-3.5" />,
      onClick: copyEntry,
    },
    { label: "", icon: null, onClick: () => {}, separator: true },
    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: deleteEntry,
      danger: true,
    },
  ];
}
