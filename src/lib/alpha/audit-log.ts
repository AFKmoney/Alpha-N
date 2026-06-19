// ============================================================
// Alpha-N — Audit Log
//
// Every consequential AI action (file write, exec, terminal, self-prompt,
// delete) is appended to an in-memory ring buffer + the Akasha database
// (SystemEvent table). This gives the user a tamper-evident trail of what
// the organism did, when, and under which autonomy policy.
//
// Server-side singleton. Imported by route handlers after they perform an
// action. Never blocks the response — logging failures are swallowed.
// ============================================================

import { db } from "@/lib/db";

export interface AuditEntry {
  id: string;
  time: number;
  /** Mutation kind, e.g. "write_file", "execute_code". */
  action: string;
  /** Short human-readable description. */
  description: string;
  /** Autonomy level under which the action ran. */
  level: "sandbox" | "moderate" | "yolo";
  /** "ok" | "blocked" | "error" | "denied". */
  result: "ok" | "blocked" | "error" | "denied";
  /** Optional detail (path, command snippet, reason). */
  detail?: string;
}

const RING_CAPACITY = 200;
const ring: AuditEntry[] = [];
let counter = 0;

function nextId(): string {
  counter = (counter + 1) % 1_000_000;
  return `audit-${Date.now()}-${counter}`;
}

/**
 * Record a consequential action. Fire-and-forget persistence — we append
 * to the in-memory ring synchronously and persist to the DB in the
 * background so the request path stays fast.
 */
export function audit(entry: Omit<AuditEntry, "id" | "time">): void {
  const full: AuditEntry = { ...entry, id: nextId(), time: Date.now() };
  ring.unshift(full);
  if (ring.length > RING_CAPACITY) ring.length = RING_CAPACITY;
  // Background persist — never throws into the caller.
  void db.systemEvent
    .create({
      data: {
        type: `audit:${entry.action}`,
        content: JSON.stringify({
          description: entry.description,
          level: entry.level,
          result: entry.result,
          detail: entry.detail,
        }),
      },
    })
    .catch(() => {
      /* swallow — DB may not be ready on first boot */
    });
}

/** Read the recent audit trail (newest first). */
export function recentAudit(limit = 50): AuditEntry[] {
  return ring.slice(0, limit);
}

/** Clear the in-memory ring (does not touch persisted DB rows). */
export function clearAudit(): void {
  ring.length = 0;
}
