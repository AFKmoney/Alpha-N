/**
 * ai-app-store.tsx — AI-generated App Store for Alpha-N OS.
 *
 * The AI suggests app ideas (one batch per category), the user picks one,
 * the AI generates the full React component source, and the result is
 * persisted to the GeneratedApp table. Installed apps can be opened
 * (rendered live via the GeneratedAppRenderer) or uninstalled.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ Header: title · search · Create Custom App  │
 *   ├──────────┬──────────────────────────────────┤
 *   │ Sidebar  │ Suggestions grid                 │
 *   │ (cats)   │ ─────────────────────────────────│
 *   │          │ Installed apps                   │
 *   └──────────┴──────────────────────────────────┘
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Sparkles,
  Loader2,
  Download,
  Play,
  Trash2,
  Plus,
  RefreshCw,
  Package,
  AlertCircle,
  Briefcase,
  Palette,
  Code,
  Wrench,
  Brain,
  Gamepad2,
} from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
interface AppSuggestion {
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
  createdAt: string;
}

interface CategoryDef {
  id: string;
  label: string;
  icon: typeof Briefcase;
  accent: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------
const CATEGORIES: CategoryDef[] = [
  { id: "Productivity", label: "Productivity", icon: Briefcase, accent: "oklch(0.82 0.17 195)" },
  { id: "Creative", label: "Creative", icon: Palette, accent: "oklch(0.74 0.22 300)" },
  { id: "Developer", label: "Developer", icon: Code, accent: "oklch(0.7 0.18 145)" },
  { id: "Utilities", label: "Utilities", icon: Wrench, accent: "oklch(0.85 0.16 85)" },
  { id: "AI Tools", label: "AI Tools", icon: Brain, accent: "oklch(0.82 0.17 195)" },
  { id: "Fun", label: "Fun", icon: Gamepad2, accent: "oklch(0.78 0.2 20)" },
];

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------
export function AIAppStore({ windowId }: { windowId?: string }): React.ReactElement {
  void windowId; // reserved for future per-window state (e.g. recent installs)

  const { openApp } = useOS();
  const { toast } = useToast();

  const [activeCategory, setActiveCategory] = useState<string>("Productivity");
  const [searchQuery, setSearchQuery] = useState("");

  const [suggestions, setSuggestions] = useState<AppSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(true);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);

  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customSubmitting, setCustomSubmitting] = useState(false);

  // -------- Fetch suggestions whenever the active category changes --------
  const refreshSuggestions = useCallback((category: string) => {
    const controller = new AbortController();
    setSuggesting(true);
    setSuggestError(null);

    fetch("/api/alpha/generate-app", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "suggest", category }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
        } else {
          setSuggestError(data.error || "AI returned no suggestions.");
          setSuggestions([]);
        }
        setSuggesting(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setSuggestError(err instanceof Error ? err.message : "Network error.");
        setSuggesting(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const abort = refreshSuggestions(activeCategory);
    return abort;
  }, [activeCategory, refreshSuggestions]);

  // -------- Fetch installed apps --------
  const refreshInstalled = useCallback(() => {
    setLoadingInstalled(true);
    fetch("/api/alpha/generate-app", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.apps)) {
          setInstalled(data.apps as InstalledApp[]);
        }
        setLoadingInstalled(false);
      })
      .catch((err: unknown) => {
        toast({
          title: "Failed to load installed apps",
          description: err instanceof Error ? err.message : "Network error.",
        });
        setLoadingInstalled(false);
      });
  }, [toast]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  // -------- Generate an app from a suggestion --------
  const handleGenerate = useCallback(
    async (suggestion: AppSuggestion): Promise<void> => {
      const key = `${suggestion.name}::${suggestion.description}`;
      setGeneratingKey(key);
      try {
        const res = await fetch("/api/alpha/generate-app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "generate",
            name: suggestion.name,
            description: suggestion.description,
            category: suggestion.category,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Generation failed.");
        }
        toast({
          title: "App installed",
          description: `${suggestion.name} is ready to open.`,
        });
        refreshInstalled();
      } catch (err: unknown) {
        toast({
          title: "Generation failed",
          description: err instanceof Error ? err.message : "Unknown error.",
        });
      } finally {
        setGeneratingKey(null);
      }
    },
    [refreshInstalled, toast]
  );

  // -------- Delete an installed app --------
  const handleDelete = useCallback(
    async (app: InstalledApp): Promise<void> => {
      try {
        const res = await fetch(
          `/api/alpha/generate-app?id=${encodeURIComponent(app.id)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Delete failed.");
        toast({ title: "App removed", description: app.name });
        setInstalled((prev) => prev.filter((a) => a.id !== app.id));
      } catch (err: unknown) {
        toast({
          title: "Failed to remove app",
          description: err instanceof Error ? err.message : "Unknown error.",
        });
      }
    },
    [toast]
  );

  // -------- Open an installed app --------
  const handleOpen = useCallback(
    (app: InstalledApp): void => {
      openApp("custom", {
        title: app.name,
        icon: "✨",
        data: {
          spec: app.description,
          generatedAppId: app.id,
        },
      });
    },
    [openApp]
  );

  // -------- Submit the custom-app form --------
  const handleSubmitCustom = useCallback(async (): Promise<void> => {
    const name = customName.trim();
    const description = customDesc.trim();
    if (!name || !description) return;

    setCustomSubmitting(true);
    try {
      const res = await fetch("/api/alpha/generate-app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          name,
          description,
          category: activeCategory,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Generation failed.");
      toast({
        title: "Custom app installed",
        description: `${name} is ready to open.`,
      });
      setCustomOpen(false);
      setCustomName("");
      setCustomDesc("");
      refreshInstalled();
    } catch (err: unknown) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error.",
      });
    } finally {
      setCustomSubmitting(false);
    }
  }, [activeCategory, customDesc, customName, refreshInstalled, toast]);

  // -------- Filter suggestions by search query --------
  const filteredSuggestions = suggestions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  });

  const activeCatDef =
    CATEGORIES.find((c) => c.id === activeCategory) ?? CATEGORIES[0];

  // -------- Render --------
  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 8, -8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[oklch(0.82_0.17_195)]/30 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
          >
            <Sparkles className="h-4 w-4" />
          </motion.div>
          <div>
            <h2 className="font-mono-ae text-sm font-semibold text-foreground">
              AI App Store
            </h2>
            <p className="font-mono-ae text-[0.6rem] text-muted-foreground">
              prompt → code → installed in one click
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search suggestions…"
              className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none sm:w-48"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => setCustomOpen(true)}
            className="gap-1.5 rounded-full border border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)] hover:bg-[oklch(0.82_0.17_195)]/25"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Create Custom</span>
            <span className="sm:hidden">Custom</span>
          </Button>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Sidebar */}
        <nav
          aria-label="App categories"
          className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border/50 p-2 sm:w-44 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
        >
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = cat.id === activeCategory;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                aria-pressed={active}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-mono-ae text-xs transition-colors",
                  active
                    ? "border border-border/60 bg-card/60 text-foreground"
                    : "border border-transparent text-muted-foreground hover:bg-card/30 hover:text-foreground"
                )}
                style={
                  active
                    ? { color: cat.accent, borderColor: `${cat.accent}33` }
                    : undefined
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Main area */}
        <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-4">
          {/* Suggestions */}
          <section aria-label="AI-suggested apps">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3
                  className="font-mono-ae text-xs font-semibold uppercase tracking-wider"
                  style={{ color: activeCatDef.accent }}
                >
                  {activeCatDef.label}
                </h3>
                <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
                  · AI suggestions
                </span>
              </div>
              <button
                onClick={() => refreshSuggestions(activeCategory)}
                disabled={suggesting}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono-ae text-[0.65rem] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={cn("h-3 w-3", suggesting && "animate-spin")} />
                refresh
              </button>
            </div>

            {suggesting ? (
              <SuggestionsSkeleton />
            ) : suggestError ? (
              <SuggestionsError
                message={suggestError}
                onRetry={() => refreshSuggestions(activeCategory)}
              />
            ) : filteredSuggestions.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Search className="h-6 w-6 opacity-40" />
                <p className="font-mono-ae text-xs">
                  No suggestions match “{searchQuery}”.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredSuggestions.map((s) => {
                    const key = `${s.name}::${s.description}`;
                    const isGenerating = generatingKey === key;
                    return (
                      <motion.div
                        key={key}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.18 }}
                        className="group relative flex flex-col gap-2 rounded-xl border border-border/40 bg-card/30 p-3 transition-colors hover:border-[oklch(0.82_0.17_195)]/30 hover:bg-card/50"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-foreground/[0.04] text-xl"
                            aria-hidden
                          >
                            {s.icon || "▢"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate font-mono-ae text-sm font-semibold text-foreground">
                              {s.name}
                            </h4>
                            <p className="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground">
                              {s.description}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleGenerate(s)}
                          disabled={isGenerating}
                          className={cn(
                            "mt-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono-ae text-[0.7rem] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            isGenerating
                              ? "border-[oklch(0.82_0.17_195)]/30 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)]"
                              : "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 text-[oklch(0.82_0.17_195)] hover:bg-[oklch(0.82_0.17_195)]/20"
                          )}
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              AI is coding…
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" />
                              Generate &amp; Install
                            </>
                          )}
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Installed apps */}
          <section aria-label="Installed generated apps" className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-[oklch(0.85_0.16_85)]" />
                <h3 className="font-mono-ae text-xs font-semibold uppercase tracking-wider text-[oklch(0.85_0.16_85)]">
                  Installed
                </h3>
                <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
                  · {installed.length} app{installed.length === 1 ? "" : "s"}
                </span>
              </div>
              <button
                onClick={refreshInstalled}
                disabled={loadingInstalled}
                className="flex items-center gap-1 rounded px-2 py-1 font-mono-ae text-[0.65rem] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw
                  className={cn("h-3 w-3", loadingInstalled && "animate-spin")}
                />
                refresh
              </button>
            </div>

            {loadingInstalled ? (
              <InstalledSkeleton />
            ) : installed.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/40 text-muted-foreground">
                <Package className="h-5 w-5 opacity-40" />
                <p className="font-mono-ae text-[0.7rem]">
                  No installed apps yet — generate one above.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {installed.map((app) => (
                  <motion.div
                    key={app.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="group flex items-center gap-3 rounded-lg border border-border/40 bg-card/30 p-2.5 transition-colors hover:border-[oklch(0.85_0.16_85)]/30 hover:bg-card/50"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/40 bg-foreground/[0.04] text-base">
                      <Sparkles className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-mono-ae text-xs font-semibold text-foreground">
                        {app.name}
                      </h4>
                      <p className="truncate text-[0.6rem] text-muted-foreground">
                        {app.category} · {new Date(app.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleOpen(app)}
                        aria-label={`Open ${app.name}`}
                        className="flex items-center gap-1 rounded-md border border-[oklch(0.82_0.17_195)]/30 bg-[oklch(0.82_0.17_195)]/10 px-2 py-1 font-mono-ae text-[0.65rem] text-[oklch(0.82_0.17_195)] transition-colors hover:bg-[oklch(0.82_0.17_195)]/20"
                      >
                        <Play className="h-3 w-3" />
                        Open
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        aria-label={`Delete ${app.name}`}
                        className="flex items-center justify-center rounded-md border border-border/40 px-2 py-1 text-muted-foreground transition-colors hover:border-[oklch(0.78_0.2_20)]/40 hover:bg-[oklch(0.78_0.2_20)]/10 hover:text-[oklch(0.78_0.2_20)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Create Custom App dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="font-mono-ae text-sm">
              <span className="text-[oklch(0.82_0.17_195)]">✦</span> Create Custom App
            </DialogTitle>
            <DialogDescription className="text-[0.7rem]">
              Describe the app you want. The AI will generate a complete React
              component and install it into the OS. Category:{" "}
              <span className="font-mono-ae">{activeCategory}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-name" className="font-mono-ae text-[0.7rem]">
                App name
              </Label>
              <Input
                id="custom-name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Habit Streak Tracker"
                className="font-mono-ae text-xs"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-desc" className="font-mono-ae text-[0.7rem]">
                Description
              </Label>
              <Textarea
                id="custom-desc"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Describe what the app should do, what features it should have, what UI elements you want…"
                className="scroll-ae min-h-[88px] resize-none font-mono-ae text-xs"
                maxLength={500}
              />
              <p className="text-right font-mono-ae text-[0.6rem] text-muted-foreground/60">
                {customDesc.length}/500
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomOpen(false)}
              disabled={customSubmitting}
              className="font-mono-ae text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitCustom}
              disabled={
                customSubmitting ||
                !customName.trim() ||
                !customDesc.trim()
              }
              className="gap-1.5 font-mono-ae text-xs"
            >
              {customSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate &amp; Install
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components: skeletons + error state
// ----------------------------------------------------------------------------
function SuggestionsSkeleton(): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/30 bg-card/20 p-3"
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-foreground/[0.06]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-foreground/[0.06]" />
              <div className="h-2.5 w-full rounded bg-foreground/[0.04]" />
              <div className="h-2.5 w-3/4 rounded bg-foreground/[0.04]" />
            </div>
          </div>
          <div className="h-7 w-full rounded-lg bg-foreground/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function InstalledSkeleton(): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse items-center gap-3 rounded-lg border border-border/30 bg-card/20 p-2.5"
        >
          <div className="h-9 w-9 rounded-md bg-foreground/[0.06]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-2/3 rounded bg-foreground/[0.06]" />
            <div className="h-2 w-1/2 rounded bg-foreground/[0.04]" />
          </div>
          <div className="h-6 w-12 rounded-md bg-foreground/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function SuggestionsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[oklch(0.78_0.2_20)]/40 bg-[oklch(0.78_0.2_20)]/[0.05] p-3 text-center">
      <AlertCircle className="h-5 w-5 text-[oklch(0.78_0.2_20)]" />
      <p className="font-mono-ae text-[0.7rem] text-[oklch(0.78_0.2_20)]">
        suggestions failed
      </p>
      <p className="max-w-md text-[0.65rem] leading-snug text-muted-foreground">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="mt-1 flex items-center gap-1.5 rounded-md border border-border/50 bg-card/50 px-2.5 py-1 font-mono-ae text-[0.65rem] text-foreground transition-colors hover:bg-card"
      >
        <RefreshCw className="h-3 w-3" />
        retry
      </button>
    </div>
  );
}
