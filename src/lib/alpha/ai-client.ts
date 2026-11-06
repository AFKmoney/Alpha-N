/**
 * ai-client.ts — the client-side bridge between the OS loop and the
 * cognitive endpoints. Every outward action of the AI goes through here:
 * screenshots (html-to-image, [data-ai-skip] elements excluded), the think
 * call, web search, real file IO, council debate, sandboxed execution,
 * real compilation and the autonomy audit.
 */
import { toPng } from "html-to-image";
import type { AutonomyLevel } from "./autonomy-policy";
import type {
  Mutation,
  WebSearchHit,
  CodeExecResult,
  CompileResult,
  DebateResult,
} from "./mutations";

export interface ThinkStatePayload {
  generation: number;
  version: string;
  aiState: string;
  autonomyMode: string;
  metrics: { cpu: number; ram: number; entropy: number; coherence: number };
  fullCode: string;
  agents: { role: string; status: string; thought: string | null; load: number }[];
  allLogs: string[];
  allMutations: string[];
  windows: { id: string; kind: string; title: string; x: number; y: number; w: number; h: number; desktop: number }[];
  violations: { path: string; reason: string }[];
  rollbacks: number;
  searchResults: { query: string; top: string[] }[];
  akashaMemory: { text: string; kind: string }[];
  akashaIntentions: { text: string; priority: string; resolved: boolean }[];
  dynamicPrompt: string;
  plans: { id: string; goal: string; rationale: string; status: string; steps: { text: string; done: boolean }[]; progress: string }[];
  goals: { text: string; level: string }[];
  fileReads: { path: string; content: string }[];
  debateResults: { proposal: string; consensus: string; opinions: string[] }[];
  execResults: { language: string; ok: boolean; stdout: string; stderr: string }[];
  compileResults: { check: string; ok: boolean; tscOutput: string; eslintOutput: string }[];
  rewardModel: { kind: string; delta: string; helpful: boolean }[];
  events: { type: string; content: string }[];
  protectedFiles: { path: string; reason: string; critical: boolean }[];
  desktops: number;
  activeDesktop: number;
  layoutMode: string;
  episodeLog: { action: string; description: string; result: string; reward: number; cycle: number }[];
  realMetrics: {
    errorRate: number;
    taskCompletionRate: number;
    userSatisfaction: number;
    totalActions: number;
    totalErrors: number;
    totalRollbacks: number;
  };
  constraints: { text: string; scope: string }[];
  persistedLessons?: { id: string; text: string; weight: number; createdAt: number }[];
}

export interface ThinkPayload {
  screenshot: string | null;
  state: ThinkStatePayload;
  userMessage: string | null;
  history: { role: "user" | "ai"; content: string }[];
}

export interface ThinkResult {
  mutations: Mutation[];
  reasoning: string;
  message: string;
  rateLimited?: boolean;
  error?: string;
}

/** Capture the workspace. `kind` only tags the request for debugging. */
export async function captureScreenshot(
  el: HTMLElement | null,
  kind: "before" | "after"
): Promise<string | null> {
  if (!el || typeof window === "undefined") return null;
  try {
    const dataUrl = await toPng(el, {
      cacheBust: true,
      pixelRatio: 1,
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute("data-ai-skip")),
    });
    return dataUrl;
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`screenshot(${kind}) failed — continuing without visual context`);
    }
    return null;
  }
}

export async function think(payload: ThinkPayload): Promise<ThinkResult> {
  try {
    const res = await fetch("/api/alpha/think", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ThinkResult & { error?: string };
    return {
      mutations: Array.isArray(data.mutations) ? data.mutations : [],
      reasoning: data.reasoning ?? "",
      message: data.message ?? "",
      rateLimited: Boolean(data.rateLimited),
      error: data.error,
    };
  } catch (err) {
    return {
      mutations: [],
      reasoning: "",
      message: "",
      error: err instanceof Error ? err.message : "network error",
      rateLimited: false,
    };
  }
}

export async function webSearch(query: string): Promise<{ results: WebSearchHit[] }> {
  const res = await fetch("/api/alpha/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = (await res.json()) as { results?: WebSearchHit[]; error?: string };
  if (data.error) throw new Error(data.error);
  return { results: data.results ?? [] };
}

export interface FileApiResponse {
  type: "file" | "dir";
  content?: string;
  entries?: { name: string; isDir: boolean }[];
  error?: string;
}

export async function readFile(path: string): Promise<FileApiResponse> {
  const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(path)}`);
  return (await res.json()) as FileApiResponse;
}

export async function writeFile(path: string, content: string): Promise<{ error?: string; ok?: boolean }> {
  try {
    const res = await fetch("/api/alpha/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return (await res.json()) as { error?: string; ok?: boolean };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "write failed" };
  }
}

export async function runDebate(
  proposal: string,
  context: string,
  recentMutationDescriptions: string[]
): Promise<Pick<DebateResult, "opinions" | "consensus" | "tally">> {
  const res = await fetch("/api/alpha/debate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposal, context, recent: recentMutationDescriptions }),
  });
  const data = (await res.json()) as Pick<DebateResult, "opinions" | "consensus" | "tally"> & { error?: string };
  if (data.error) throw new Error(data.error);
  return {
    opinions: data.opinions ?? [],
    consensus: data.consensus ?? "REVISE",
    tally: data.tally ?? { proceed: 0, revise: 0, reject: 0 },
  };
}

export async function executeCode(
  code: string,
  language: string,
  opts: { level: AutonomyLevel; network: boolean }
): Promise<Pick<CodeExecResult, "stdout" | "stderr" | "exitCode" | "ok"> & { error?: string }> {
  try {
    const res = await fetch("/api/alpha/exec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, language, network: opts.network, level: opts.level }),
    });
    const data = (await res.json()) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      ok?: boolean;
      error?: string;
    };
    return {
      stdout: data.stdout ?? "",
      stderr: data.stderr ?? data.error ?? "",
      exitCode: data.exitCode ?? 1,
      ok: Boolean(data.ok),
    };
  } catch (err) {
    return { stdout: "", stderr: err instanceof Error ? err.message : "exec failed", exitCode: 1, ok: false };
  }
}

export async function runCompile(check: string): Promise<CompileResult> {
  const res = await fetch("/api/alpha/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check }),
  });
  const data = (await res.json()) as Omit<CompileResult, "time"> & { error?: string };
  return {
    check: data.check ?? "both",
    tscOk: Boolean(data.tscOk),
    tscOutput: data.tscOutput ?? null,
    eslintOk: Boolean(data.eslintOk),
    eslintOutput: data.eslintOutput ?? null,
    ok: Boolean(data.ok),
    time: Date.now(),
  };
}

/**
 * Record a consequential action in the audit journal (fire-and-forget).
 * Persists via the akasha route (SystemEvent) and mirrors to the live
 * journal used by <AuditTrail />.
 */
export async function auditAction(
  action: string,
  detail: string,
  level: AutonomyLevel,
  extra?: { detail?: string; result?: string }
): Promise<void> {
  try {
    await fetch("/api/alpha/akasha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "event",
        eventType: "audit",
        content: JSON.stringify({
          action,
          detail: extra?.detail ?? detail,
          level,
          result: extra?.result ?? "ok",
          time: Date.now(),
        }),
      }),
    });
  } catch {
    // audit must never break the loop
  }
}
