// ============================================================
// Alpha-N — Cross-platform path resolution
//
// Historically the project was hardcoded to /home/z/my-project (Linux).
// This module derives the project root at runtime from the server
// environment so the OS works on Windows, macOS, and Linux alike.
//
// Resolution order:
//   1. ALPHA_PROJECT_ROOT env var (explicit override)
//   2. process.env.PROJECT_ROOT (legacy/CI)
//   3. process.cwd() (wherever the Next.js server is launched from)
//
// Server-only. Never import this from a client component.
// ============================================================

import path from "path";
import os from "os";

/**
 * The absolute, normalised project root. All AI file operations are
 * constrained to live within this directory (see resolveSafe in the
 * files API). Deriving from cwd() makes the OS portable: run it from
 * wherever the repo was cloned.
 */
export const PROJECT_ROOT: string = path.resolve(
  process.env.ALPHA_PROJECT_ROOT ||
    process.env.PROJECT_ROOT ||
    process.cwd()
);

/**
 * The sandbox directory where AI-generated code is written and executed.
 * Placed OUTSIDE the project root by default so a sandboxed process cannot
 * read project source or node_modules unless explicitly granted.
 */
export const SANDBOX_ROOT: string = path.resolve(
  process.env.ALPHA_SANDBOX_ROOT ||
    path.join(os.tmpdir(), "alpha-sandbox")
);

/** SQLite database location (default: db/custom.db relative to root). */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // file: URL form expected by Prisma SQLite
  const dbPath = path.join(PROJECT_ROOT, "db", "custom.db");
  // Use forward slashes so Prisma parses it consistently across OSes.
  return `file:${dbPath.replace(/\\/g, "/")}`;
}

/**
 * Resolve a project-relative path to an absolute one, refusing anything
 * that escapes the project root (path traversal guard). Returns null if
 * the path is unsafe.
 *
 * Server-side canonical guard — the files API and any other FS-touching
 * route MUST route through this.
 */
export function resolveSafe(relPath: string): string | null {
  if (!relPath || typeof relPath !== "string") return null;
  // Strip any leading slashes so we always anchor at the project root.
  let cleaned = relPath.replace(/^[\\/]+/, "");
  // Resolve against root then normalise. path.resolve collapses "..".
  const full = path.normalize(path.join(PROJECT_ROOT, cleaned));
  // Guard: the resolved path must be inside PROJECT_ROOT (same drive on
  // Windows, same prefix elsewhere). Use path.relative to detect escapes
  // robustly across OSes (handles .., symlinks in name, drive letters).
  const rel = path.relative(PROJECT_ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

/**
 * Resolve a sandbox-relative path (same guard, different root).
 */
export function resolveSandboxSafe(relPath: string): string | null {
  if (!relPath || typeof relPath !== "string") return null;
  let cleaned = relPath.replace(/^[\\/]+/, "");
  const full = path.normalize(path.join(SANDBOX_ROOT, cleaned));
  const rel = path.relative(SANDBOX_ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

/** True if the given project-relative path is inside the project root. */
export function isWithinProject(relPath: string): boolean {
  return resolveSafe(relPath) !== null;
}
