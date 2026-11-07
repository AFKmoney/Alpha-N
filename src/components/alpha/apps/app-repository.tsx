/**
 * app-repository.tsx — grid view of all available Alpha-OS apps.
 * Users can launch apps (click) or drag them onto the desktop. Shows
 * which apps are currently open with a checkmark badge.
 */
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Grid3x3, Search, X } from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS, type AppKind } from "@/lib/alpha/os-types";
import { cn } from "@/lib/utils";

/**
 * AppRepository — a grid view of all available apps.
 * Users can launch apps (click), and drag them onto the desktop.
 * Shows which apps are currently open with a badge.
 */
export function AppRepositoryApp() {
  const { openApp, windows } = useOS();
  const [query, setQuery] = useState("");
  const [draggedApp, setDraggedApp] = useState<AppKind | null>(null);

  const filteredApps = DOCK_APPS.filter((app) =>
    app.label.toLowerCase().includes(query.toLowerCase())
  );

  const handleLaunch = (kind: AppKind) => {
    openApp(kind);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-5 w-5 text-[oklch(0.82_0.17_195)]" />
          <h3 className="font-mono-ae text-base font-semibold">App Repository</h3>
        </div>
        <span className="font-mono-ae text-xs text-muted-foreground">
          {DOCK_APPS.length} apps · {windows.length} open
        </span>
      </div>

      {/* Search */}
      <div className="border-b border-border/50 p-3">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps..."
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* App grid */}
      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filteredApps.map((app) => {
            const isOpen = windows.some((w) => w.kind === app.kind && !w.minimized);
            return (
              <motion.button
                key={app.kind}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
                draggable
                onDragStart={(e) => {
                  const de = e as unknown as React.DragEvent;
                  setDraggedApp(app.kind);
                  de.dataTransfer.effectAllowed = "copy";
                  de.dataTransfer.setData("text/appkind", app.kind);
                }}
                onDragEnd={() => setDraggedApp(null)}
                onClick={() => handleLaunch(app.kind)}
                className={cn(
                  "group relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                  isOpen
                    ? "border-[oklch(0.82_0.17_195)]/30 bg-[oklch(0.82_0.17_195)]/[0.06]"
                    : "border-border/40 bg-card/30 hover:border-[oklch(0.82_0.17_195)]/20 hover:bg-card/50",
                  draggedApp === app.kind && "opacity-50"
                )}
              >
                {/* App icon */}
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl font-mono-ae transition-all",
                    isOpen
                      ? "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
                      : "border-border/40 bg-foreground/[0.04] text-foreground/60 group-hover:border-[oklch(0.82_0.17_195)]/30 group-hover:text-[oklch(0.82_0.17_195)]"
                  )}
                >
                  {app.icon}
                </div>
                {/* Label */}
                <span className="font-mono-ae text-sm font-semibold text-foreground">
                  {app.label}
                </span>
                {/* Open badge */}
                {isOpen && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[oklch(0.82_0.17_195)] text-[0.5rem] font-bold text-background">
                    ✓
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {filteredApps.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search className="h-8 w-8 opacity-40" />
            <p className="font-mono-ae text-sm">No apps found</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/50 px-4 py-2">
        <p className="font-mono-ae text-[0.65rem] text-muted-foreground/60">
          Click to launch · Drag to desktop · {windows.filter(w => !w.minimized).length} windows active
        </p>
      </div>
    </div>
  );
}
