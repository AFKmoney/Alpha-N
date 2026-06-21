/**
 * autonomous-loop.tsx — the real AI driver. Captures a screenshot of the
 * desktop, sends it + full OS state to /api/alpha/think, then applies the
 * returned mutations one-by-one. Handles web_search, read_file, write_file,
 * debate, execute_code, compile, and rollback tools. Runs on a 22s cadence
 * in "active" mode and reacts to user chat / unhandled events in both modes.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEvolution } from "@/lib/alpha/evolution-store";
import { useOS } from "@/lib/alpha/os-store";
import type { AppKind } from "@/lib/alpha/os-types";
import { captureScreenshot, think, webSearch, readFile, writeFile, runDebate, executeCode, runCompile, auditAction } from "@/lib/alpha/ai-client";
import { describeMutation, type Mutation, type BeforeAfter, type WebSearchResult, type CodeExecResult, type CompileResult, type DebateResult, type MutationRewardEntry, type EpisodeEntry } from "@/lib/alpha/mutations";
import { getPolicy, authorize, isConsequential, type AutonomyLevel } from "@/lib/alpha/autonomy-policy";
import { computeReward } from "@/lib/alpha/reward-model";
import { buildLesson, derivePersistedLesson } from "@/lib/alpha/learning-engine";

const CYCLE_MS = 22000; // autonomous cycle cadence — responsive real-time control
const MUTATION_STEP_MS = 320;

export function AutonomousLoop({ workspaceRef }: { workspaceRef: React.RefObject<HTMLElement | null> }) {
  const store = useEvolution;
  const osStore = useOS;
  const runningRef = useRef(false);
  const consecutiveErrorsRef = useRef(0); // for exponential backoff on rate limits

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
            autonomyMode: s.autonomyMode,
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
            // ---- Phase 1/3/4: episodic memory + metrics + constraints ----
            episodeLog: s.episodeLog.slice(-20).map((e) => ({
              action: e.action,
              description: e.description,
              result: e.result,
              reward: e.reward,
              cycle: e.cycle,
            })),
            realMetrics: s.realMetrics,
            constraints: s.constraints.map((c) => ({ text: c.text, scope: c.scope })),
            // Send accumulated lessons from PREVIOUS cycles so the AI reads
            // its own feedback before deciding what to do this cycle.
            persistedLessons: s.persistedLessons,
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

      // 4. Handle rate-limiting / errors gracefully
      if (result.rateLimited || (result.error && result.mutations.length === 0)) {
        // The cognitive API is rate-limited or errored. Log ONCE, don't speak
        // (avoid chat noise), and set a backoff flag so the next cycle waits longer.
        const logLevel = result.rateLimited ? "critique" : "critique";
        const logMsg = result.rateLimited
          ? "Cognitive API rate-limited (429). Backing off — will retry with longer delay."
          : `Cognitive error: ${(result.error ?? "unknown").slice(0, 70)}`;
        // Only log if the last log isn't already the same (avoid log spam)
        const lastLog = store.getState().logs[0];
        if (!lastLog || !lastLog.message.includes("rate-limited") && !lastLog.message.includes("Cognitive error")) {
          applyMutation({ type: "add_log", level: logLevel, agent: "nucleus", message: logMsg });
        }
        // Set the backoff flag — the cycle useEffect will use a longer delay
        consecutiveErrorsRef.current = Math.min(consecutiveErrorsRef.current + 1, 5);
        setAiBusy(false);
        runningRef.current = false;
        return;
      }

      // Success — reset error counter
      consecutiveErrorsRef.current = 0;

      // 5. apply mutations one-by-one
      setAiBusy(true, result.reasoning || "Applying mutations to my own source…");

      const mutations: Mutation[] = Array.isArray(result.mutations) ? result.mutations : [];
      // Only auto-add a speak mutation if there are real mutations AND a message.
      // Don't speak error messages (those are handled above).
      if (result.message && mutations.length > 0) {
        const hasSpeak = mutations.some((m) => m.type === "speak");
        if (!hasSpeak) {
          mutations.push({ type: "speak", message: result.message, reasoning: result.reasoning });
        }
      }

      // Track if any mutation was rejected/blocked
      let hadError = false;
      const streamBefore = store.getState().mutationStream.length;

      // Resolve the active autonomy policy once per cycle. Consequential
      // mutations (file writes, exec, self-prompt, delete) are gated by it.
      const currentLevel: AutonomyLevel = store.getState().autonomyLevel;
      const policy = getPolicy(currentLevel);
      // Simple client-side rate limiter for consequential actions.
      const actionTimestamps: number[] = [];
      const rateLimitMs = 60_000;

      // ---- OBJECTIVE REWARD TRACKING ----
      // Per-mutation outcome sets, populated as the loop runs. These feed
      // the objective reward model (verifiable signals, not self-report).
      const toolOk = new Set<string>(); // mutations whose tool call succeeded
      const toolError = new Set<string>(); // mutations whose tool errored
      const blocked = new Set<string>(); // mutations denied by policy/security

      for (let mi = 0; mi < mutations.length; mi++) {
        const m = mutations[mi];
        const mType = (m as { type?: string }).type ?? "unknown";

        // ---- AUTONOMY POLICY GATE ----
        // Every mutation is authorised against the active policy. Denied
        // mutations are logged and skipped — the AI is told why so it can
        // adapt (e.g. switch approach or ask the user to raise the level).
        const verdict = authorize(mType, policy);
        if (!verdict.allowed) {
          blocked.add(String(mi));
          applyMutation({
            type: "add_log",
            level: "critique",
            agent: "nucleus",
            message: `⊘ BLOCKED by autonomy policy [${policy.level}]: ${verdict.reason}`,
          });
          // Record to the mutation stream as a denial so the AI sees it.
          store.getState().applyMutation({
            type: "add_log",
            level: "critique",
            agent: "critic",
            message: `Denied "${mType}": ${verdict.reason}`,
          });
          continue;
        }

        // ---- RATE LIMIT (consequential actions only) ----
        if (isConsequential(mType) && policy.capabilities.actionsPerMinute > 0) {
          const now = Date.now();
          // Drop timestamps older than the window.
          while (actionTimestamps.length && now - actionTimestamps[0] > rateLimitMs) {
            actionTimestamps.shift();
          }
          if (actionTimestamps.length >= policy.capabilities.actionsPerMinute) {
            blocked.add(String(mi));
            applyMutation({
              type: "add_log",
              level: "critique",
              agent: "critic",
              message: `⊘ Rate limit hit (${policy.capabilities.actionsPerMinute}/min under ${policy.level}). Deferring "${mType}".`,
            });
            continue;
          }
          actionTimestamps.push(now);
        }

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
              toolError.add(String(mi));
              blocked.add(String(mi));
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `File write BLOCKED: ${res.error.slice(0, 60)}` });
              osStore.getState().recordViolation(m.path, `AI tried to write protected file: ${m.path}`);
            } else {
              toolOk.add(String(mi));
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Wrote ${m.content.length} bytes to ${m.path}`, });
            }
          } catch (err) {
            toolError.add(String(mi));
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
          // Persist an audit entry before running — track what's about to happen.
          try {
            await auditAction("execute_code", `${m.language} snippet (${m.code.length}b)`, currentLevel, { detail: m.code.slice(0, 200) });
          } catch { /* audit best-effort */ }
          try {
            const execRes = await executeCode(m.code, m.language, {
              level: currentLevel,
              network: policy.capabilities.execNetwork,
            });
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
            if (execRes.ok) toolOk.add(String(mi)); else toolError.add(String(mi));
            await auditAction("execute_code", `${m.language} snippet`, currentLevel, { result: execRes.ok ? "ok" : "error" }).catch(() => {});
          } catch (err) {
            toolError.add(String(mi));
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
        // ---- AI POWER: OS control mutations ----
        // The AI can now pin/unpin apps, create sectors/vectors, snap windows,
        // change theme/wallpaper, and manage desktops directly.
        if (m.type === "pin_to_taskbar" && m.app) {
          osStore.getState().pinToTaskbar(m.app as AppKind);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Pinned ${m.app} to taskbar` });
        }
        if (m.type === "unpin_from_taskbar" && m.app) {
          osStore.getState().unpinFromTaskbar(m.app as AppKind);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Unpinned ${m.app} from taskbar` });
        }
        if (m.type === "pin_to_desktop" && m.app) {
          osStore.getState().pinToDesktop(m.app as AppKind);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Pinned ${m.app} to desktop` });
        }
        if (m.type === "create_sector" && m.path) {
          setAiBusy(true, `Creating sector: ${m.path}…`);
          try {
            const res = await fetch("/api/alpha/files", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path: m.path, action: "mkdir" }),
            });
            const data = await res.json();
            if (data.ok) {
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Created sector: ${m.path}` });
            } else {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Sector creation failed: ${data.error?.slice(0, 60)}` });
            }
          } catch { /* ignore */ }
        }
        if (m.type === "create_vector" && m.path) {
          setAiBusy(true, `Creating vector: ${m.path}…`);
          try {
            const res = await fetch("/api/alpha/files", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path: m.path, action: "touch" }),
            });
            const data = await res.json();
            if (data.ok) {
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Created vector: ${m.path}` });
            } else {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Vector creation failed: ${data.error?.slice(0, 60)}` });
            }
          } catch { /* ignore */ }
        }
        if (m.type === "delete_file" && m.path) {
          setAiBusy(true, `Deleting: ${m.path}…`);
          try {
            const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(m.path)}`, { method: "DELETE" });
            const data = await res.json();
            if (data.ok) {
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Deleted: ${m.path}` });
            } else {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Delete failed: ${data.error?.slice(0, 60)}` });
            }
          } catch { /* ignore */ }
        }
        if (m.type === "snap_window" && m.windowId) {
          osStore.getState().snapWindow(m.windowId, m.snap);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Snapped window ${m.windowId} to ${m.snap}` });
        }
        if (m.type === "set_theme") {
          osStore.getState().setTheme(m.theme);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Theme set to ${m.theme}` });
        }
        if (m.type === "set_wallpaper" && m.presetId) {
          window.dispatchEvent(new CustomEvent("alpha-wallpaper-change", { detail: { presetId: m.presetId } }));
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Wallpaper set to ${m.presetId}` });
        }
        if (m.type === "minimize_all") {
          osStore.getState().minimizeAll();
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Minimized all windows (show desktop)` });
        }
        if (m.type === "set_always_on_top" && m.windowId) {
          osStore.getState().setAlwaysOnTop(m.windowId, m.onTop);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Window ${m.windowId} always-on-top: ${m.onTop}` });
        }
        if (m.type === "switch_desktop") {
          osStore.getState().setActiveDesktop(m.desktop);
          applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Switched to desktop ${m.desktop + 1}` });
        }
        // ---- AI POWER: OS-as-context mutations ----
        if (m.type === "navigate_graph" && m.path) {
          setAiBusy(true, `Navigating graph: ${m.path}…`);
          try {
            // Fetch the file graph scoped to this path's neighbourhood
            const res = await fetch(`/api/alpha/file-graph?path=${encodeURIComponent(m.path)}`);
            const data = await res.json();
            // Store the graph neighbourhood in the evolution store for the AI to see
            store.getState().addFileRead({
              path: `[graph:${m.path}]`,
              content: `Nodes: ${data.nodes.length}, Edges: ${data.edges.length}\n` +
                data.nodes.map((n: { path: string; kind: string; lines: number }) =>
                  `  ${n.kind === "dir" ? "[DIR]" : "     "} ${n.path} (${n.lines} lines)`
                ).join("\n"),
              time: Date.now(),
            });
            applyMutation({ type: "add_log", level: "observe", agent: "architect", message: `Navigated graph to ${m.path} (${data.nodes.length} neighbors)` });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "graph failed";
            applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Graph navigation failed: ${msg.slice(0, 60)}` });
          }
        }
        if (m.type === "create_app_from_code" && m.name && m.code) {
          setAiBusy(true, `Installing AI-coded app: ${m.name}…`);
          try {
            // Save the AI-generated code as a generated app in the DB
            const res = await fetch("/api/alpha/generate-app", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "install",
                name: m.name,
                description: m.description || "AI-generated app",
                category: m.category || "AI Tools",
                code: m.code,
              }),
            });
            const data = await res.json();
            if (data.ok) {
              // Pin to desktop so the user sees it immediately
              osStore.getState().pinToDesktop("custom", {
                label: m.name,
                icon: "✨",
                data: { spec: m.description || "AI-generated", generatedAppId: data.app?.id },
              });
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Created and installed app: ${m.name}` });
            } else {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `App install failed: ${data.error?.slice(0, 60)}` });
            }
          } catch { /* ignore */ }
        }
        if (m.type === "create_wallpaper" && m.name) {
          setAiBusy(true, `Creating wallpaper: ${m.name}…`);
          try {
            // Save the wallpaper description as a UserPreference so the wallpaper system can pick it up
            const res = await fetch("/api/alpha/wallpaper", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "save",
                presetId: `ai-${Date.now()}`,
                name: m.name,
                config: { description: m.description, colors: m.colors, aiGenerated: true },
              }),
            });
            const data = await res.json();
            if (data.ok) {
              applyMutation({ type: "add_log", level: "deploy", agent: "developer", message: `Created wallpaper: ${m.name} (${m.colors.join(", ")})` });
            } else {
              applyMutation({ type: "add_log", level: "critique", agent: "nucleus", message: `Wallpaper creation failed` });
            }
          } catch { /* ignore */ }
        }
        if (m.type === "list_directory" && m.path) {
          setAiBusy(true, `Listing: ${m.path}…`);
          try {
            const res = await fetch(`/api/alpha/files?path=${encodeURIComponent(m.path)}`);
            const data = await res.json();
            if (data.type === "dir") {
              store.getState().addFileRead({
                path: `[dir:${m.path}]`,
                content: `Directory listing:\n${data.entries.map((e: { name: string; isDir: boolean }) => `${e.isDir ? "[DIR] " : "      "}${e.name}`).join("\n")}`,
                time: Date.now(),
              });
              applyMutation({ type: "add_log", level: "observe", agent: "architect", message: `Listed ${m.path}: ${data.entries.length} entries` });
            }
          } catch { /* ignore */ }
        }
      }

      // ---- LAYER D: FEEDBACK LEARNING — track reward for each mutation ----
      const afterMutations = store.getState();
      const coherenceAfter = afterMutations.metrics.coherence;
      const coherenceBefore = afterMutations.coherenceBefore;
      const delta = coherenceAfter - coherenceBefore;

      // ---- Phase 1: Episodic memory — log every meaningful action ----
      // Reward is now OBJECTIVE: computed from verifiable tool outcomes
      // (exec exit code, file write result, policy block, rollback) rather
      // than the AI's self-reported coherence. This closes the
      // "grading its own homework" loophole.
      // Determine rollback status up-front so it feeds the reward signal.
      const criticalEntropyRollback = afterMutations.metrics.entropy > 0.95;
      const willRollback = hadError || criticalEntropyRollback;
      const cycleGen = afterMutations.generation;
      for (let mi = 0; mi < mutations.length; mi++) {
        const m = mutations[mi];
        if (m.type === "set_state" || m.type === "speak" || m.type === "set_generation" || m.type === "set_version") continue;
        const key = String(mi);
        const objectiveReward = computeReward({
          toolOk: toolOk.has(key),
          toolError: toolError.has(key),
          blocked: blocked.has(key),
          rolledBack: willRollback,
        });
        const entry: MutationRewardEntry = {
          kind: m.type,
          description: describeMutation(m),
          coherenceBefore,
          coherenceAfter,
          delta: objectiveReward,
          helpful: objectiveReward >= 0,
          time: Date.now(),
        };
        store.getState().addReward(entry);

        // Log to episodic memory (Phase 1)
        const episode: EpisodeEntry = {
          id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          cycle: cycleGen,
          action: m.type,
          description: describeMutation(m),
          reasoning: (m as { note?: string }).note ?? (m as { reasoning?: string }).reasoning ?? "",
          result: blocked.has(key) ? "blocked" : (toolError.has(key) || hadError ? "error" : "ok"),
          reward: objectiveReward,
          time: Date.now(),
        };
        store.getState().addEpisode(episode);
      }

      // ---- CLOSE THE LEARNING LOOP ----
      // After recording this cycle's episodes, run them through the learning
      // engine. If a strategy is failing repeatedly, persist a lesson so the
      // NEXT think call leads with "stop doing X the same way". This is what
      // makes the organism adapt instead of repeating failures.
      try {
        const episodes = store.getState().episodeLog;
        const episodesForLearning = episodes.map((e) => ({
          kind: e.action,
          description: e.description,
          result: (e.result === "rollback" ? "error" : e.result) as "ok" | "blocked" | "error",
          reward: e.reward,
        }));
        const lesson = buildLesson(episodesForLearning);
        const derived = derivePersistedLesson(lesson, episodesForLearning);
        if (derived) {
          store.getState().addPersistedLesson(derived);
          applyMutation({
            type: "add_log",
            level: "evolve",
            agent: "nucleus",
            message: `🧠 LEARNING: ${derived.text}`,
          });
        }
      } catch {
        // Learning is best-effort — never let it break the cycle.
      }

      // ---- Phase 1: Take a screenshot AFTER mutations if any UI mutation was applied ----
      const hasUiMutation = mutations.some(
        (m) => ["create_app", "close_app", "move_window", "snap_window", "set_theme",
                "set_wallpaper", "pin_to_desktop", "pin_to_taskbar", "minimize_all",
                "replace_code", "insert_code", "commit_evolution"].includes(m.type)
      );
      if (hasUiMutation) {
        // Wait 1.5s for the UI to settle, then capture the "after" screenshot.
        // The AI will see this in its next cycle's state.
        setTimeout(() => {
          void captureScreenshot(workspaceRef.current, "after").then((screenshot) => {
            // Store the after-screenshot so the next cycle's think API can include it
            window.dispatchEvent(new CustomEvent("alpha-episode-screenshot", {
              detail: { screenshot, time: Date.now() },
            }));
          }).catch(() => {});
        }, 1500);
      }

      // ---- LAYER B: mark all events as handled (the AI has now seen them) ----
      const unhandled = store.getState().eventQueue.filter((e) => !e.handled);
      for (const e of unhandled) {
        store.getState().markEventHandled(e.id);
      }

      // ---- AUTO-ROLLBACK if the AI broke something ----
      // willRollback was computed above (also feeds the objective reward).
      if (willRollback) {
        const reason = criticalEntropyRollback
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

  const autonomyMode = useEvolution((s) => s.autonomyMode);
  const aiBusy = useEvolution((s) => s.aiBusy);
  const activeEvolution = useEvolution((s) => s.activeEvolution);
  const forceCycle = useEvolution((s) => s.forceCycle);
  const chat = useEvolution((s) => s.chat);
  const hydrateFromDb = useEvolution((s) => s.hydrateFromDb);
  const loadEpisodesFromDb = useEvolution((s) => s.loadEpisodesFromDb);
  const loadConstraints = useEvolution((s) => s.loadConstraints);
  const eventQueue = useEvolution((s) => s.eventQueue);

  // Hydrate persistent cognition (Akasha, plans, goals, episodes, constraints) on mount.
  useEffect(() => {
    void hydrateFromDb();
    void loadEpisodesFromDb();
    void loadConstraints();
  }, [hydrateFromDb, loadEpisodesFromDb, loadConstraints]);

  // ---- BOOT: auto-detect a working LLM provider ----
  // The default config is "cloud", but the cloud SDK only works when a
  // .z-ai-config is present. If it isn't (common on a fresh checkout), the
  // organism would boot into a dead state — think() throws and the AI never
  // replies. Probe both providers on mount and let the server switch to
  // whichever is reachable (often the local Aether Engine).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/alpha/probe-providers", { method: "POST", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        // Surface the decision in the logs so the user can see which brain
        // the organism actually booted with.
        if (data.switched) {
          useEvolution.setState((s) => ({
            logs: [
              {
                id: `log-boot-${Date.now()}`,
                time: Date.now(),
                level: "evolve" as const,
                agent: "nucleus" as const,
                message: `↺ Auto-switched LLM provider to "${data.activeProvider}" (the other wasn't reachable).`,
              },
              ...s.logs,
            ].slice(0, 80),
          }));
        }
      })
      .catch(() => {
        /* probe is best-effort; fallback logic in callLLM still applies */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Manual "evolve" button forces an immediate real AI cycle.
  useEffect(() => {
    if (!forceCycle) return;
    if (aiBusy) return;
    useEvolution.setState({ forceCycle: false });
    void runCycle();
  }, [forceCycle, aiBusy, runCycle]);

  // ---- LAYER B: REACTIVE EVENTS — when unhandled events exist, fire an immediate cycle ----
  // Only in active mode — in standby, events are queued but don't trigger cycles.
  // The AI will process them when the user next asks it to do something.
  const unhandledCount = eventQueue.filter((e) => !e.handled).length;
  useEffect(() => {
    if (unhandledCount === 0) return;
    if (aiBusy) return;
    if (consecutiveErrorsRef.current > 0) return;
    if (autonomyMode !== "active") return; // standby = no reactive cycles
    const t = setTimeout(() => void runCycle(), 500);
    return () => clearTimeout(t);
  }, [unhandledCount, aiBusy, autonomyMode, runCycle]);

  // ---- AUTONOMOUS CYCLE ----
  // In "standby" mode: the AI does NOT run autonomous cycles. It only acts when:
  //   1. The user sends a chat message (handled by the chat effect below)
  //   2. The user clicks "evolve" (handled by the forceCycle effect above)
  //   3. A reactive event fires (terminal error, compile error) — but ONLY if active
  //
  // In "active" mode: the AI runs autonomous cycles on a timer, works on tasks,
  //   uses the council, and can code freely on user-requested projects.
  //
  // EXCEPTION: Even in standby, if the AI discovers a critical self-upgrade via
  //   web search, it may test it in sandbox and apply it. This is handled by
  //   the think route's system prompt which instructs the AI accordingly.
  useEffect(() => {
    if (autonomyMode !== "active") return; // standby = no autonomous cycling
    if (aiBusy || activeEvolution) return;
    const errors = consecutiveErrorsRef.current;
    const delay = Math.min(errors > 0 ? CYCLE_MS * Math.pow(2, errors) : CYCLE_MS, 300000);
    const id = setTimeout(() => { void runCycle(); }, delay);
    return () => clearTimeout(id);
  }, [autonomyMode, aiBusy, activeEvolution, chat.length, runCycle]);

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
