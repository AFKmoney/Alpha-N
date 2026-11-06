/**
 * model-settings.tsx — provider panel: Cloud (GLM vision) vs Aether (local
 * Rust engine + GGUF models from models/). Test connection, save & apply.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Cloud, Cpu, HardDriveDownload, Loader2, PlugZap, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelConfigResponse {
  provider: "cloud" | "aether";
  aetherEndpoint: string;
  aetherModel: string;
  aetherApiKey: string;
  aetherHasVision: boolean;
}

interface GgufModel {
  name: string;
  size: number;
  sizeLabel: string;
}

export function ModelSettingsButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const [provider, setProvider] = useState<string>("…");
  useEffect(() => {
    void fetch("/api/alpha/model")
      .then((r) => r.json())
      .then((d: { config?: ModelConfigResponse }) => setProvider(d.config?.provider ?? "cloud"))
      .catch(() => setProvider("cloud"));
  }, []);
  return (
    <button
      type="button"
      title="Model settings"
      onClick={onOpen}
      className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/8 hover:text-(--ae-cyan)"
    >
      {provider === "aether" ? <HardDriveDownload className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
      {provider}
    </button>
  );
}

export function ModelSettings({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const [config, setConfig] = useState<ModelConfigResponse | null>(null);
  const [models, setModels] = useState<GgufModel[]>([]);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const [cfgRes, modelsRes] = await Promise.all([
        fetch("/api/alpha/model").then((r) => r.json() as Promise<{ config?: ModelConfigResponse }>),
        fetch("/api/alpha/models-list").then((r) => r.json() as Promise<{ models?: GgufModel[] }>),
      ]);
      setConfig(cfgRes.config ?? null);
      setModels(modelsRes.models ?? []);
    } catch {
      /* panel still opens with defaults */
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async (patch: Partial<ModelConfigResponse>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    await fetch("/api/alpha/model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  const runTest = async () => {
    setTesting(true);
    setTestMessage(null);
    try {
      const res = await fetch("/api/alpha/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      setTestMessage(data.message ?? "no response");
    } catch (err) {
      setTestMessage(err instanceof Error ? err.message : "test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!mounted || !open) return <></>;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/55 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 12 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className="glass-strong w-full max-w-md rounded-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <p className="eyebrow">model settings — the mind of the OS</p>
            <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            {(["cloud", "aether"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => void save({ provider })}
                className={cn(
                  "font-mono-ae flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs capitalize transition-colors",
                  config?.provider === provider
                    ? "border-(--ae-cyan)/50 bg-(--ae-cyan)/10 text-(--ae-cyan)"
                    : "border-white/10 text-zinc-400 hover:bg-white/6"
                )}
              >
                {provider === "cloud" ? <Cloud className="h-3.5 w-3.5" /> : <Cpu className="h-3.5 w-3.5" />}
                {provider === "cloud" ? "Cloud (GLM vision)" : "Aether (GGUF + graph)"}
              </button>
            ))}
          </div>

          {config?.provider === "aether" && (
            <div className="mb-4 space-y-2.5">
              <label className="block">
                <span className="eyebrow mb-1 block">aether endpoint</span>
                <input
                  value={config.aetherEndpoint}
                  onChange={(e) => setConfig({ ...config, aetherEndpoint: e.target.value })}
                  onBlur={(e) => void save({ aetherEndpoint: e.target.value })}
                  className="font-mono-ae w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-(--ae-cyan)/40"
                />
              </label>
              <div>
                <span className="eyebrow mb-1 block">gguf model (models/ folder)</span>
                {models.length === 0 ? (
                  <p className="font-mono-ae rounded-lg border border-dashed border-white/12 px-2.5 py-2 text-[10.5px] text-zinc-500">
                    No .gguf files found — drop a model into the <span className="text-(--ae-cyan)">models/</span> folder and reopen.
                  </p>
                ) : (
                  <div className="scroll-ae max-h-32 space-y-1 overflow-y-auto">
                    {models.map((model) => (
                      <button
                        key={model.name}
                        type="button"
                        onClick={() => void save({ aetherModel: model.name })}
                        className={cn(
                          "font-mono-ae flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10.5px]",
                          config.aetherModel === model.name
                            ? "border-(--ae-gold)/50 bg-(--ae-gold)/10 text-(--ae-gold)"
                            : "border-white/10 text-zinc-400 hover:bg-white/6"
                        )}
                      >
                        <span className="truncate">{model.name}</span>
                        <span className="ml-2 shrink-0 text-zinc-600">{model.sizeLabel}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="font-mono-ae flex items-center gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={config.aetherHasVision}
                  onChange={(e) => void save({ aetherHasVision: e.target.checked })}
                  className="accent-(--ae-cyan)"
                />
                model supports vision (sees screenshots)
              </label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={testing}
              className="font-mono-ae flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-(--ae-cyan)/40 hover:text-(--ae-cyan) disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
              test connection
            </button>
            <span className="font-mono-ae flex-1 truncate text-right text-[10px] text-zinc-500">{testMessage ?? ""}</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default ModelSettings;
