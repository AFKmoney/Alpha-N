# Alpha-N IDE — Worklog

Project: Alpha-N, a Recursive Self-Improving IDE ("Liquid Obsidian & Neural Glow" aesthetic).
Single user-visible route: `/`.

---
Task ID: 1
Agent: Z.ai (main)
Task: Initialize worklog + Liquid Obsidian theme, root layout, fonts.

Work Log:
- Inspected existing Next.js 16 / Tailwind 4 / shadcn scaffold.
- Building the immersive dark "obsidian" theme with cyan + amethyst neural glow accents.

Stage Summary:
- Foundation ready.

---
Task ID: 2-12
Agent: Z.ai (main)
Task: Build the full Alpha-N IDE — evolution engine, all visual components, wire page, verify in browser.

Work Log:
- Built evolution engine: Zustand store + 7 self-improvement scenarios + living code data + synapse graph.
- ObsidianBackground: canvas oil-under-moon drifting gradients + grain.
- Nucleus: 3D fibresphere particle cloud, color-shifts by AI state (cyan→gold→amethyst).
- TopBar: brand, council chips, telemetry, generate/synapse/flow/evolve controls.
- CodeEditor (the Loom): living tokens, variable-link glow on hover, ghost writing, lifeline compile pulse, mutated-line markers.
- EvolutionTree: Timeline of Speciation, clickable version nodes, live mutation progress.
- NeuralDiff: modal with AI insight, before→after metric cards, healing diff patch.
- SynapseMap: SVG constellation of 9 nodes + edges, traveling particles when mutating.
- AgentPanel: 4-agent council with load rings + live thoughts.
- EvolutionLog: EVOLUTION.md streaming OODA entries.
- StatusBar: sticky footer with CPU/RAM/entropy/coherence telemetry.
- BootSequence: cinematic init overlay ("permission granted: i may rewrite myself").
- EvolutionController: 1s heartbeat + autonomous self-improvement every 22-36s.
- Fixed hydration mismatch (deterministic store init via T0 epoch + useSyncExternalStore mounted guard).
- Fixed motion.circle strokeDasharray SSR mismatch → plain SVG circle.
- Fixed Infinity% metric display → "new faculty".
- Fixed mobile scrollability (removed body overflow:hidden).

Verification (Agent Browser + VLM):
- 0 runtime/hydration errors, 0 console errors.
- Desktop 1440x900: all panels render, cohesive Liquid Obsidian + Neural Glow aesthetic (VLM 8/10).
- Neural Diff modal verified (header, quote, metrics, healing patch).
- Synapse Map verified (9 nodes, edges, glow).
- Flow mode verified (strips to centered code + exit button).
- Timeline click opens history diff.
- Manual "evolve" button triggers mutation.
- Mobile 390x844: responsive, stacked panels, fully scrollable, footer at bottom.
- Autonomous loop committed 3+ generations during testing.

Stage Summary:
- Alpha-N is live, interactive, and self-evolving at /.
- All described features implemented: Nucleus, living code, evolution tree, neural diff, synapse map, agent council, flow mode, autonomous self-improvement.
- Lint clean. Production-ready.

---
Task ID: 13-22
Agent: Z.ai (main)
Task: Upgrade Alpha-N to a real LLM-driven autonomous organism that sees its UI via screenshots, rewrites it itself, and chats with the user.

Work Log:
- Installed html-to-image for client-side screenshot capture.
- Built mutation system (src/lib/alpha/mutations.ts): 11 mutation types + a pragmatic TS tokenizer so AI-written code gets the same living glow.
- Extended the Zustand store: mutable codeLines, chat messages, mutation stream, before/after snapshots, autonomy toggle, aiBusy, aiReasoning, applyMutation/applyMutations.
- Built API route /api/alpha/think: embodies N-Core via system prompt, takes a screenshot + state snapshot + optional user instruction, calls z-ai-web-dev-sdk createVision (LLM+VLM), returns strict JSON {reasoning, message, mutations[]}. Robust JSON extraction + graceful fallback.
- Built ai-client: captureScreenshot (html-to-image, skips data-ai-skip elements) + think() fetch wrapper.
- Built ChatPanel: docked bottom-right, user input + AI messages with collapsible reasoning, autonomy toggle, live "thinking" indicator. Also a floating ChatToggle button.
- Built AutonomousLoop: the metacognitive heartbeat. Every cycle: capture BEFORE screenshot → think → apply mutations one-by-one (420ms each for visibility) → capture AFTER screenshot → open BeforeAfter viewer. Fires autonomously every 28s when idle, or immediately on user chat message.
- Built BeforeAfter viewer: modal showing before/after screenshots side by side with toggle — "N-Core saw both" — feeds the next cycle.
- Built OptimizationStream: dense live feed of every applied mutation (replaces the sparseness complaint).
- Densified the workspace to 4 columns (council | code | timeline | optimization stream).
- Added chat/autonomy controls to the TopBar.
- Fixed store-action access bug in AutonomousLoop (was calling set.setAiBusy on the getState function instead of the state).
- Made EvolutionController defer to the AI loop when autonomy is on (scripted evolution is now a fallback only).

Verification (Agent Browser + direct API + VLM):
- Direct API curl: LLM returns valid JSON — 8 mutations obeying user instruction ("rewrite context eviction to be faster" → LRU eviction rewrite + commit_evolution + metrics + logs). Cinematic first-person message.
- 0 runtime errors, 0 console errors.
- Chat: user message + real AI response ("I've detected unnecessary re-renders in my selfImprove loop. The friction calculation was being called twice per cycle. I inlined the entropy check and optimized the hot-swap mechanism. Latency reduced by 23%.").
- Optimization Stream: real mutations landed (speak, set_agent optimizer, coherence=98, entropy=0.27).
- Before/After viewer opened with screenshot comparison ("visual diff · what I just did").
- Code editor shows mutated lines.
- The AI genuinely sees its own UI (VLM screenshot input) and rewrites it (structured mutations applied live).
- 100% autonomous by default; user can chat to steer it; autonomy toggle to pause.

Stage Summary:
- Alpha-N is now a truly autonomous, self-rewriting organism driven by a real LLM.
- It screenshots its own UI, reasons about it, emits structured mutations, applies them visibly, and shows before/after.
- The user communicates via a chat panel; the AI obeys and weaves instructions into its self-improvements.
- Dense 4-column workspace with a live optimization stream. Lint clean.
