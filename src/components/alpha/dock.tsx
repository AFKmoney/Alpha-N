/**
 * dock.tsx — bottom-edge floating launcher that appears on mouse proximity.
 * Mirrors the macOS dock pattern: hidden by default, slides in when the
 * cursor approaches the bottom of the screen. Also exposes DockHint
 * (a small persistent tab inviting the user toward the dock).
 *
 * SA3-WINDOW-OS additions:
 * - Minimized-windows section (right side, divider-separated). Clicking a
 *   minimized window's icon restores + focuses it.
 * - Theme toggle button (sun/moon) that switches the entire OS into a
 *   light variant via injected CSS overrides.
 * - Global keyboard shortcuts for window management (Alt+Tab, Alt+F4,
 *   Cmd+W, Win+Arrow, Win+D, Ctrl+1..4) wired here because Dock is a
 *   singleton component that is always mounted.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS, getDockApp } from "@/lib/alpha/os-types";
import { triggerContextMenu, buildDockAppActions } from "@/components/alpha/context-menu";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

/**
 * Light-theme CSS overrides. Injected once on mount; toggled by setting
 * data-theme="light" on the <html> element. Deliberately minimal — just
 * enough to give the OS a usable light variant without forking globals.css.
 */
const LIGHT_THEME_CSS = `
:root[data-theme="light"] {
  --background: oklch(0.97 0.005 250);
  --foreground: oklch(0.18 0.02 265);
  --card: oklch(0.95 0.008 250 / 0.85);
  --card-foreground: oklch(0.18 0.02 265);
  --popover: oklch(0.97 0.008 250 / 0.96);
  --popover-foreground: oklch(0.15 0.02 265);
  --secondary: oklch(0.9 0.01 250);
  --secondary-foreground: oklch(0.2 0.02 265);
  --muted: oklch(0.9 0.01 250 / 0.7);
  --muted-foreground: oklch(0.42 0.02 265);
  --accent: oklch(0.85 0.04 290);
  --accent-foreground: oklch(0.18 0.02 265);
  --border: oklch(0.35 0.02 265 / 0.18);
  --input: oklch(0.35 0.02 265 / 0.18);
  --sidebar: oklch(0.95 0.008 250 / 0.9);
  --sidebar-foreground: oklch(0.18 0.02 265);
}
[data-theme="light"] .glass {
  background: linear-gradient(135deg, oklch(0.97 0.01 250 / 0.78), oklch(0.9 0.008 250 / 0.88));
  border: 1px solid oklch(0.3 0.02 265 / 0.16);
  box-shadow: inset 0 1px 0 0 oklch(1 0 0 / 0.4), 0 18px 40px -18px oklch(0.3 0.02 265 / 0.3);
}
[data-theme="light"] .glass-strong {
  background: linear-gradient(135deg, oklch(0.97 0.012 250 / 0.95), oklch(0.88 0.008 250 / 0.98));
  border: 1px solid oklch(0.3 0.02 265 / 0.22);
}
`;

export function Dock() {
  const {
    openApp,
    windows,
    focusWindow,
    theme,
    toggleTheme,
    activeDesktop,
    taskbarPinned,
  } = useOS();
  const { toggleChat, chatOpen, toggleSynapse, synapseOpen } = useEvolution();
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show dock when mouse near the bottom of the screen
  useEffect(() => {
    const onMove = (e: MouseEvent | Touch) => {
      const y = e.clientY;
      const h = window.innerHeight;
      // trigger zone: bottom 60px
      if (y > h - 60) {
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
        setVisible(true);
      } else if (y < h - 120) {
        // hide when mouse moves well away
        if (!hideTimer.current) {
          hideTimer.current = setTimeout(() => setVisible(false), 400);
        }
      }
    };
    const onMouse = (e: MouseEvent) => onMove(e);
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0]);
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("touchmove", onTouch);
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // ---- SA3-WINDOW-OS: Theme CSS injection + data-theme attribute sync ----
  useEffect(() => {
    // Inject the light-theme stylesheet once.
    let styleEl = document.getElementById("alpha-theme-overrides") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "alpha-theme-overrides";
      styleEl.textContent = LIGHT_THEME_CSS;
      document.head.appendChild(styleEl);
    }
    // Apply the current theme to <html>.
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [theme]);

  // ---- SA3-WINDOW-OS: Global keyboard shortcuts for window management ----
  // Dock is a singleton always-mounted component, so this listener is registered once.
  useEffect(() => {
    const isMac = typeof navigator !== "undefined" &&
      navigator.platform.toLowerCase().includes("mac");

    const onKey = (e: KeyboardEvent) => {
      const os = useOS.getState();

      // Alt+Tab — cycle focus through windows on the active desktop
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const visible = os.windows.filter(
          (w) => w.desktop === os.activeDesktop && !w.minimized
        );
        if (visible.length < 2) return;
        const sorted = [...visible].sort((a, b) => a.z - b.z);
        const idx = sorted.findIndex((w) => w.id === os.activeWindowId);
        const next = sorted[(idx + 1) % sorted.length];
        if (next) os.focusWindow(next.id);
        return;
      }

      // Alt+F4 or Cmd+W — close the active window
      const cmdW = isMac ? e.metaKey && !e.altKey && (e.key === "w" || e.key === "W")
        : e.metaKey && !e.altKey && (e.key === "w" || e.key === "W");
      if ((e.altKey && e.key === "F4") || cmdW) {
        if (os.activeWindowId) {
          e.preventDefault();
          os.closeWindow(os.activeWindowId);
        }
        return;
      }

      // Win+Arrow (skip on mac — Cmd+Arrow is text navigation)
      if (!isMac && e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === "ArrowLeft" && os.activeWindowId) {
          e.preventDefault();
          os.snapWindow(os.activeWindowId, "left");
          return;
        }
        if (e.key === "ArrowRight" && os.activeWindowId) {
          e.preventDefault();
          os.snapWindow(os.activeWindowId, "right");
          return;
        }
        if (e.key === "ArrowUp" && os.activeWindowId) {
          e.preventDefault();
          os.toggleMaximize(os.activeWindowId);
          return;
        }
        // Win+D — minimize all (show desktop)
        if (e.key === "d" || e.key === "D") {
          e.preventDefault();
          os.minimizeAll();
          return;
        }
      }

      // Ctrl+1..4 — switch virtual desktop
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 4) {
          e.preventDefault();
          os.setActiveDesktop(num - 1);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Only show minimized windows that live on the active desktop (so the user
  // can restore them without first switching desktops).
  const minimizedOnDesktop = windows.filter(
    (w) => w.minimized && w.desktop === activeDesktop
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="pointer-events-auto fixed inset-x-0 bottom-2 z-40 flex justify-center"
          data-ai-skip="true"
          onMouseEnter={() => {
            if (hideTimer.current) {
              clearTimeout(hideTimer.current);
              hideTimer.current = null;
            }
          }}
          onMouseLeave={() => {
            hideTimer.current = setTimeout(() => setVisible(false), 400);
          }}
        >
          <div className="glass-strong flex max-w-[96vw] items-end gap-1.5 overflow-x-auto rounded-2xl border border-border/60 px-2.5 py-1.5 shadow-2xl scroll-ae">
            {taskbarPinned.map((kind) => {
              const app = getDockApp(kind);
              if (!app) return null;
              const open = windows.filter((w) => w.kind === app.kind && !w.minimized);
              return (
                <motion.button
                  key={app.kind}
                  whileHover={{ y: -6, scale: 1.12 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    if (open.length > 0) {
                      focusWindow(open[open.length - 1].id);
                    } else {
                      openApp(app.kind);
                    }
                  }}
                  onContextMenu={(e) => {
                    triggerContextMenu(e, buildDockAppActions(app.kind, app.label, useOS.getState()));
                  }}
                  className="group relative flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-transparent transition-colors hover:border-[oklch(0.82_0.17_195)]/30 hover:bg-foreground/[0.06]"
                  title={app.label}
                >
                  <span className="font-mono-ae text-sm text-foreground/70 group-hover:text-[oklch(0.82_0.17_195)]">
                    {app.icon}
                  </span>
                  <span className="absolute -top-7 hidden whitespace-nowrap rounded-md border border-border/60 bg-popover/90 px-1.5 py-0.5 font-mono-ae text-[0.6rem] text-foreground backdrop-blur group-hover:block">
                    {app.label}
                  </span>
                  {open.length > 0 && (
                    <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[oklch(0.82_0.17_195)]" />
                  )}
                </motion.button>
              );
            })}

            {/* ---- SA3-WINDOW-OS: Minimized windows section ---- */}
            {minimizedOnDesktop.length > 0 && (
              <>
                <div className="mx-1 h-8 w-px shrink-0 bg-border/40" />
                {minimizedOnDesktop.map((w) => (
                  <motion.button
                    key={w.id}
                    whileHover={{ y: -6, scale: 1.12 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => focusWindow(w.id)}
                    className="group relative flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-transparent bg-foreground/[0.04] transition-colors hover:border-[oklch(0.85_0.16_85)]/40 hover:bg-[oklch(0.85_0.16_85)]/10"
                    title={`Restore: ${w.title}`}
                    aria-label={`Restore minimized window: ${w.title}`}
                  >
                    <span className="font-mono-ae text-sm text-foreground/60 group-hover:text-[oklch(0.85_0.16_85)]">
                      {w.icon}
                    </span>
                    {/* Tooltip with the full window title for orientation */}
                    <span className="absolute -top-7 hidden max-w-[180px] truncate whitespace-nowrap rounded-md border border-border/60 bg-popover/90 px-1.5 py-0.5 font-mono-ae text-[0.6rem] text-foreground backdrop-blur group-hover:block">
                      {w.title}
                    </span>
                    {/* Small dot to indicate this is a minimized window */}
                    <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[oklch(0.85_0.16_85)]" />
                  </motion.button>
                ))}
              </>
            )}

            <div className="mx-1 h-8 w-px shrink-0 bg-border/40" />

            {/* ---- SA3-WINDOW-OS: Theme toggle ---- */}
            <motion.button
              whileHover={{ y: -6, scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              onClick={toggleTheme}
              className={cn(
                "group relative flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border transition-colors",
                theme === "light"
                  ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10"
                  : "border-transparent hover:bg-foreground/[0.06]"
              )}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-foreground/70 group-hover:text-[oklch(0.85_0.16_85)]" />
              ) : (
                <Moon className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
              )}
              <span className="absolute -top-7 hidden whitespace-nowrap rounded-md border border-border/60 bg-popover/90 px-1.5 py-0.5 font-mono-ae text-[0.6rem] text-foreground backdrop-blur group-hover:block">
                {theme === "dark" ? "Light" : "Dark"}
              </span>
            </motion.button>

            <motion.button
              whileHover={{ y: -6, scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              onClick={toggleChat}
              className={cn(
                "group relative flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border transition-colors",
                chatOpen
                  ? "border-[oklch(0.74_0.22_300)]/40 bg-[oklch(0.74_0.22_300)]/10"
                  : "border-transparent hover:bg-foreground/[0.06]"
              )}
              title="Chat with N-Core"
            >
              <span className={cn("font-mono-ae text-sm", chatOpen ? "text-[oklch(0.74_0.22_300)]" : "text-foreground/70")}>♥</span>
              <span className="absolute -top-7 hidden whitespace-nowrap rounded-md border border-border/60 bg-popover/90 px-1.5 py-0.5 font-mono-ae text-[0.6rem] backdrop-blur group-hover:block">
                Chat
              </span>
            </motion.button>

            <motion.button
              whileHover={{ y: -6, scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              onClick={toggleSynapse}
              className={cn(
                "group relative flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border transition-colors",
                synapseOpen
                  ? "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10"
                  : "border-transparent hover:bg-foreground/[0.06]"
              )}
              title="Synapse Map"
            >
              <span className={cn("font-mono-ae text-sm", synapseOpen ? "text-[oklch(0.82_0.17_195)]" : "text-foreground/70")}>✦</span>
              <span className="absolute -top-7 hidden whitespace-nowrap rounded-md border border-border/60 bg-popover/90 px-1.5 py-0.5 font-mono-ae text-[0.6rem] backdrop-blur group-hover:block">
                Synapse
              </span>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A small hint tab always visible at the bottom edge to invite the dock */
export function DockHint() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center" data-ai-skip="true">
      <div className="h-1 w-16 rounded-t-full bg-foreground/20" />
    </div>
  );
}
