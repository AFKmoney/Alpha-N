/**
 * audit-trail.tsx — live view of the AI's consequential actions under the
 * current autonomy level. Polls /api/alpha/audit every few seconds and
 * renders the recent entries with colour-coded results. Shown inside the
 * Security Foundation app so the user always knows what the organism did.
 */
"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, ShieldX, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  time: number;
  action: string;
  description: string;
  level: "sandbox" | "moderate" | "yolo";
  result: "ok" | "blocked" | "error" | "denied";
  detail?: string;
}

const RESULT_META: Record<
  AuditEntry["result"],
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  ok: { icon: CheckCircle2, color: "text-[oklch(0.78_0.18_145)]", label: "OK" },
  error: { icon: XCircle, color: "text-[oklch(0.72_0.18_40)]", label: "erreur" },
  blocked: { icon: ShieldX, color: "text-[oklch(0.85_0.16_85)]", label: "bloqué" },
  denied: { icon: AlertOctagon, color: "text-[oklch(0.7_0.22_20)]", label: "refusé" },
};

const LEVEL_COLOR: Record<AuditEntry["level"], string> = {
  sandbox: "text-[oklch(0.82_0.17_195)]",
  moderate: "text-[oklch(0.85_0.16_85)]",
  yolo: "text-[oklch(0.7_0.22_20)]",
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function AuditTrail({ max = 40 }: { max?: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/alpha/audit", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled && Array.isArray(data.entries)) {
          setEntries(data.entries.slice(0, max));
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [max]);

  if (error) {
    return (
      <p className="px-1 font-mono-ae text-[0.65rem] text-muted-foreground/60">
        journal d&apos;audit indisponible (DB non prête ?)
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="px-1 font-mono-ae text-[0.65rem] text-muted-foreground/60">
        aucune action conséquente enregistrée — l&apos;organisme est au repos.
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-64 rounded-lg border border-border/40 bg-background/30">
      <div className="flex flex-col divide-y divide-border/30">
        {entries.map((e) => {
          const meta = RESULT_META[e.result];
          const Icon = meta.icon;
          return (
            <div key={e.id} className="flex items-start gap-2 px-2.5 py-1.5">
              <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", meta.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono-ae text-[0.65rem] text-foreground/90">
                    {e.action}
                  </span>
                  <span className="shrink-0 font-mono-ae text-[0.55rem] text-muted-foreground/60">
                    {timeAgo(e.time)}
                  </span>
                </div>
                <p className="truncate text-[0.62rem] text-muted-foreground">
                  {e.description}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={cn("font-mono-ae text-[0.55rem]", meta.color)}>
                    {meta.label}
                  </span>
                  <span className={cn("font-mono-ae text-[0.55rem]", LEVEL_COLOR[e.level])}>
                    {e.level}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
