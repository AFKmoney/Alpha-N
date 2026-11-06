/**
 * dock.tsx — the floating dock: hidden until the pointer approaches the
 * bottom edge, then glides up. App icons, minimized-windows section, chat
 * + synapse toggles, theme toggle, and the global keyboard shortcuts.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Moon, Network, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS } from "@/lib/alpha/os-types";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { triggerContextMenu, buildDockAppActions } from "./context-menu";

export function Dock(): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const windows = useOS((s) => s.windows);
  const activeDesktop = useOS((s) => s.activeDesktop);
  const focusWindow = useOS((s) => s.focusWindow);
  const theme = useOS((s) => s.theme);
  const toggleTheme = useOS((s) => s.toggleTheme);
  const toggleChat = useEvolution((s) => s.toggleChat);
  const toggleSynapse = useEvolution((s) => s.toggleSynapse);

  // proximity reveal (bottom 60px)
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const y = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
      setVisible(y > window.innerHeight - 60);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);

  // global keyboard shortcuts (singleton)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const os = useOS.getState();
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape" && !typing) {
        os.minimizeAll();
        return;
      }
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        const desktopWindows = os.windows.filter((w) => w.desktop === os.activeDesktop && !w.minimized).sort((a, b) => a.z - b.z);
        if (desktopWindows.length > 0) os.focusWindow(desktopWindows[0].id);
        return;
      }
      if ((e.altKey && e.key === "F4") || (e.metaKey && e.key.toLowerCase() === "w")) {
        const top = [...os.windows].sort((a, b) => b.z - a.z)[0];
        if (top) {
          e.preventDefault();
          os.closeWindow(top.id);
        }
        return;
      }
      if (e.key === "Meta" || !e.metaKey) {
        if (e.metaKey && e.key === "ArrowLeft") {
          const top = [...os.windows].sort((a, b) => b.z - a.z)[0];
          if (top && !/Mac/i.test(navigator.platform)) {
            e.preventDefault();
            os.snapWindow(top.id, "left");
          }
        }
        if (e.metaKey && e.key === "ArrowRight") {
          const top = [...os.windows].sort((a, b) => b.z - a.z)[0];
          if (top && !/Mac/i.test(navigator.platform)) {
            e.preventDefault();
            os.snapWindow(top.id, "right");
          }
        }
        if (e.metaKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          os.minimizeAll();
        }
      }
      if (e.ctrlKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        os.setActiveDesktop(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // light-theme overrides injected once
  useEffect(() => {
    if (document.getElementById("alpha-theme-overrides")) return;
    const style = document.createElement("style");
    style.id = "alpha-theme-overrides";
    document.head.appendChild(style);
  }, []);

  const minimized = windows.filter((w) => w.minimized && w.desktop === activeDesktop);
  const openKinds = new Set(windows.filter((w) => !w.minimized && w.desktop === activeDesktop).map((w) => w.kind));

  return (
    <>
      {/* dock hint tab */}
      <AnimatePresence>
        {!visible && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="font-mono-ae fixed bottom-0 left-1/2 z-[6000] -translate-x-1/2 rounded-t-lg border border-b-0 border-white/10 bg-black/40 px-3 py-0.5 text-[9px] tracking-widest text-zinc-500"
            data-ai-skip
          >
            ▲ dock
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 76, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 76, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="glass-strong fixed bottom-2 left-1/2 z-[6500] flex -translate-x-1/2 items-center gap-1 rounded-2xl px-2.5 py-2"
            data-ai-skip
          >
            {DOCK_APPS.map((app) => (
              <button
                key={app.kind}
                type="button"
                title={`${app.label} — ${app.title}`}
                onClick={() => useOS.getState().openApp(app.kind)}
                onContextMenu={(e) => triggerContextMenu(e, buildDockAppActions(app))}
                className="font-mono-ae group relative flex h-9 w-9 items-center justify-center rounded-lg text-[11px] text-zinc-400 transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-[--ae-cyan]"
              >
                {app.icon}
                {openKinds.has(app.kind) && (
                  <span className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-[--ae-cyan] shadow-[0_0_4px_var(--ae-cyan)]" />
                )}
              </button>
            ))}

            {minimized.length > 0 && (
              <>
                <div className="mx-1 h-6 w-px bg-white/10" />
                {minimized.map((win) => (
                  <button
                    key={win.id}
                    type="button"
                    title={win.title}
                    onClick={() => focusWindow(win.id)}
                    className="font-mono-ae relative flex h-9 w-9 items-center justify-center rounded-lg text-[11px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                  >
                    {win.icon}
                    <span className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-[--ae-gold]" />
                  </button>
                ))}
              </>
            )}

            <div className="mx-1 h-6 w-px bg-white/10" />
            <button
              type="button"
              title="Chat with N-Core"
              onClick={toggleChat}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-[--ae-amethyst]"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Synapse map"
              onClick={toggleSynapse}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-[--ae-cyan]"
            >
              <Network className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Toggle theme"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-[--ae-gold]"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default Dock;
