/**
 * audit-trail.tsx — live ledger of the AI's consequential actions under the
 * active autonomy level. Reads the in-memory journal from autonomy-policy
 * (kept fresh via the alpha-audit-entry window event).
 */
"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { getAuditTrail, type AuditEntry } from "@/lib/alpha/autonomy-policy";
import { cn } from "@/lib/utils";

export function AuditTrail({ max = 30 }: { max?: number }): React.ReactElement {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => setEntries(getAuditTrail(max)));
    const handler = (e: Event) => {
      setEntries(getAuditTrail(max));
    };
    window.addEventListener("alpha-audit-entry", handler);
    const poll = window.setInterval(() => setEntries(getAuditTrail(max)), 3000);
    return () => {
      window.removeEventListener("alpha-audit-entry", handler);
      window.clearInterval(poll);
    };
  }, [max]);

  if (entries.length === 0) {
    return (
      <div className="font-mono-ae flex h-full items-center justify-center p-6 text-center text-xs text-zinc-500">
        <div>
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p className="eyebrow mb-1">audit trail</p>
          <p>No consequential actions yet.</p>
          <p className="mt-1 text-zinc-600">The AI&apos;s writes, executions and escalations appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-ae font-mono-ae h-full overflow-y-auto p-3 text-xs">
      <p className="eyebrow mb-2 px-1">audit trail — consequential actions</p>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-2.5 py-2",
              entry.result === "ok" && "border-(--ae-emerald)/25 bg-(--ae-emerald)/5",
              entry.result === "error" && "border-(--ae-rose)/25 bg-(--ae-rose)/5",
              entry.result === "blocked" && "border-(--ae-gold)/25 bg-(--ae-gold)/5"
            )}
          >
            {entry.result === "ok" ? (
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--ae-emerald)" />
            ) : entry.result === "blocked" ? (
              <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--ae-gold)" />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--ae-rose)" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-zinc-200">{entry.action}</span>
                <span className="text-[10px] text-zinc-500">
                  {new Date(entry.time).toLocaleTimeString()} · {entry.level}
                </span>
              </div>
              <p className="truncate text-zinc-400" title={entry.detail}>
                {entry.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AuditTrail;
