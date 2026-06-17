"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Cloud, Loader2, X, Zap, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelConfig {
  provider: "cloud" | "aether";
  aetherModel: string;
  aetherHasVision: boolean;
  cloudModel: string;
}

interface TestResult {
  ok: boolean;
  latency: number;
  error?: string;
  provider: string;
  model: string;
}

export function ModelSettings() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Notify the sidebar when modal opens/closes so it doesn't auto-hide
  useEffect(() => {
    if (open) {
      window.dispatchEvent(new Event("alpha-modal-open"));
    } else {
      window.dispatchEvent(new Event("alpha-modal-close"));
    }
  }, [open]);

  // Load current config
  useEffect(() => {
    if (!open) return;
    void fetch("/api/alpha/model")
      .then((r) => r.json())
      .then((c) => setConfig(c))
      .catch(() => {});
  }, [open]);

  const updateConfig = (patch: Partial<ModelConfig>) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/alpha/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
    } catch {
      // ignore
    }
    setSaving(false);
  };

  const testConnection = async () => {
    if (!config) return;
    setTesting(true);
    setTestResult(null);
    try {
      await save(); // save first
      const res = await fetch("/api/alpha/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const result = await res.json();
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, latency: 0, error: err instanceof Error ? err.message : "unknown", provider: config.provider, model: "" });
    }
    setTesting(false);
  };

  return (
    <>
      {/* Toggle button — always visible in the top bar area */}
      <button
        onClick={() => setOpen(!open)}
        className="glass flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1.5 text-xs transition-all hover:bg-card/70"
        title="Model Settings — switch between cloud and local AI"
        data-ai-skip="true"
      >
        {config?.provider === "aether" ? (
          <Zap className="h-3.5 w-3.5 text-[oklch(0.85_0.16_85)]" />
        ) : (
          <Cloud className="h-3.5 w-3.5 text-[oklch(0.82_0.17_195)]" />
        )}
        <span className="hidden font-mono-ae sm:inline">
          {config?.provider === "aether" ? "aether" : "cloud"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            data-ai-skip="true"
          >
            <div className="absolute inset-0 bg-background/70 backdrop-blur-md" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 16 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="glass-strong relative z-10 w-full max-w-lg overflow-hidden rounded-2xl glow-cyan"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/50 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[oklch(0.82_0.17_195)]/15 text-[oklch(0.82_0.17_195)]">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-mono-ae text-base font-semibold">Cognitive Model</h2>
                    <p className="text-[0.65rem] text-muted-foreground">Cloud or local — same OS control power</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="space-y-4 p-5">
                {!config ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {/* Provider toggle */}
                    <div>
                      <label className="eyebrow mb-2 block">provider</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => updateConfig({ provider: "cloud" })}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border p-3 text-left transition-all",
                            config.provider === "cloud"
                              ? "border-[oklch(0.82_0.17_195)]/40 bg-[oklch(0.82_0.17_195)]/10 glow-cyan"
                              : "border-border/60 bg-card/40 hover:bg-card/70"
                          )}
                        >
                          <Cloud className={cn("h-5 w-5", config.provider === "cloud" ? "text-[oklch(0.82_0.17_195)]" : "text-muted-foreground")} />
                          <div>
                            <div className="font-mono-ae text-xs font-semibold">Cloud</div>
                            <div className="text-[0.6rem] text-muted-foreground">GLM 4.6V (vision)</div>
                          </div>
                        </button>
                        <button
                          onClick={() => updateConfig({ provider: "aether" })}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border p-3 text-left transition-all",
                            config.provider === "aether"
                              ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10 glow-gold"
                              : "border-border/60 bg-card/40 hover:bg-card/70"
                          )}
                        >
                          <Zap className={cn("h-5 w-5", config.provider === "aether" ? "text-[oklch(0.85_0.16_85)]" : "text-muted-foreground")} />
                          <div>
                            <div className="font-mono-ae text-xs font-semibold">Aether</div>
                            <div className="text-[0.6rem] text-muted-foreground">GGUF + Graph (10x context)</div>
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Aether settings — GGUF model picker */}
                    {config.provider === "aether" && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 overflow-hidden">
                        <GgufModelPicker
                          selected={config.aetherModel}
                          onSelect={(model) => updateConfig({ aetherModel: model })}
                        />
                        <div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={config.aetherHasVision}
                              onChange={(e) => updateConfig({ aetherHasVision: e.target.checked })}
                              className="h-4 w-4 accent-[oklch(0.85_0.16_85)]"
                            />
                            <span className="font-mono-ae text-xs text-foreground">Model supports vision (image input)</span>
                          </label>
                          <p className="mt-0.5 ml-6 text-[0.55rem] text-muted-foreground/60">
                            If unchecked, the AI operates without screenshots but retains full OS control via text context + memory graph.
                          </p>
                        </div>
                        <div className="rounded-xl border border-[oklch(0.85_0.16_85)]/20 bg-[oklch(0.85_0.16_85)]/[0.05] p-3">
                          <div className="flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5 text-[oklch(0.85_0.16_85)]" />
                            <span className="font-mono-ae text-[0.65rem] text-foreground/80">
                              Aether Engine augments your GGUF model with semantic memory graph retrieval — 10x effective context.
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Cloud settings */}
                    {config.provider === "cloud" && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                        <div className="rounded-xl border border-[oklch(0.82_0.17_195)]/20 bg-[oklch(0.82_0.17_195)]/[0.05] p-3">
                          <div className="flex items-center gap-2">
                            <Cloud className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
                            <span className="font-mono-ae text-xs text-foreground/80">
                              Using GLM 4.6V via z-ai-web-dev-sdk (cloud, with vision)
                            </span>
                          </div>
                          <p className="mt-1 text-[0.6rem] text-muted-foreground/70">
                            No configuration needed — the cloud model handles screenshots and full OS context out of the box.
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Test result */}
                    {testResult && (
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg border p-2.5",
                        testResult.ok
                          ? "border-[oklch(0.7_0.18_145)]/30 bg-[oklch(0.7_0.18_145)]/[0.06]"
                          : "border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.06]"
                      )}>
                        {testResult.ok ? (
                          <CheckCircle className="h-4 w-4 text-[oklch(0.7_0.18_145)]" />
                        ) : (
                          <XCircle className="h-4 w-4 text-[oklch(0.78_0.2_20)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-mono-ae text-[0.65rem] text-foreground/80">
                            {testResult.ok
                              ? `Connected to ${testResult.model} (${testResult.provider}) in ${testResult.latency}ms`
                              : `Connection failed: ${testResult.error?.slice(0, 80)}`}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-3">
                <button
                  onClick={testConnection}
                  disabled={testing || !config}
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 font-mono-ae text-xs transition-colors hover:bg-card/70 disabled:opacity-40"
                >
                  {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  test connection
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-1.5 font-mono-ae text-xs text-muted-foreground hover:text-foreground"
                  >
                    cancel
                  </button>
                  <button
                    onClick={async () => { await save(); setOpen(false); }}
                    disabled={saving || !config}
                    className="rounded-lg bg-[oklch(0.82_0.17_195)]/15 px-4 py-1.5 font-mono-ae text-xs font-semibold text-[oklch(0.82_0.17_195)] transition-colors hover:bg-[oklch(0.82_0.17_195)]/25 disabled:opacity-40"
                  >
                    {saving ? "saving…" : "save & apply"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** GGUF model picker — scans the models/ folder for .gguf files */
function GgufModelPicker({ selected, onSelect }: { selected: string; onSelect: (model: string) => void }) {
  const [models, setModels] = useState<{ name: string; sizeMB: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/alpha/models-list")
      .then((r) => r.json())
      .then((data) => {
        setModels(data.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 py-2"><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="font-mono-ae text-[0.65rem] text-muted-foreground">scanning models/…</span></div>;
  }

  return (
    <div>
      <label className="eyebrow mb-1 block">GGUF model (from models/ folder)</label>
      {models.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-3 text-center">
          <p className="font-mono-ae text-[0.65rem] text-muted-foreground/70">
            No .gguf files found in <code className="text-[oklch(0.85_0.16_85)]">models/</code>
          </p>
          <p className="mt-1 text-[0.55rem] text-muted-foreground/50">
            Drop your GGUF model file in the models/ folder and it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {models.map((m) => (
            <button
              key={m.name}
              onClick={() => onSelect(m.name)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all",
                selected === m.name
                  ? "border-[oklch(0.85_0.16_85)]/40 bg-[oklch(0.85_0.16_85)]/10"
                  : "border-border/40 bg-card/30 hover:bg-card/50"
              )}
            >
              <div className="flex items-center gap-2">
                <Zap className={cn("h-3 w-3", selected === m.name ? "text-[oklch(0.85_0.16_85)]" : "text-muted-foreground")} />
                <span className="font-mono-ae text-[0.7rem] text-foreground/85">{m.name}</span>
              </div>
              <span className="font-mono-ae text-[0.55rem] text-muted-foreground">{m.sizeMB > 0 ? `${m.sizeMB} MB` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
