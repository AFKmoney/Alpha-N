/**
 * context-menu.tsx — the OS right-click menu system.
 *
 * triggerContextMenu(e, actions) renders a global glass menu at the pointer.
 * Builders produce the action lists for files, desktop, windows and dock
 * icons. Parent items with `submenu` open a flyout on hover.
 */
"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  CornerUpRight,
  Edit3,
  ExternalLink,
  Eye,
  Layers,
  Maximize,
  Minimize2,
  MonitorDown,
  MoveHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { OSWindow, AppKind } from "@/lib/alpha/os-types";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { WALLPAPER_PRESETS } from "@/lib/alpha/wallpaper-presets";

export interface ContextMenuAction {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: ContextMenuAction[];
  active?: boolean;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

let pushMenu: ((state: MenuState) => void) | null = null;

/** Open the global context menu at the pointer position. */
export function triggerContextMenu(e: React.MouseEvent, actions: ContextMenuAction[]): void {
  e.preventDefault();
  e.stopPropagation();
  pushMenu?.({ open: true, x: e.clientX, y: e.clientY, actions });
}

const emptySubscribe = () => () => {};

export function ContextMenuProvider(): React.ReactElement {
  const [menu, setMenu] = useState<MenuState>({ open: false, x: 0, y: 0, actions: [] });
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    pushMenu = setMenu;
    const close = () => setMenu((m) => ({ ...m, open: false }));
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      pushMenu = null;
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  if (!mounted || !menu.open) return <></>;

  const clampX = Math.min(menu.x, window.innerWidth - 240);
  const clampY = Math.min(menu.y, window.innerHeight - 60 - menu.actions.length * 34);

  return createPortal(
    <div
      className="glass-strong font-mono-ae fixed z-[9999] min-w-[200px] rounded-xl p-1.5 text-xs text-zinc-200 shadow-2xl"
      style={{ left: clampX, top: clampY }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.actions.map((action, i) =>
        action.separator ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-white/8" />
        ) : (
          <MenuItem key={`act-${i}`} action={action} close={() => setMenu((m) => ({ ...m, open: false }))} />
        )
      )}
    </div>,
    document.body
  );
}

function MenuItem({ action, close }: { action: ContextMenuAction; close: () => void }): React.ReactElement {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  if (action.submenu) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left hover:bg-white/8"
        >
          <span className="flex items-center gap-2.5">
            {action.icon}
            {action.label}
          </span>
          <CornerUpRight className="h-3 w-3 opacity-50" />
        </button>
        {submenuOpen && (
          <div className="glass-strong absolute left-full top-0 z-[10000] ml-1 min-w-[190px] rounded-xl p-1.5">
            {action.submenu.map((sub, i) =>
              sub.separator ? (
                <div key={`ssep-${i}`} className="my-1 h-px bg-white/8" />
              ) : (
                <MenuItem key={`sub-${i}`} action={sub} close={close} />
              )
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={action.disabled}
      onClick={() => {
        close();
        action.onClick?.();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors ${
        action.danger ? "text-[--ae-rose] hover:bg-[--ae-rose]/15" : "hover:bg-white/8"
      } ${action.disabled ? "cursor-not-allowed opacity-40" : ""} ${action.active ? "text-[--ae-cyan]" : ""}`}
    >
      {action.icon}
      <span className="flex-1">{action.label}</span>
      {action.active && <span className="text-[10px] text-[--ae-cyan]">✓</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildFileActions(opts: {
  name: string;
  path: string;
  isDir: boolean;
  onOpen: () => void;
  onRefresh: () => void;
}): ContextMenuAction[] {
  const notifyRefresh = () => {
    window.dispatchEvent(new Event("alpha-files-refresh"));
    opts.onRefresh();
  };
  return [
    {
      label: "Open",
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      onClick: opts.onOpen,
    },
    {
      label: "Rename",
      icon: <Edit3 className="h-3.5 w-3.5" />,
      onClick: () => {
        const next = window.prompt(`Rename "${opts.name}" to:`, opts.name);
        if (!next || next === opts.name) return;
        const parent = opts.path.split("/").slice(0, -1).join("/");
        void fetch("/api/alpha/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `${parent}/${next}`.replace(/^\//, ""), content: "" }),
        }).then(() => notifyRefresh());
      },
    },
    { separator: true },
    {
      label: "New folder here",
      icon: <Layers className="h-3.5 w-3.5" />,
      onClick: () => {
        const name = window.prompt("Folder name:", "new-folder");
        if (!name) return;
        void fetch("/api/alpha/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `${opts.path}/${name}`.replace(/^\//, ""), action: "mkdir" }),
        }).then(() => notifyRefresh());
      },
    },
    {
      label: "New file here",
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: () => {
        const name = window.prompt("File name:", "untitled.ts");
        if (!name) return;
        void fetch("/api/alpha/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `${opts.path}/${name}`.replace(/^\//, ""), action: "touch" }),
        }).then(() => notifyRefresh());
      },
    },
    { separator: true },
    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onClick: () => {
        if (!window.confirm(`Delete "${opts.name}"?`)) return;
        void fetch(`/api/alpha/files?path=${encodeURIComponent(opts.path)}`, { method: "DELETE" }).then(() =>
          notifyRefresh()
        );
      },
    },
  ];
}

export function buildWindowActions(win: OSWindow): ContextMenuAction[] {
  const os = useOS.getState();
  const transparency: ContextMenuAction[] = [
    { label: "100%", onClick: () => os.setWindowOpacity(win.id, 1), active: win.opacity === 1 },
    { label: "80%", onClick: () => os.setWindowOpacity(win.id, 0.8), active: win.opacity === 0.8 },
    { label: "60%", onClick: () => os.setWindowOpacity(win.id, 0.6), active: win.opacity === 0.6 },
    { label: "40%", onClick: () => os.setWindowOpacity(win.id, 0.4), active: win.opacity === 0.4 },
  ];
  return [
    { label: win.maximized ? "Restore" : "Maximize", icon: <Maximize className="h-3.5 w-3.5" />, onClick: () => os.toggleMaximize(win.id) },
    { label: "Minimize", icon: <Minimize2 className="h-3.5 w-3.5" />, onClick: () => os.minimizeWindow(win.id) },
    {
      label: "Always on top",
      icon: <Eye className="h-3.5 w-3.5" />,
      onClick: () => os.setAlwaysOnTop(win.id, !win.onTop),
      active: win.onTop,
    },
    { separator: true },
    {
      label: "Snap left",
      icon: <MoveHorizontal className="h-3.5 w-3.5" />,
      onClick: () => os.snapWindow(win.id, "left"),
    },
    {
      label: "Snap right",
      icon: <MoveHorizontal className="h-3.5 w-3.5" />,
      onClick: () => os.snapWindow(win.id, "right"),
    },
    { separator: true },
    {
      label: "Transparency",
      icon: <Eye className="h-3.5 w-3.5" />,
      submenu: transparency,
    },
    {
      label: `Move to desktop ${win.desktop === 4 ? 1 : win.desktop + 1}`,
      icon: <MonitorDown className="h-3.5 w-3.5" />,
      onClick: () => os.moveWindowToDesktop(win.id, win.desktop === 4 ? 1 : win.desktop + 1),
    },
    { separator: true },
    { label: "Close window", icon: <X className="h-3.5 w-3.5" />, danger: true, onClick: () => os.closeWindow(win.id) },
  ];
}

export function buildDesktopActions(): ContextMenuAction[] {
  const os = useOS.getState();
  const evolution = useEvolution.getState();
  const wallpaperSub: ContextMenuAction[] = WALLPAPER_PRESETS.slice(0, 6).map((preset) => ({
    label: preset.name,
    onClick: () => {
      void fetch("/api/alpha/wallpaper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", presetId: preset.id, config: {}, name: preset.name }),
      });
      window.dispatchEvent(new CustomEvent("alpha-wallpaper-change", { detail: { presetId: preset.id } }));
    },
  }));
  return [
    { label: "Open Terminal", onClick: () => os.openApp("terminal") },
    { label: "Open Files", onClick: () => os.openApp("files") },
    { label: "Open Monitor", onClick: () => os.openApp("monitor") },
    { separator: true },
    { label: "Wallpaper", icon: <RefreshCw className="h-3.5 w-3.5" />, submenu: wallpaperSub },
    { label: "Open Wallpaper App", onClick: () => os.openApp("wallpaper") },
    { separator: true },
    { label: "Show Desktop", onClick: () => os.minimizeAll() },
    {
      label: "Ask the AI to evolve now",
      onClick: () => {
        evolution.triggerCycle();
        window.dispatchEvent(new CustomEvent("alpha-toast", { detail: { type: "info", title: "Alpha-OS", message: "Evolution cycle requested — N-Core is thinking." } }));
      },
    },
    { separator: true },
    {
      label: "Create vector here",
      onClick: () => {
        const name = window.prompt("Vector (file) name:", `vector-${Date.now() % 10_000}.md`);
        if (!name) return;
        void fetch("/api/alpha/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `vectors/${name}`, action: "touch" }),
        }).then(() => window.dispatchEvent(new Event("alpha-files-refresh")));
      },
    },
  ];
}

export function buildDockAppActions(app: { kind: AppKind; label: string }): ContextMenuAction[] {
  const os = useOS.getState();
  const pinned = os.pinnedTaskbar.includes(app.kind);
  return [
    { label: `Open ${app.label}`, onClick: () => os.openApp(app.kind) },
    {
      label: pinned ? "Unpin from taskbar" : "Pin to taskbar",
      icon: pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />,
      onClick: () => (pinned ? os.unpinFromTaskbar(app.kind) : os.pinToTaskbar(app.kind)),
    },
  ];
}
