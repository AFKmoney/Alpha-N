"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X } from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS, type AppKind } from "@/lib/alpha/os-types";
import { cn } from "@/lib/utils";

export function StartMenu() {
  const { openApp, windows } = useOS();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredApps = DOCK_APPS.filter((app) =>
    app.label.toLowerCase().includes(query.toLowerCase())
  );

  const handleOpen = (kind: AppKind) => {
    openApp(kind);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      {/* Start button — always visible bottom-left */}
      <button
        onClick={() => setOpen(!open)}
        className="glass-strong pointer-events-auto fixed bottom-1 left-2 z-30 flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 transition-all hover:bg-card/70"
        title="Start menu"
        data-ai-skip="true"
      >
        <span className="font-mono-ae text-xs font-bold text-[oklch(0.82_0.17_195)]">α</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              data-ai-skip="true"
            />

            {/* Menu panel */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className="glass-strong fixed bottom-12 left-2 z-50 w-80 overflow-hidden rounded-2xl border border-border/60"
              data-ai-skip="true"
            >
              {/* Search */}
              <div className="border-b border-border/50 p-3">
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search apps…"
                    className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* App list */}
              <div className="scroll-ae max-h-80 overflow-y-auto p-2">
                {filteredApps.length === 0 ? (
                  <p className="py-4 text-center font-mono-ae text-[0.7rem] text-muted-foreground/60">
                    No apps found
                  </p>
                ) : (
                  filteredApps.map((app) => {
                    const isOpen = windows.some((w) => w.kind === app.kind && !w.minimized);
                    return (
                      <button
                        key={app.kind}
                        onClick={() => handleOpen(app.kind)}
                        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.06]"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-card/40 font-mono-ae text-sm text-foreground/70 group-hover:border-[oklch(0.82_0.17_195)]/40 group-hover:text-[oklch(0.82_0.17_195)]">
                          {app.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono-ae text-xs font-semibold text-foreground">{app.label}</div>
                          <div className="text-[0.6rem] text-muted-foreground/60">{app.defaultTitle}</div>
                        </div>
                        {isOpen && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.82_0.17_195)]" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border/50 px-3 py-2">
                <p className="font-mono-ae text-[0.55rem] text-muted-foreground/50">
                  Alpha-OS · {windows.length} windows open · {DOCK_APPS.length} apps
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
