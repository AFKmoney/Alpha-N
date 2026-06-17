"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { captureScreenshot, think } from "@/lib/alpha/ai-client";
import type { Mutation } from "@/lib/alpha/mutations";
import type { BeforeAfter } from "@/lib/alpha/mutations";

const CYCLE_MS = 28000; // autonomous cycle cadence
const MUTATION_STEP_MS = 420; // delay between applied mutations for visibility

/**
 * AutonomousLoop — the metacognitive heartbeat.
 *
 * Every cycle:
 *  1. capture a BEFORE screenshot of the workspace
 *  2. send screenshot + state to /api/alpha/think
 *  3. receive reasoning + mutations
 *  4. apply mutations one-by-one (animated, dense, visible)
 *  5. capture an AFTER screenshot
 *  6. open the before/after viewer so the user (and the next cycle's AI) can see the change
 *  7. repeat
 *
 * If the user sends a chat message, an immediate cycle fires with that instruction.
 */
export function AutonomousLoop({ workspaceRef }: { workspaceRef: React.RefObject<HTMLElement | null> }) {
  const store = useEvolution;
  const runningRef = useRef(false);

  const runCycle = useCallback(
    async (userMessage?: string) => {
      if (runningRef.current) return;
      runningRef.current = true;

      // Grab actions once — they are stable references in zustand.
      const st = store.getState();
      const {
        setAiBusy,
        applyMutation,
        setBeforeAfter,
      } = st;

      setAiBusy(true, "Observing my own interface…");

      // 1. BEFORE screenshot
      const before = await captureScreenshot(workspaceRef.current, "before");

      // 2. build state snapshot (re-read fresh state)
      const s = store.getState();
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
          },
          userMessage: userMessage ?? null,
          history: s.chat.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        applyMutation({
          type: "add_log",
          level: "critique",
          agent: "nucleus",
          message: `Cognitive call failed: ${msg.slice(0, 70)}`,
        });
        setAiBusy(false);
        runningRef.current = false;
        return;
      }

      // 4. apply mutations one-by-one with visible delay
      setAiBusy(true, result.reasoning || "Applying mutations to my own source…");

      const mutations: Mutation[] = Array.isArray(result.mutations) ? result.mutations : [];
      if (result.message) {
        const hasSpeak = mutations.some((m) => m.type === "speak");
        if (!hasSpeak) {
          mutations.push({
            type: "speak",
            message: result.message,
            reasoning: result.reasoning,
          });
        }
      }

      for (const m of mutations) {
        applyMutation(m as Mutation);
        await sleep(MUTATION_STEP_MS);
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
    [store, workspaceRef]
  );

  // Autonomous cadence — only when autonomy is on and not busy.
  const autonomy = useEvolution((s) => s.autonomy);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const diffOpen = useEvolution((s) => s.diffOpen);
  const beforeAfterOpen = useEvolution((s) => s.beforeAfterOpen);
  const chat = useEvolution((s) => s.chat);

  useEffect(() => {
    if (!autonomy) return;
    if (aiBusy || activeEvolution) return;
    // don't fire while a modal is blocking the view
    if (diffOpen || beforeAfterOpen) return;

    const id = setTimeout(() => {
      void runCycle();
    }, CYCLE_MS);
    return () => clearTimeout(id);
  }, [autonomy, aiBusy, activeEvolution, diffOpen, beforeAfterOpen, chat.length, runCycle]);

  // Fire an immediate cycle when the user sends a new message.
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
