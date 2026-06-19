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
  // Reject absolute paths outright — the AI may only address the project by
  // relative path. (Stripping leading slashes would let /etc/shadow sneak in
  // as a project-relative path, which is a real traversal vector.)
  if (path.isAbsolute(relPath)) return null;
  // Resolve against root then normalise. path.resolve collapses "..".
  const full = path.resolve(PROJECT_ROOT, relPath);
  // Guard: the resolved path must be inside PROJECT_ROOT. Use path.relative
  // to detect escapes robustly across OSes (handles .., drive letters).
  // On Windows, a relative path that crosses to another drive yields an
  // absolute path.relative result — caught by path.isAbsolute(rel).
  const rel = path.relative(PROJECT_ROOT, full);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return full;
  }
  return null;
}

/**
 * Resolve a sandbox-relative path (same guard, different root).
 */
export function resolveSandboxSafe(relPath: string): string | null {
  if (!relPath || typeof relPath !== "string") return null;
  if (path.isAbsolute(relPath)) return null;
  const full = path.resolve(SANDBOX_ROOT, relPath);
  const rel = path.relative(SANDBOX_ROOT, full);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return full;
  }
  return null;
}

/** True if the given project-relative path is inside the project root. */
export function isWithinProject(relPath: string): boolean {
  return resolveSafe(relPath) !== null;
}
