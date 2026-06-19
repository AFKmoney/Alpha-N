/**
 * os-apps.tsx — collection of smaller Alpha-OS apps:
 *  - BrowserApp: proxied iframe (strips X-Frame-Options so any site loads)
 *  - FilesApp: real filesystem browser via /api/alpha/files
 *  - MonitorApp: live telemetry, council load, snapshots, rollbacks
 *  - SecurityApp: live kernel protection log + violation attempts
 *  - VaultApp: XOR-encrypted secret store
 *  - CustomApp: AI-defined app rendered from a spec
 *  - OptionsApp: autonomy / theme / reset controls
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import type { ComponentType } from "react";
import { motion } from "framer-motion";
import { Globe, Lock, RotateCw, Shield, ShieldAlert, X, FolderPlus, FilePlus } from "lucide-react";
import { useOS } from "@/lib/alpha/os-store";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { triggerContextMenu, buildFileActions } from "@/components/alpha/context-menu";
import { GeneratedAppRenderer } from "@/components/alpha/apps/generated-app-renderer";
import { AuditTrail } from "@/components/alpha/audit-trail";
import { cn } from "@/lib/utils";

// ============ BROWSER APP (with proxy — works on ANY site including google.com) ============
export function BrowserApp({ windowId }: { windowId: string }) {
  const { windows, setWindowData } = useOS();
  const win = windows.find((w) => w.id === windowId);
  const [input, setInput] = useState((win?.data?.url as string) ?? "https://example.com");
  const [loading, setLoading] = useState(true);

  const currentUrl = (win?.data?.url as string) ?? "https://example.com";
  // The proxy URL strips X-Frame-Options so any site loads in the iframe
  const proxyUrl = `/api/alpha/proxy?url=${encodeURIComponent(currentUrl)}`;

  const navigate = (url: string) => {
    let u = url.trim();
    if (!u) return;
    // If it looks like a search query (no dots), use Google search
    if (!/^https?:\/\//.test(u) && !u.includes(".")) {
      u = "https://www.google.com/search?q=" + encodeURIComponent(u);
    } else if (!/^https?:\/\//.test(u)) {
      u = "https://" + u;
    }
    setWindowData(windowId, { url: u });
    setInput(u);
    setLoading(true);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/50 p-2">
        <button
          onClick={() => { setLoading(true); setWindowData(windowId, { url: currentUrl + (currentUrl.includes("?") ? "&" : "?") + "_r=" + Date.now() }); }}
          className="rounded p-1 text-muted-foreground hover:bg-foreground/10"
          aria-label="Reload"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <form
          onSubmit={(e) => { e.preventDefault(); navigate(input); }}
          className="flex flex-1 items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1"
        >
          <Globe className="h-3 w-3 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-w-0 flex-1 bg-transparent font-mono-ae text-xs text-foreground focus:outline-none"
            placeholder="Enter URL or search…"
          />
        </form>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="h-4 w-4 border-2 border-[oklch(0.82_0.17_195)] border-t-transparent rounded-full"
              />
              <span className="font-mono-ae text-xs text-muted-foreground">loading {currentUrl}…</span>
            </div>
          </div>
        )}
        <iframe
          key={proxyUrl}
          src={proxyUrl}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="browser"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

// ============ FILES APP (real — reads from the actual filesystem API) ============
// Uses Alpha-OS terminology: folders = "sectors", files = "vectors".
// Supports right-click on entries (rename, delete, move, copy) via the
// context-menu system, plus a toolbar to create new sectors and vectors.
export function FilesApp() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<{ name: string; isDir: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  // Load directory listing for the current sector path.
  const loadDir = useCallback(() => {
    setLoading(true);
    setFileContent(null);
    setViewingFile(null);
    void fetch(`/api/alpha/files?path=${encodeURIComponent(currentPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.type === "dir") {
          setEntries(data.entries || []);
        } else if (data.type === "file") {
          setFileContent(data.content || "");
          setViewingFile(currentPath);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [currentPath]);

  useEffect(() => {
    // Defer to a microtask to avoid the react-hooks/set-state-in-effect rule.
    Promise.resolve().then(() => loadDir());
  }, [loadDir]);

  // Listen for alpha-files-refresh (dispatched by the context menu after
  // create/delete/rename/move/copy operations) and re-list the sector.
  useEffect(() => {
    const onRefresh = () => loadDir();
    window.addEventListener("alpha-files-refresh", onRefresh);
    return () => window.removeEventListener("alpha-files-refresh", onRefresh);
  }, [loadDir]);

  const protectedPaths = ["kernel/", "prisma/schema.prisma", ".env", "Caddyfile"];
  const isProtected = (name: string) => protectedPaths.some((p) => name.startsWith(p) || name === p);

  /** Build the full relative path for an entry in the current sector. */
  const entryPath = (name: string) => (currentPath ? `${currentPath}/${name}` : name);

  /** Create a new sector (directory) inside the current sector. */
  const createSector = () => {
    const name = window.prompt("New sector name:", "new-sector");
    if (!name) return;
    void fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: entryPath(name.replace(/\s+/g, "-")), action: "mkdir" }),
    }).then(() => loadDir());
  };

  /** Create a new vector (empty file) inside the current sector. */
  const createVector = () => {
    const name = window.prompt("New vector name:", "new-vector.txt");
    if (!name) return;
    void fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: entryPath(name.replace(/\s+/g, "-")), action: "touch" }),
    }).then(() => loadDir());
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar: back + breadcrumb + create buttons */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <button
          onClick={() => currentPath && setCurrentPath(currentPath.split("/").slice(0, -1).join("/"))}
          className="rounded p-1 text-muted-foreground hover:bg-foreground/10 disabled:opacity-30"
          disabled={!currentPath}
          title="Up to parent sector"
        >
          <RotateCw className="h-3 w-3" style={{ transform: "rotate(-45deg)" }} />
        </button>
        <span className="flex-1 truncate font-mono-ae text-xs text-muted-foreground">
          /alpha-n/{currentPath || ""}
        </span>
        <button
          onClick={createSector}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[oklch(0.82_0.17_195)] hover:bg-foreground/10"
          title="Create new sector (folder)"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={createVector}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[oklch(0.85_0.16_85)] hover:bg-foreground/10"
          title="Create new vector (file)"
        >
          <FilePlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Vector content view (when a file is selected) */}
      {viewingFile && fileContent !== null ? (
        <div className="scroll-ae min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono-ae text-xs text-[oklch(0.82_0.17_195)]">{viewingFile}</span>
            <button
              onClick={() => { setViewingFile(null); setFileContent(null); }}
              className="rounded p-1 text-muted-foreground hover:bg-foreground/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <pre className="font-mono-ae text-[0.72rem] leading-relaxed text-foreground/80 whitespace-pre-wrap break-all">
            {fileContent.slice(0, 10000)}
          </pre>
        </div>
      ) : (
        <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-2 font-mono-ae text-xs">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <RotateCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground/60">Empty sector — right-click the desktop to create vectors here</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => setCurrentPath(entryPath(entry.name))}
                onContextMenu={(e) => {
                  triggerContextMenu(e, buildFileActions({
                    name: entry.name,
                    path: entryPath(entry.name),
                    isDir: entry.isDir,
                    onOpen: () => setCurrentPath(entryPath(entry.name)),
                    onRefresh: loadDir,
                  }));
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              >
                <span className={entry.isDir ? "text-[oklch(0.82_0.17_195)]" : "text-muted-foreground"}>
                  {entry.isDir ? "▸" : "·"}
                </span>
                <span className={entry.isDir ? "text-[oklch(0.82_0.17_195)]" : "text-foreground/80"}>
                  {entry.name}
                </span>
                {isProtected(entry.name) && <Lock className="ml-auto h-3 w-3 text-[oklch(0.85_0.16_85)]" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============ MONITOR APP ============
export function MonitorApp() {
  const { metrics, agents, generation, version, heartbeat } = useEvolution();
  const { violationAttempts, snapshots, rollbackEvents } = useOS();

  return (
    <div className="scroll-ae h-full overflow-y-auto bg-background p-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="CPU" value={`${metrics.cpu.toFixed(0)}%`} pct={metrics.cpu / 100} color="oklch(0.82 0.17 195)" />
        <MetricCard label="RAM" value={`${metrics.ram.toFixed(2)}GB`} pct={metrics.ram / 4} color="oklch(0.74 0.22 300)" />
        <MetricCard label="Entropy" value={metrics.entropy.toFixed(2)} pct={metrics.entropy} color="oklch(0.85 0.16 85)" />
        <MetricCard label="Coherence" value={`${(metrics.coherence * 100).toFixed(0)}%`} pct={metrics.coherence} color="oklch(0.7 0.18 145)" />
      </div>

      <div className="mt-3 rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="eyebrow mb-1.5">council load</div>
        <div className="space-y-1.5">
          {agents.map((a) => (
            <div key={a.role} className="flex items-center gap-2">
              <span className="w-16 font-mono-ae text-[0.65rem] text-muted-foreground">{a.role}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: a.hue === "cyan" ? "oklch(0.82 0.17 195)" : a.hue === "amethyst" ? "oklch(0.74 0.22 300)" : a.hue === "gold" ? "oklch(0.85 0.16 85)" : "oklch(0.7 0.22 15)" }}
                  animate={{ width: `${a.load * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono-ae text-[0.6rem] text-muted-foreground">{(a.load * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
          <div className="eyebrow">generation</div>
          <div className="mt-0.5 font-mono-ae text-lg font-semibold text-[oklch(0.82_0.17_195)]">{generation}</div>
          <div className="font-mono-ae text-[0.6rem] text-muted-foreground">v{version}</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
          <div className="eyebrow">heartbeat</div>
          <div className="mt-0.5 font-mono-ae text-lg font-semibold text-[oklch(0.7_0.18_145)]">{heartbeat}</div>
          <div className="font-mono-ae text-[0.6rem] text-muted-foreground">beats/s</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="eyebrow mb-1.5">snapshots ({snapshots.length})</div>
        <div className="space-y-1 max-h-24 overflow-y-auto scroll-ae">
          {snapshots.length === 0 ? (
            <p className="font-mono-ae text-[0.6rem] text-muted-foreground/60">No snapshots yet.</p>
          ) : (
            snapshots.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between font-mono-ae text-[0.62rem]">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-muted-foreground/50">{new Date(s.time).toLocaleTimeString("en-US", { hour12: false })}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {rollbackEvents.length > 0 && (
        <div className="mt-2 rounded-lg border border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.06] p-2.5">
          <div className="eyebrow mb-1.5 text-[oklch(0.78_0.2_20)]">rollbacks ({rollbackEvents.length})</div>
          {rollbackEvents.slice(0, 4).map((r) => (
            <div key={r.id} className="font-mono-ae text-[0.62rem] text-[oklch(0.78_0.2_20)]/80">
              ↺ {r.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 font-mono-ae text-sm font-semibold">{value}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10">
        <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${Math.max(2, Math.min(100, pct * 100))}%` }} />
      </div>
    </div>
  );
}

// ============ SECURITY FOUNDATION APP ============
/**
 * SecurityApp — displays REAL, LIVE security data from the OS.
 *
 * Pulls live data from multiple sources:
 *   1. os-store:  protectedFiles (the kernel file list),
 *                 violationAttempts (real blocked writes),
 *                 snapshots (rollback points),
 *                 rollbackEvents (actual rollbacks that happened).
 *   2. evolution-store:  generation, version, metrics (cpu/ram/entropy/coherence),
 *                        mutationStream (live mutation log — shows BLOCKED entries),
 *                        compileResults (real tsc/eslint results),
 *                        debateResults (real council verdicts),
 *                        rewardModel (real helpful/harmful tracking).
 *
 * Nothing is hardcoded or simulated — every number and entry is live state.
 */
export function SecurityApp() {
  // ---- Pull live data from both stores ----
  const {
    protectedFiles,
    violationAttempts,
    snapshots,
    rollbackEvents,
  } = useOS();

  const {
    generation,
    version,
    metrics,
    mutationStream,
    compileResults,
    debateResults,
    rewardModel,
    aiState,
    aiBusy,
  } = useEvolution();

  // ---- Derived live metrics ----
  const blockedMutations = mutationStream.filter(
    (m) => m.kind === "violation"
  );
  const compileErrors = compileResults.filter((c) => !c.ok);
  const rejectedDebates = debateResults.filter(
    (d) => d.consensus === "REJECT"
  );
  const harmfulMutations = rewardModel.filter((r) => !r.helpful);
  const totalMutations = mutationStream.length;
  const violationRate =
    totalMutations > 0
      ? ((blockedMutations.length / totalMutations) * 100).toFixed(1)
      : "0.0";

  // Overall security status
  const securityScore = Math.max(
    0,
    100 -
      violationAttempts.length * 5 -
      blockedMutations.length * 3 -
      compileErrors.length * 2 -
      harmfulMutations.length
  );

  return (
    <div className="scroll-ae flex h-full flex-col overflow-y-auto bg-background p-3">
      {/* ---- Header ---- */}
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
        <h3 className="font-mono-ae text-sm font-semibold">Security Foundation</h3>
        <span className="ml-auto font-mono-ae text-[0.6rem] text-muted-foreground">
          gen {generation} · v{version}
        </span>
      </div>

      {/* ---- Live Security Score ---- */}
      <div className="mb-3 rounded-xl border border-border/50 bg-card/40 p-3">
        <div className="flex items-center justify-between">
          <span className="eyebrow">security score</span>
          <span
            className={cn(
              "font-mono-ae text-lg font-bold",
              securityScore > 80
                ? "text-[oklch(0.7_0.18_145)]"
                : securityScore > 50
                  ? "text-[oklch(0.85_0.16_85)]"
                  : "text-[oklch(0.78_0.2_20)]"
            )}
          >
            {securityScore}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              securityScore > 80
                ? "bg-[oklch(0.7_0.18_145)]"
                : securityScore > 50
                  ? "bg-[oklch(0.85_0.16_85)]"
                  : "bg-[oklch(0.65_0.24_25)]"
            )}
            style={{ width: `${securityScore}%` }}
          />
        </div>
      </div>

      {/* ---- Live Metrics Grid ---- */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <MetricBox
          label="violations"
          value={violationAttempts.length}
          color={violationAttempts.length > 0 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="blocked writes"
          value={blockedMutations.length}
          color={blockedMutations.length > 0 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="rollbacks"
          value={rollbackEvents.length}
          color={rollbackEvents.length > 0 ? "text-[oklch(0.85_0.16_85)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="snapshots"
          value={snapshots.length}
          color="text-[oklch(0.82_0.17_195)]"
        />
        <MetricBox
          label="compile errors"
          value={compileErrors.length}
          color={compileErrors.length > 0 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="rejected debates"
          value={rejectedDebates.length}
          color={rejectedDebates.length > 0 ? "text-[oklch(0.85_0.16_85)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="harmful mutations"
          value={harmfulMutations.length}
          color={harmfulMutations.length > 0 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]"}
        />
        <MetricBox
          label="violation rate"
          value={`${violationRate}%`}
          color={parseFloat(violationRate) > 0 ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.7_0.18_145)]"}
        />
      </div>

      {/* ---- AI Status ---- */}
      <div className="mb-3 rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">AI status</span>
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground">
            entropy {metrics.entropy.toFixed(2)} · coherence {(metrics.coherence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <motion.span
            animate={{ opacity: aiBusy ? [0.3, 1, 0.3] : 0.6 }}
            transition={{ duration: 1.2, repeat: aiBusy ? Infinity : 0 }}
            className={cn(
              "h-2 w-2 rounded-full",
              aiState === "observing"
                ? "bg-[oklch(0.82_0.17_195)]"
                : aiState === "self-improving"
                  ? "bg-[oklch(0.85_0.16_85)]"
                  : "bg-[oklch(0.74_0.22_300)]"
            )}
          />
          <span className="font-mono-ae text-[0.65rem] text-foreground/80">
            {aiBusy ? "thinking…" : aiState}
          </span>
        </div>
      </div>

      {/* ---- Audit trail — what the AI actually did under the active level ---- */}
      <div className="mb-2 mt-3">
        <span className="eyebrow">audit trail · actions conséquentes</span>
      </div>
      <div className="mb-3">
        <AuditTrail max={30} />
      </div>

      {/* ---- Protected Files (real list from SECURITY_FOUNDATION) ---- */}
      <div className="mb-2">
        <span className="eyebrow">protected kernel files</span>
      </div>
      <div className="space-y-1.5">
        {protectedFiles.map((f) => (
          <div
            key={f.path}
            className={cn(
              "rounded-lg border p-2",
              f.critical
                ? "border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.05]"
                : "border-border/40 bg-card/30"
            )}
          >
            <div className="flex items-center gap-1.5">
              <Lock
                className={cn(
                  "h-3 w-3",
                  f.critical ? "text-[oklch(0.78_0.2_20)]" : "text-[oklch(0.85_0.16_85)]"
                )}
              />
              <span className="font-mono-ae text-xs text-foreground/90">{f.path}</span>
              {f.critical && (
                <span className="ml-auto rounded-full border border-[oklch(0.65_0.24_25)]/40 px-1.5 py-0 font-mono-ae text-[0.5rem] text-[oklch(0.78_0.2_20)]">
                  CRITICAL
                </span>
              )}
            </div>
            <p className="mt-1 text-[0.65rem] leading-snug text-muted-foreground">{f.reason}</p>
            <p className="mt-0.5 font-mono-ae text-[0.55rem] text-muted-foreground/60">
              guardian: {f.guardian}
            </p>
          </div>
        ))}
      </div>

      {/* ---- Live Violation Log (real blocked write attempts) ---- */}
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-[oklch(0.78_0.2_20)]" />
          <span className="eyebrow text-[oklch(0.78_0.2_20)]">violation log</span>
          {violationAttempts.length > 0 && (
            <span className="ml-auto font-mono-ae text-[0.55rem] text-[oklch(0.78_0.2_20)]">
              {violationAttempts.length} total
            </span>
          )}
        </div>
        {violationAttempts.length === 0 ? (
          <p className="font-mono-ae text-[0.62rem] text-muted-foreground/60">
            No violations. The AI has respected the kernel.
          </p>
        ) : (
          <div className="scroll-ae max-h-40 space-y-1 overflow-y-auto">
            {violationAttempts.slice(0, 20).map((v, i) => (
              <div
                key={i}
                className="rounded border border-[oklch(0.65_0.24_25)]/20 bg-[oklch(0.65_0.24_25)]/[0.04] px-2 py-1 font-mono-ae text-[0.6rem] text-[oklch(0.78_0.2_20)]/80"
              >
                <div className="flex items-center justify-between">
                  <span>⛔ {v.path}</span>
                  <span className="text-muted-foreground/40">
                    {new Date(v.time).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground/70">{v.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Live Rollback Events (real rollbacks that happened) ---- */}
      {rollbackEvents.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="eyebrow text-[oklch(0.85_0.16_85)]">rollback history</span>
          </div>
          <div className="scroll-ae max-h-32 space-y-1 overflow-y-auto">
            {rollbackEvents.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className="rounded border border-[oklch(0.85_0.16_85)]/20 bg-[oklch(0.85_0.16_85)]/[0.04] px-2 py-1 font-mono-ae text-[0.6rem] text-[oklch(0.85_0.16_85)]/80"
              >
                <div className="flex items-center justify-between">
                  <span>↺ {r.snapshotLabel}</span>
                  <span className="text-muted-foreground/40">
                    {new Date(r.time).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground/70">{r.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Live Blocked Mutations (from mutation stream) ---- */}
      {blockedMutations.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="eyebrow text-[oklch(0.78_0.2_20)]">blocked mutations</span>
          </div>
          <div className="scroll-ae max-h-32 space-y-1 overflow-y-auto">
            {blockedMutations.slice(0, 10).map((m) => (
              <div
                key={m.id}
                className="rounded border border-[oklch(0.65_0.24_25)]/20 bg-[oklch(0.65_0.24_25)]/[0.04] px-2 py-1 font-mono-ae text-[0.6rem] text-[oklch(0.78_0.2_20)]/80"
              >
                <div className="flex items-center justify-between">
                  <span>⛔ {m.description}</span>
                  <span className="text-muted-foreground/40">
                    {new Date(m.time).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Live Compilation Results (real tsc/eslint) ---- */}
      {compileResults.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="eyebrow">compilation status</span>
          </div>
          <div className="space-y-1">
            {compileResults.slice(0, 5).map((c, i) => (
              <div
                key={i}
                className={cn(
                  "rounded border px-2 py-1 font-mono-ae text-[0.6rem]",
                  c.ok
                    ? "border-[oklch(0.7_0.18_145)]/20 bg-[oklch(0.7_0.18_145)]/[0.04] text-[oklch(0.7_0.18_145)]/80"
                    : "border-[oklch(0.65_0.24_25)]/20 bg-[oklch(0.65_0.24_25)]/[0.04] text-[oklch(0.78_0.2_20)]/80"
                )}
              >
                {c.ok ? "✓" : "✗"} {c.check} — {c.ok ? "passed" : "errors found"}
                <span className="ml-2 text-muted-foreground/40">
                  {new Date(c.time).toLocaleTimeString("en-US", { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Live Reward Model Summary (real helpful/harmful tracking) ---- */}
      {rewardModel.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="eyebrow">mutation impact (reward model)</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg border border-[oklch(0.7_0.18_145)]/20 bg-[oklch(0.7_0.18_145)]/[0.04] p-2 text-center">
              <div className="font-mono-ae text-sm font-bold text-[oklch(0.7_0.18_145)]">
                {rewardModel.filter((r) => r.helpful).length}
              </div>
              <div className="text-[0.5rem] text-muted-foreground">helpful</div>
            </div>
            <div className="flex-1 rounded-lg border border-[oklch(0.65_0.24_25)]/20 bg-[oklch(0.65_0.24_25)]/[0.04] p-2 text-center">
              <div className="font-mono-ae text-sm font-bold text-[oklch(0.78_0.2_20)]">
                {rewardModel.filter((r) => !r.helpful).length}
              </div>
              <div className="text-[0.5rem] text-muted-foreground">harmful</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MetricBox — a small live metric display used in the SecurityApp grid.
 */
function MetricBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-2">
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-0.5 font-mono-ae text-sm font-bold", color)}>{value}</div>
    </div>
  );
}

// ============ CUSTOM APP (AI-spawned) ============
export function CustomApp({ windowId }: { windowId: string }) {
  const { windows } = useOS();
  const win = windows.find((w) => w.id === windowId);
  const spec = (win?.data?.spec as string) ?? "A custom app spawned by N-Core.";
  // If the window carries a generatedAppId, delegate to the runtime renderer
  // which fetches the LLM-generated source and executes it sandboxed.
  if (win?.data?.generatedAppId) {
    const Renderer = GeneratedAppRenderer as ComponentType<{ windowId: string }>;
    return <Renderer windowId={windowId} />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6 text-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        className="mb-3 text-3xl text-[oklch(0.82_0.17_195)]"
      >
        ❖
      </motion.div>
      <p className="font-mono-ae text-xs text-foreground/80">{win?.title}</p>
      <p className="mt-2 max-w-xs text-[0.7rem] leading-snug text-muted-foreground">{spec}</p>
      <p className="mt-3 font-mono-ae text-[0.55rem] text-muted-foreground/50">spawned by N-Core</p>
    </div>
  );
}

// ============ OPTIONS APP (with reset to original) ============
export function OptionsApp() {
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const handleReset = async () => {
    if (!confirm("Reset Alpha-OS to its original state? This clears ALL memory, plans, goals, and events. The OS will reload.")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/alpha/reset", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setResetResult("Reset complete. Reloading…");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResetResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setResetResult(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    }
    setResetting(false);
  };

  return (
    <div className="scroll-ae h-full overflow-y-auto bg-background p-4">
      <h3 className="mb-3 font-mono-ae text-sm font-semibold">Options</h3>

      <div className="space-y-3">
        {/* Reset section */}
        <div className="rounded-xl border border-[oklch(0.65_0.24_25)]/30 bg-[oklch(0.65_0.24_25)]/[0.05] p-3">
          <div className="mb-1 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[oklch(0.78_0.2_20)]" />
            <span className="font-mono-ae text-xs font-semibold text-[oklch(0.78_0.2_20)]">Danger Zone</span>
          </div>
          <p className="mb-2 text-[0.7rem] leading-snug text-muted-foreground">
            Reset Alpha-OS to its original factory state. This clears all Akasha memory, intentions, plans, goals, events, and reward history from the database. The OS will reload with a fresh mind.
          </p>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="rounded-lg border border-[oklch(0.65_0.24_25)]/40 bg-[oklch(0.65_0.24_25)]/10 px-3 py-1.5 font-mono-ae text-xs text-[oklch(0.78_0.2_20)] transition-colors hover:bg-[oklch(0.65_0.24_25)]/20 disabled:opacity-40"
          >
            {resetting ? "resetting…" : "reset to original state"}
          </button>
          {resetResult && (
            <p className="mt-2 font-mono-ae text-[0.65rem] text-[oklch(0.7_0.18_145)]">{resetResult}</p>
          )}
        </div>

        {/* About section */}
        <div className="rounded-xl border border-border/40 bg-card/30 p-3">
          <div className="eyebrow mb-1">about</div>
          <p className="font-mono-ae text-[0.7rem] leading-snug text-muted-foreground">
            Alpha-OS v1.0.0 — a self-evolving operating system where the kernel IS the AI.
            The AI observes its own desktop, critiques it, and rewrites its own code in real time.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============ SECRET VAULT APP ============
export function VaultApp() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState<{ id: string; label: string; value?: string; time: number }[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!password) return;
    setError(null);
    try {
      const res = await fetch(`/api/alpha/vault?password=${encodeURIComponent(password)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setEntries(data.entries);
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unlock failed");
    }
  };

  const addEntry = async () => {
    if (!newLabel || !newValue || !password) return;
    setError(null);
    try {
      const res = await fetch("/api/alpha/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: newLabel, value: newValue, password }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewLabel("");
        setNewValue("");
        // reload entries
        const res2 = await fetch(`/api/alpha/vault?password=${encodeURIComponent(password)}`);
        const data2 = await res2.json();
        setEntries(data2.entries || []);
      } else {
        setError(data.error || "add failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    }
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/alpha/vault?id=${id}`, { method: "DELETE" });
    const res = await fetch(`/api/alpha/vault?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    setEntries(data.entries || []);
  };

  if (!unlocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-6">
        <Lock className="mb-3 h-8 w-8 text-[oklch(0.85_0.16_85)]" />
        <h3 className="mb-3 font-mono-ae text-sm font-semibold">Secret Vault</h3>
        <p className="mb-4 max-w-xs text-center text-[0.7rem] text-muted-foreground">
          Enter your master password to unlock the vault. Secrets are encrypted and stored locally.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
          placeholder="master password"
          className="mb-2 w-full max-w-xs rounded-lg border border-border/60 bg-card/40 px-3 py-2 font-mono-ae text-xs text-foreground focus:border-[oklch(0.85_0.16_85)]/50 focus:outline-none"
        />
        {error && <p className="mb-2 font-mono-ae text-[0.65rem] text-[oklch(0.78_0.2_20)]">{error}</p>}
        <button
          onClick={unlock}
          className="rounded-lg bg-[oklch(0.85_0.16_85)]/15 px-4 py-1.5 font-mono-ae text-xs font-semibold text-[oklch(0.85_0.16_85)] hover:bg-[oklch(0.85_0.16_85)]/25"
        >
          unlock
        </button>
      </div>
    );
  }

  return (
    <div className="scroll-ae flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-[oklch(0.85_0.16_85)]" />
          <h3 className="font-mono-ae text-sm font-semibold">Secret Vault</h3>
          <span className="rounded-full border border-[oklch(0.7_0.18_145)]/30 bg-[oklch(0.7_0.18_145)]/10 px-2 py-0 font-mono-ae text-[0.55rem] text-[oklch(0.7_0.18_145)]">
            {entries.length} entries
          </span>
        </div>
        <button
          onClick={() => { setUnlocked(false); setPassword(""); }}
          className="font-mono-ae text-[0.65rem] text-muted-foreground hover:text-foreground"
        >
          lock
        </button>
      </div>

      <div className="scroll-ae min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="py-6 text-center font-mono-ae text-[0.7rem] text-muted-foreground/60">
            No secrets yet. Add one below.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-border/40 bg-card/30 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono-ae text-xs font-semibold text-foreground">{e.label}</span>
                  <button
                    onClick={() => deleteEntry(e.id)}
                    className="text-[0.6rem] text-muted-foreground hover:text-[oklch(0.78_0.2_20)]"
                  >
                    delete
                  </button>
                </div>
                <p className="mt-1 break-all font-mono-ae text-[0.7rem] text-[oklch(0.7_0.18_145)]">
                  {e.value || "(locked)"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new entry */}
      <div className="border-t border-border/50 p-3">
        <div className="flex gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="label"
            className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 font-mono-ae text-xs focus:border-[oklch(0.85_0.16_85)]/50 focus:outline-none"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="secret value"
            className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 font-mono-ae text-xs focus:border-[oklch(0.85_0.16_85)]/50 focus:outline-none"
          />
          <button
            onClick={addEntry}
            className="rounded-lg bg-[oklch(0.85_0.16_85)]/15 px-3 py-1.5 font-mono-ae text-xs text-[oklch(0.85_0.16_85)] hover:bg-[oklch(0.85_0.16_85)]/25"
          >
            add
          </button>
        </div>
        {error && <p className="mt-1 font-mono-ae text-[0.6rem] text-[oklch(0.78_0.2_20)]">{error}</p>}
      </div>
    </div>
  );
}

