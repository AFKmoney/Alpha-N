/**
 * start-menu.tsx — the Windows-style "α" launcher: searchable list of every
 * app with an open-indicator dot.
 */
"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOS } from "@/lib/alpha/os-store";
import { DOCK_APPS } from "@/lib/alpha/os-types";

export function StartMenu(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const windows = useOS((s) => s.windows);
  const activeDesktop = useOS((s) => s.activeDesktop);
  const openKinds = useMemo(
    () => new Set(windows.filter((w) => w.desktop === activeDesktop).map((w) => w.kind)),
    [windows, activeDesktop]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCK_APPS;
    return DOCK_APPS.filter(
      (app) => app.label.toLowerCase().includes(q) || app.title.toLowerCase().includes(q) || app.kind.includes(q)
    );
  }, [query]);

  return (
    <div className="fixed bottom-3 left-3 z-[6600]" data-ai-skip>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="glass-strong absolute bottom-11 left-0 w-64 rounded-2xl p-2"
          >
            <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1.5">
              <Search className="h-3 w-3 text-zinc-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) {
                    useOS.getState().openApp(results[0].kind);
                    setOpen(false);
                    setQuery("");
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="search apps…"
                className="font-mono-ae w-full bg-transparent text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
            <div className="scroll-ae max-h-72 overflow-y-auto">
              {results.map((app) => (
                <button
                  key={app.kind}
                  type="button"
                  onClick={() => {
                    useOS.getState().openApp(app.kind);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/8"
                >
                  <span className="font-mono-ae w-7 text-center text-[11px] text-(--ae-cyan)">{app.icon}</span>
                  <span className="font-mono-ae flex-1 text-[11px] text-zinc-300">{app.title}</span>
                  {openKinds.has(app.kind) && <span className="neural-dot" />}
                </button>
              ))}
              {results.length === 0 && (
                <p className="font-mono-ae px-2 py-3 text-center text-[11px] text-zinc-600">no app matches</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "font-mono-ae flex h-9 w-9 items-center justify-center rounded-full border text-sm",
          open
            ? "border-(--ae-amethyst)/50 bg-(--ae-amethyst)/15 text-(--ae-amethyst) glow-amethyst"
            : "border-white/12 bg-black/40 text-zinc-300 hover:text-(--ae-amethyst)"
        )}
        aria-label="Start menu"
      >
        α
      </motion.button>
    </div>
  );
}

export default StartMenu;
