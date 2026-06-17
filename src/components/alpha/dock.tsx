"use client";

import { motion } from "framer-motion";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS } from "@/lib/alpha/os-types";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { cn } from "@/lib/utils";

export function Dock() {
  const { openApp, windows, focusWindow } = useOS();
  const { toggleChat, chatOpen, toggleSynapse, synapseOpen } = useEvolution();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-2" data-ai-skip="true">
      <div className="glass-strong pointer-events-auto flex items-end gap-1.5 rounded-2xl border border-border/60 px-2.5 py-1.5">
        {DOCK_APPS.map((app) => {
          const open = windows.filter((w) => w.kind === app.kind && !w.minimized);
          return (
            <motion.button
              key={app.kind}
              whileHover={{ y: -4, scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
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
          whileHover={{ y: -4, scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
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
          whileHover={{ y: -4, scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
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
    </div>
  );
}
