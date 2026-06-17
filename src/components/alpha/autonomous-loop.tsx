"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { captureScreenshot, think } from "@/lib/alpha/ai-client";
import type { Mutation } from "@/lib/alpha/mutations";
import type { BeforeAfter } from "@/lib/alpha/mutations";

const CYCLE_MS = 32000;
const MUTATION_STEP_MS = 380;

export function AutonomousLoop({ workspaceRef }: { workspaceRef: React.RefObject<HTMLElement | null> }) {
  const store = useEvolution;
  const osStore = useOS;
  const runningRef = useRef(false);

  const runCycle = useCallback(
    async (userMessage?: string) => {
      if (runningRef.current) return;
      runningRef.current = true;

      const st = store.getState();
      const os = osStore.getState();
      const { setAiBusy, applyMutation, setBeforeAfter } = st;

      setAiBusy(true, "Observing my own desktop…");

      // ---- SNAPSHOT before mutations (for rollback) ----
      const curState = store.getState();
      const curOs = osStore.getState();
      const snapshot = os.takeSnapshot(`pre-cycle gen ${curState.generation}`, {
        windows: curOs.windows,
        codeLines: curState.codeLines,
        agents: curState.agents,
        metrics: curState.metrics,
        version: curState.version,
        generation: curState.generation,
      });

      // 1. BEFORE screenshot
      const before = await captureScreenshot(workspaceRef.current, "before");

      // 2. state snapshot for the LLM
      const s = store.getState();
      const osS = osStore.getState();
      const codePreview = s.codeLines
        .slice(0, 18)
        .map((l) => {
          const text = l.tokens.map((t) => t.text).join("");
          return `${String(l.no).padStart(2, "0")}│ ${text}`;
        })
        .join("\n");

      setAiBusy(true, "Consulting the cognitive council…");

      // 3. think
      let result;
      try {
        result = await think({
          screenshot: before,
          state: {
            generation: s.generation,
            version: s.version,
            aiState: s.aiState,
            metrics: s.metrics,
            codePreview,
            agents: s.agents.map((a) => ({
              role: a.role,
              status: a.status,
              thought: a.thought,
              load: a.load,
            })),
            recentLogs: s.logs.slice(0, 6).map((l) => `[${l.level}] ${l.agent}: ${l.message}`),
            recentMutations: s.mutationStream.slice(0, 6).map((m) => m.description),
            windows: osS.windows.map((w) => ({ id: w.id, kind: w.kind, title: w.title })),
            violations: osS.violationAttempts.slice(0, 4).map((v) => ({ path: v.path, reason: v.reason })),
            rollbacks: osS.rollbackEvents.length,
          },
          userMessage: userMessage ?? null,
          history: s.chat.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Cognitive call failed: ${msg.slice(0, 70)}` });
        setAiBusy(false);
        runningRef.current = false;
        return;
      }

      // 4. apply mutations one-by-one
      setAiBusy(true, result.reasoning || "Applying mutations to my own source…");

      const mutations: Mutation[] = Array.isArray(result.mutations) ? result.mutations : [];
      if (result.message) {
        const hasSpeak = mutations.some((m) => m.type === "speak");
        if (!hasSpeak) {
          mutations.push({ type: "speak", message: result.message, reasoning: result.reasoning });
        }
      }

      // Track if any mutation was rejected/blocked
      let hadError = false;
      const streamBefore = store.getState().mutationStream.length;

      for (const m of mutations) {
        applyMutation(m as Mutation);
        await sleep(MUTATION_STEP_MS);
        // check if the latest mutation stream entry is a violation
        const stream = store.getState().mutationStream;
        if (stream.length > streamBefore) {
          const latest = stream[0];
          if (latest.kind === "violation") {
            hadError = true;
          }
        }
      }

      // ---- AUTO-ROLLBACK if the AI broke something ----
      const afterState = store.getState();
      const criticalEntropy = afterState.metrics.entropy > 0.95;
      if (hadError || criticalEntropy) {
        const reason = criticalEntropy
          ? "Entropy exceeded critical threshold (0.95) — system destabilising."
          : "A mutation was rejected by validation/security.";
        const restored = osStore.getState().rollback(snapshot, reason);
        // restore evolution state from snapshot
        store.setState({
          codeLines: restored.codeLines,
          agents: restored.agents,
          metrics: restored.metrics,
        });
        store.getState().applyMutation({
          type: "add_log",
          level: "heal",
          agent: "nucleus",
          message: `↺ ROLLBACK: ${reason} Restored to ${snapshot.label}.`,
        });
      }

      // 5. AFTER screenshot
      await sleep(300);
      const after = await captureScreenshot(workspaceRef.current, "after");

      // 6. before/after viewer
      if (before && after) {
        const cur = store.getState();
        const ba: BeforeAfter = {
          id: `ba-${Date.now()}`,
          label: `Generation ${cur.generation} · v${cur.version}`,
          before,
          after,
          time: Date.now(),
          summary: result.message || result.reasoning || "Self-improvement applied.",
        };
        setBeforeAfter(ba);
      }

      setAiBusy(false);
      runningRef.current = false;
    },
    [store, osStore, workspaceRef]
  );

  const autonomy = useEvolution((s) => s.autonomy);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const diffOpen = useEvolution((s) => s.diffOpen);
  const beforeAfterOpen = useEvolution((s) => s.beforeAfterOpen);
  const chat = useEvolution((s) => s.chat);

  useEffect(() => {
    if (!autonomy) return;
    if (aiBusy || activeEvolution) return;
    if (diffOpen || beforeAfterOpen) return;
    const id = setTimeout(() => { void runCycle(); }, CYCLE_MS);
    return () => clearTimeout(id);
  }, [autonomy, aiBusy, activeEvolution, diffOpen, beforeAfterOpen, chat.length, runCycle]);

  const lastChatLen = useRef(chat.length);
  useEffect(() => {
    if (chat.length > lastChatLen.current) {
      const last = chat[chat.length - 1];
      if (last?.role === "user") {
        void runCycle(last.content);
      }
    }
    lastChatLen.current = chat.length;
  }, [chat, runCycle]);

  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
