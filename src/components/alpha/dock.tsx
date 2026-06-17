"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS } from "@/lib/alpha/os-types";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

export function Dock() {
  const { openApp, windows, focusWindow } = useOS();
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
          <div className="glass-strong flex items-end gap-1.5 rounded-2xl border border-border/60 px-2.5 py-1.5 shadow-2xl">
            {DOCK_APPS.map((app) => {
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
                  className="group relative flex h-10 w-10 flex-col items-center justify-center rounded-xl border border-transparent transition-colors hover:border-[oklch(0.82_0.17_195)]/30 hover:bg-foreground/[0.06]"
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

            <div className="mx-1 h-8 w-px bg-border/40" />

            <motion.button
              whileHover={{ y: -6, scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              onClick={toggleChat}
              className={cn(
                "group relative flex h-10 w-10 flex-col items-center justify-center rounded-xl border transition-colors",
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
                "group relative flex h-10 w-10 flex-col items-center justify-center rounded-xl border transition-colors",
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
