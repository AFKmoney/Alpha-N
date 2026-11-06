/**
 * app-store-app.tsx — the AI App Store catalog: browse LLM-suggested app
 * ideas by category, generate & install them in one click, and manage the
 * installed apps (open / uninstall). Installed apps open in "custom"
 * windows via the GeneratedAppRenderer runtime.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOS } from "@/lib/alpha/os-store";

const CATEGORIES = ["Productivity", "Creative", "Developer", "Utilities", "AI Tools", "Fun"] as const;
type Category = (typeof CATEGORIES)[number];

interface Suggestion {
  name: string;
  description: string;
  icon: string;
  category: string;
}

interface InstalledApp {
  id: string;
  name: string;
  description: string;
  category: string;
}

export function AppStoreApp(): React.ReactElement {
  const openApp = useOS((s) => s.openApp);
  const [tab, setTab] = useState<Category | "installed">("Productivity");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [installedJustNow, setInstalledJustNow] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/alpha/generate-app");
      const data = (await res.json()) as { ok?: boolean; apps?: InstalledApp[] };
      setInstalled(data.apps ?? []);
    } catch {
      setInstalled([]);
    }
  }, []);

  const loadSuggestions = useCallback(async (category: string) => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/alpha/generate-app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suggest", category }),
      });
      const data = (await res.json()) as { ok?: boolean; suggestions?: Suggestion[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      setSuggestions([]);
      setSuggestError(err instanceof Error ? err.message : "suggest failed");
    } finally {
      setSuggesting(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  useEffect(() => {
    if (tab !== "installed") void loadSuggestions(tab);
  }, [tab, loadSuggestions]);

  const generate = async (s: Suggestion) => {
    if (generating) return;
    setGenerating(s.name);
    setGenerateError(null);
    try {
      const res = await fetch("/api/alpha/generate-app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", name: s.name, description: s.description, category: s.category }),
      });
      const data = (await res.json()) as { ok?: boolean; app?: { id: string; name: string }; error?: string };
      if (!res.ok || !data.ok || !data.app) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInstalledJustNow(s.name);
      window.setTimeout(() => setInstalledJustNow(null), 2500);
      await refreshInstalled();
      openApp("custom", { title: data.app.name, data: { generatedAppId: data.app.id, spec: s.description } });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "generate failed");
    } finally {
      setGenerating(null);
    }
  };

  const open = (app: InstalledApp) => {
    openApp("custom", { title: app.name, data: { generatedAppId: app.id, spec: app.description } });
  };

  const uninstall = async (app: InstalledApp) => {
    try {
      await fetch(`/api/alpha/generate-app?id=${encodeURIComponent(app.id)}`, { method: "DELETE" });
    } catch {
      /* already gone server-side */
    }
    await refreshInstalled();
  };

  return (
    <div className="flex h-full flex-col bg-background/40">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">ai app store</p>
          <p className="font-mono-ae text-[10px] text-zinc-400">
            pick an idea — the council writes the code — it runs sandboxed
          </p>
        </div>
        {installedJustNow && (
          <motion.span
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            className="font-mono-ae ml-auto shrink-0 rounded-full border border-(--ae-emerald)/30 bg-(--ae-emerald)/10 px-2 py-0.5 text-[9px] text-(--ae-emerald)"
          >
            ✓ {installedJustNow} installed
          </motion.span>
        )}
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-white/8 px-3 py-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTab(c)}
            className={cn(
              "font-mono-ae rounded-md px-2 py-1 text-[10px] transition-colors",
              tab === c ? "bg-(--ae-cyan)/15 text-(--ae-cyan)" : "text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
            )}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab("installed")}
          className={cn(
            "font-mono-ae ml-auto rounded-md px-2 py-1 text-[10px] transition-colors",
            tab === "installed"
              ? "bg-(--ae-amethyst)/15 text-(--ae-amethyst)"
              : "text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
          )}
        >
          installed · {installed.length}
        </button>
        {tab !== "installed" && (
          <button
            type="button"
            title="Re-suggest ideas"
            onClick={() => void loadSuggestions(tab)}
            className="rounded-md p-1 text-zinc-500 hover:bg-white/6 hover:text-(--ae-cyan)"
          >
            <RefreshCw className={cn("h-3 w-3", suggesting && "animate-spin")} />
          </button>
        )}
      </div>

      {/* content */}
      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "installed" ? (
          installed.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Sparkles className="h-5 w-5 text-zinc-600" />
              <p className="font-mono-ae text-[11px] text-zinc-500">
                no apps installed yet — pick a category and generate one
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {installed.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono-ae truncate text-[11px] text-zinc-200">{app.name}</p>
                    <p className="font-mono-ae truncate text-[10px] text-zinc-500">
                      <span className="text-(--ae-cyan)/70">{app.category}</span> · {app.description || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => open(app)}
                    className="font-mono-ae flex shrink-0 items-center gap-1 rounded-md border border-(--ae-cyan)/30 bg-(--ae-cyan)/10 px-2 py-1 text-[9px] text-(--ae-cyan) hover:bg-(--ae-cyan)/20"
                  >
                    <Play className="h-2.5 w-2.5" /> open
                  </button>
                  <button
                    type="button"
                    title="Uninstall"
                    onClick={() => void uninstall(app)}
                    className="shrink-0 rounded-md p-1 text-zinc-600 hover:bg-white/6 hover:text-(--ae-rose)"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : suggesting ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-(--ae-cyan)" />
            <span className="font-mono-ae text-[11px] text-zinc-500">asking the council for {tab} ideas…</span>
          </div>
        ) : suggestError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="font-mono-ae text-[11px] text-(--ae-rose)">{suggestError}</p>
            <button
              type="button"
              onClick={() => void loadSuggestions(tab)}
              className="font-mono-ae rounded-md border border-white/10 px-3 py-1 text-[10px] text-zinc-300 hover:bg-white/6"
            >
              retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {suggestions.map((s) => {
              const isThisOne = generating === s.name;
              const isAnother = generating !== null && !isThisOne;
              return (
                <div
                  key={s.name}
                  className="flex flex-col gap-2 rounded-xl border border-white/8 bg-black/20 p-3 transition-colors hover:border-white/15"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none">{s.icon}</span>
                    <div className="min-w-0">
                      <p className="font-mono-ae truncate text-[11px] text-zinc-200">{s.name}</p>
                      <p className="font-mono-ae text-[9px] uppercase tracking-wider text-zinc-600">{s.category}</p>
                    </div>
                  </div>
                  <p className="font-mono-ae min-h-[2.5em] text-[10px] leading-snug text-zinc-400">{s.description}</p>
                  <button
                    type="button"
                    disabled={generating !== null}
                    onClick={() => void generate(s)}
                    className={cn(
                      "font-mono-ae mt-auto flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] transition-colors",
                      isThisOne
                        ? "bg-(--ae-amethyst)/15 text-(--ae-amethyst)"
                        : "border border-(--ae-amethyst)/25 text-(--ae-amethyst)/90 hover:bg-(--ae-amethyst)/15 disabled:opacity-40"
                    )}
                  >
                    {isThisOne ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" /> writing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" /> {isAnother ? "queued…" : "generate"}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {generateError && tab !== "installed" && (
          <p className="font-mono-ae mt-3 rounded-md border border-(--ae-rose)/25 bg-(--ae-rose)/10 px-3 py-2 text-[10px] text-(--ae-rose)">
            {generateError}
          </p>
        )}
      </div>
    </div>
  );
}

export default AppStoreApp;
