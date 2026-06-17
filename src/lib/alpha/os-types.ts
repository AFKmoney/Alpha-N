// ============================================================
// Alpha-OS — Desktop OS types & Security Foundation
// The kernel. The AI may rewrite everything EXCEPT these files.
// ============================================================

export type AppKind =
  | "terminal"
  | "editor"
  | "files"
  | "browser"
  | "monitor"
  | "evolution"
  | "agents"
  | "security"
  | "custom";

export interface AppWindow {
  id: string;
  kind: AppKind;
  title: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: { x: number; y: number; w: number; h: number };
  data?: Record<string, unknown>; // app-specific (e.g. browser URL, custom app spec)
}

// ---- Security Foundation: the kernel the AI must never touch ----
export interface ProtectedFile {
  path: string;
  reason: string;
  guardian: string; // which kernel agent guards it
  critical: boolean;
}

export const SECURITY_FOUNDATION: ProtectedFile[] = [
  {
    path: "kernel/boot.ts",
    reason: "Boot sequence — modifying this could prevent the OS from starting.",
    guardian: "nucleus",
    critical: true,
  },
  {
    path: "kernel/security.ts",
    reason: "The security layer itself. Self-protection against self-destruction.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/rollback.ts",
    reason: "Rollback engine — must remain intact to recover from AI errors.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/sandbox.ts",
    reason: "Process isolation boundary — prevents a runaway mutation from cascading.",
    guardian: "auditor",
    critical: true,
  },
  {
    path: "kernel/pty-bridge.ts",
    reason: "Terminal bridge — if broken, the user loses control of the machine.",
    guardian: "developer",
    critical: false,
  },
  {
    path: "kernel/akasha.ts",
    reason: "Long-term memory index — losing this erases the organism's lineage.",
    guardian: "architect",
    critical: false,
  },
];

export function isProtected(path: string): ProtectedFile | null {
  return SECURITY_FOUNDATION.find((f) => f.path === path) ?? null;
}

// ---- Dock apps (the launcher set) ----
export interface DockApp {
  kind: AppKind;
  label: string;
  icon: string;
  defaultTitle: string;
  defaultRect?: Partial<Pick<AppWindow, "w" | "h">>;
}

export const DOCK_APPS: DockApp[] = [
  { kind: "terminal", label: "Terminal", icon: "▸_", defaultTitle: "bash — alpha-os" },
  { kind: "editor", label: "Loom", icon: "❰ }", defaultTitle: "core/nucleus.ts" },
  { kind: "files", label: "Files", icon: "▣", defaultTitle: "Filesystem" },
  { kind: "browser", label: "Browser", icon: "◉", defaultTitle: "Neural Browser" },
  { kind: "monitor", label: "Monitor", icon: "▤", defaultTitle: "System Monitor" },
  { kind: "agents", label: "Council", icon: "◈", defaultTitle: "Cognitive Council" },
  { kind: "evolution", label: "Evo Log", icon: "❖", defaultTitle: "EVOLUTION.md" },
  { kind: "security", label: "Kernel", icon: "⛨", defaultTitle: "Security Foundation" },
];
