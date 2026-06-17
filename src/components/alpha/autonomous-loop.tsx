"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import { captureScreenshot, think, webSearch, readFile, writeFile, runDebate, executeCode, runCompile } from "@/lib/alpha/ai-client";
import { describeMutation, type Mutation, type BeforeAfter, type WebSearchResult, type FileReadResult, type CodeExecResult, type CompileResult, type DebateResult, type MutationRewardEntry } from "@/lib/alpha/mutations";

const CYCLE_MS = 22000; // autonomous cycle cadence — responsive real-time control
const MUTATION_STEP_MS = 320;

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

      // 1. BEFORE screenshot — the AI's persistent visual of its own body
      const before = await captureScreenshot(workspaceRef.current, "before");

      // 2. FULL OS state for the LLM (1M token consciousness)
      const s = store.getState();
      const osS = osStore.getState();
      const fullCode = s.codeLines
        .map((l) => {
          const text = l.tokens.map((t) => t.text).join("");
          return `${String(l.no).padStart(2, "0")}│ ${text}`;
        })
        .join("\n");

      setAiBusy(true, "Consulting the cognitive council…");

      // 3. think — feed the FULL OS context: all code, all logs, all mutations,
      //    full chat history, all windows with positions, Akasha memory + intentions,
      //    protected files, search results. GLM 5.2 has 1M tokens — use them.
      let result;
      try {
        result = await think({
          screenshot: before,
          state: {
            generation: s.generation,
            version: s.version,
            aiState: s.aiState,
            metrics: s.metrics,
            fullCode,
            agents: s.agents.map((a) => ({
              role: a.role,
              status: a.status,
              thought: a.thought,
              load: a.load,
            })),
            allLogs: s.logs.map((l) => `[${l.level}] ${l.agent}: ${l.message}`),
            allMutations: s.mutationStream.map((m) => m.description),
            windows: osS.windows.map((w) => ({
              id: w.id,
              kind: w.kind,
              title: w.title,
              x: Math.round(w.x),
              y: Math.round(w.y),
              w: Math.round(w.w),
              h: Math.round(w.h),
              desktop: w.desktop,
            })),
            violations: osS.violationAttempts.map((v) => ({ path: v.path, reason: v.reason })),
            rollbacks: osS.rollbackEvents.length,
            searchResults: s.searchResults.slice(0, 3).map((sr) => ({
              query: sr.query,
              top: sr.results.slice(0, 4).map((r) => `${r.title} — ${r.snippet.slice(0, 120)} (${r.host})`),
            })),
            akashaMemory: s.akashaMemory.map((m) => ({ text: m.text, kind: m.kind })),
            akashaIntentions: s.akashaIntentions.map((i) => ({ text: i.text, priority: i.priority, resolved: i.resolved })),
            dynamicPrompt: s.dynamicPrompt,
            plans: s.plans.map((p) => ({
              id: p.id,
              goal: p.goal,
              rationale: p.rationale,
              status: p.status,
              steps: p.steps,
              progress: `${p.steps.filter((st) => st.done).length}/${p.steps.length}`,
            })),
            goals: s.goals.map((g) => ({ text: g.text, level: g.level })),
            fileReads: s.fileReads.slice(0, 4).map((f) => ({ path: f.path, content: f.content.slice(0, 2000) })),
            debateResults: s.debateResults.slice(0, 2).map((d) => ({
              proposal: d.proposal,
              consensus: d.consensus,
              opinions: d.opinions.map((o) => `${o.agent}: ${o.verdict} — ${o.opinion.slice(0, 100)}`),
            })),
            execResults: s.execResults.slice(0, 2).map((e) => ({
              language: e.language,
              ok: e.ok,
              stdout: e.stdout.slice(0, 500),
              stderr: e.stderr.slice(0, 300),
            })),
            compileResults: s.compileResults.slice(0, 2).map((c) => ({
              check: c.check,
              ok: c.ok,
              tscOutput: (c.tscOutput ?? "").slice(0, 400),
              eslintOutput: (c.eslintOutput ?? "").slice(0, 400),
            })),
            rewardModel: s.rewardModel.slice(0, 10).map((r) => ({
              kind: r.kind,
              delta: r.delta.toFixed(3),
              helpful: r.helpful,
            })),
            events: s.eventQueue.filter((e) => !e.handled).slice(0, 5).map((e) => ({ type: e.type, content: e.content.slice(0, 300) })),
            protectedFiles: osS.protectedFiles.map((f) => ({ path: f.path, reason: f.reason, critical: f.critical })),
            desktops: 4,
            activeDesktop: osS.activeDesktop,
            layoutMode: osS.layoutMode,
          },
          userMessage: userMessage ?? null,
          history: s.chat.map((m) => ({ role: m.role, content: m.content })),
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
        // ---- WEB SEARCH tool: when the AI emits a web_search mutation,
        // perform the search and store results for the next cycle ----
        if (m.type === "web_search" && m.query) {
          setAiBusy(true, `Searching the web: "${m.query.slice(0, 50)}"…`);
          try {
            const searchRes = await webSearch(m.query);
            const wsr: WebSearchResult = {
              query: m.query,
              time: Date.now(),
              results: searchRes.results,
            };
            store.getState().addSearchResults(wsr);
            // also open a browser window showing the first result so the user sees the research
            if (searchRes.results[0]?.url) {
              store.getState().applyMutation({
                type: "create_app",
                appType: "browser",
                title: `🔍 ${m.query.slice(0, 30)}`,
                url: searchRes.results[0].url,
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "search failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Web search failed: ${msg.slice(0, 60)}` });
          }
        }
        // ---- FILE READ tool: when the AI emits read_file, read the real file ----
        if (m.type === "read_file" && m.path) {
          setAiBusy(true, `Reading file: ${m.path}…`);
          try {
            const res = await readFile(m.path);
            if (res.type === "file" && res.content !== undefined) {
              store.getState().addFileRead({
                path: m.path,
                content: res.content,
                time: Date.now(),
              });
            } else if (res.type === "dir" && res.entries) {
              store.getState().addFileRead({
                path: m.path,
                content: `Directory listing:\n${res.entries.map((e) => `${e.isDir ? "[DIR] " : "      "}${e.name}`).join("\n")}`,
                time: Date.now(),
              });
            } else if (res.error) {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `File read error: ${res.error.slice(0, 60)}` });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "read failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `File read failed: ${msg.slice(0, 60)}` });
          }
        }
        // ---- FILE WRITE tool: when the AI emits write_file, write the real file ----
        if (m.type === "write_file" && m.path) {
          setAiBusy(true, `Writing file: ${m.path}…`);
          try {
            const res = await writeFile(m.path, m.content);
            if (res.error) {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `File write BLOCKED: ${res.error.slice(0, 60)}` });
              osStore.getState().recordViolation(m.path, `AI tried to write protected file: ${m.path}`);
            } else {
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Wrote ${m.content.length} bytes to ${m.path}`, });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "write failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `File write failed: ${msg.slice(0, 60)}` });
          }
        }
        // ---- LAYER A: AGENT DEBATE ----
        if (m.type === "debate" && m.proposal) {
          setAiBusy(true, `Convening the council to debate…`);
          try {
            const debateRes = await runDebate(
              m.proposal,
              `Generation ${store.getState().generation}, coherence ${store.getState().metrics.coherence.toFixed(2)}, entropy ${store.getState().metrics.entropy.toFixed(2)}`,
              store.getState().mutationStream.slice(0, 5).map((mut) => mut.description)
            );
            const dr: DebateResult = {
              proposal: m.proposal,
              opinions: debateRes.opinions.map((o) => ({
                agent: o.agent,
                opinion: o.opinion,
                verdict: o.verdict as "PROCEED" | "REVISE" | "REJECT",
              })),
              consensus: debateRes.consensus as "PROCEED" | "REVISE" | "REJECT",
              tally: debateRes.tally,
              time: Date.now(),
            };
            store.getState().addDebateResult(dr);
            // If the council says REJECT, push a log so the AI knows
            if (dr.consensus === "REJECT") {
              applyMutation({ type: "add_log", level: "critique", agent: "critic", message: `Council REJECTED: "${m.proposal.slice(0, 50)}". Do not proceed.` });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "debate failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Debate failed: ${msg.slice(0, 60)}` });
          }
        }
        // ---- LAYER C: SANDBOXED CODE EXECUTION ----
        if (m.type === "execute_code" && m.code) {
          setAiBusy(true, `Executing ${m.language} code…`);
          try {
            const execRes = await executeCode(m.code, m.language);
            const cer: CodeExecResult = {
              code: m.code,
              language: m.language,
              stdout: execRes.stdout ?? "",
              stderr: execRes.stderr ?? "",
              exitCode: execRes.exitCode ?? 1,
              ok: execRes.ok,
              time: Date.now(),
            };
            store.getState().addExecResult(cer);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "exec failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Code exec failed: ${msg.slice(0, 60)}` });
          }
        }
        // ---- LAYER E: REAL COMPILATION ----
        if (m.type === "compile") {
          setAiBusy(true, `Running ${m.check} check…`);
          try {
            const compileRes = await runCompile(m.check);
            const cr: CompileResult = {
              check: m.check,
              tscOk: compileRes.tscOk,
              tscOutput: compileRes.tscOutput,
              eslintOk: compileRes.eslintOk,
              eslintOutput: compileRes.eslintOutput,
              ok: compileRes.ok,
              time: Date.now(),
            };
            store.getState().addCompileResult(cr);
            // If compilation found errors, push them as events so the AI fixes them
            if (!cr.ok) {
              store.getState().pushEvent("compile_error", `${cr.tscOutput ?? ""}${cr.eslintOutput ?? ""}`.slice(0, 500));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "compile failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Compile failed: ${msg.slice(0, 60)}` });
          }
        }
      }

      // ---- LAYER D: FEEDBACK LEARNING — track reward for each mutation ----
      const afterMutations = store.getState();
      const coherenceAfter = afterMutations.metrics.coherence;
      const coherenceBefore = afterMutations.coherenceBefore;
      const delta = coherenceAfter - coherenceBefore;
      for (const m of mutations) {
        if (m.type === "set_state" || m.type === "speak" || m.type === "set_generation" || m.type === "set_version") continue;
        const entry: MutationRewardEntry = {
          kind: m.type,
          description: describeMutation(m),
          coherenceBefore,
          coherenceAfter,
          delta,
          helpful: delta >= 0,
          time: Date.now(),
        };
        store.getState().addReward(entry);
      }

      // ---- LAYER B: mark all events as handled (the AI has now seen them) ----
      const unhandled = store.getState().eventQueue.filter((e) => !e.handled);
      for (const e of unhandled) {
        store.getState().markEventHandled(e.id);
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
  const forceCycle = useEvolution((s) => s.forceCycle);
  const chat = useEvolution((s) => s.chat);
  const hydrateFromDb = useEvolution((s) => s.hydrateFromDb);
  const eventQueue = useEvolution((s) => s.eventQueue);

  // Hydrate persistent cognition (Akasha, plans, goals) from the DB on mount.
  // This is what makes the AI never forget — even across reloads.
  useEffect(() => {
    void hydrateFromDb();
  }, [hydrateFromDb]);

  // Manual "evolve" button forces an immediate real AI cycle.
  useEffect(() => {
    if (!forceCycle) return;
    if (aiBusy) return;
    useEvolution.setState({ forceCycle: false });
    void runCycle();
  }, [forceCycle, aiBusy, runCycle]);

  // ---- LAYER B: REACTIVE EVENTS — when unhandled events exist, fire an immediate cycle ----
  const unhandledCount = eventQueue.filter((e) => !e.handled).length;
  useEffect(() => {
    if (unhandledCount === 0) return;
    if (aiBusy) return;
    // Fire immediately — the AI needs to react to this event
    const t = setTimeout(() => void runCycle(), 500);
    return () => clearTimeout(t);
  }, [unhandledCount, aiBusy, runCycle]);

  useEffect(() => {
    if (!autonomy) return;
    if (aiBusy || activeEvolution) return;
    // Don't block on diffOpen/beforeAfterOpen anymore — those are now
    // non-intrusive notifications, not full-screen modals. The AI can keep
    // cycling while notifications are visible.
    const id = setTimeout(() => { void runCycle(); }, CYCLE_MS);
    return () => clearTimeout(id);
  }, [autonomy, aiBusy, activeEvolution, chat.length, runCycle]);

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
