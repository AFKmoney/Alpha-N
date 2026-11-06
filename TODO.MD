# TODO.MD — Cahier de notes & plan de reconstruction Alpha-OS

> Projet : **Alpha-N / Alpha-OS** — OS auto-évolutif dans le navigateur (Next.js 16, Tailwind 4, shadcn/ui, Prisma/SQLite, Zustand).
> Route visible unique : `/`. Gateway Caddy `:81` (`?XTransformPort=<port>` pour les mini-services).
> Ce fichier fait office de cahier de notes : audit d'intégrité, état des lieux, plan détaillé de tout ce qui reste à faire. Chaque case est cochée au fur et à mesure des patchs.

---

## 1. Audit d'intégrité (état des lieux au démarrage)

### 1.1 Ce qui existe (récupéré du workspace)

| Élément | État | Notes |
|---|---|---|
| Scaffold Next.js 16 + Tailwind 4 + shadcn/ui (55 composants ui/) | ✅ intact | `package.json`, `bun.lock`, configs, `src/components/ui/*` |
| Historique git (2 commits) | ✅ | `a6cd76c` (scaffold) + `e1278fe` (initial) |
| Base de données `db/custom.db` | ✅ intacte | 11 tables Alpha (AkashaMemory, AkashaIntention, Plan, Goal, SystemEvent, MutationReward, UserPreference, Wallpaper, GeneratedApp, EpisodeLog, Constraint) + 24 lignes de logs d'épisodes |
| Worklog complet du projet | ✅ récupéré | `tool-results/read_1793963563691` → restauré en `WORKLOG.md` (1027 lignes, 27 tâches documentées) |
| 16 snapshots de code source | ✅ récupérés | Voir §2.2 — ~430 KB de TS/TSX/Rust réextraits |
| `.env` (DATABASE_URL) | ✅ | Clé seule, valeur préservée |
| Infrastructure : Caddyfile, `.zscripts/*`, `examples/websocket` | ✅ intacte | Gateway :81 → :3000, mini-services via `XTransformPort` |
| `prisma generate` | ✅ exécuté | Client généré (schéma scaffold temporaire) |

### 1.2 Ce qui a été PERDU (causes : recyclage du sandbox avant sauvegarde)

**Le code applicatif Alpha-OS entier a disparu** : `src/lib/alpha/*`, `src/components/alpha/*`, `src/app/api/alpha/*`, `mini-services/terminal/*`, `mini-services/aether-engine/*` (Rust), `models/`, et le vrai `prisma/schema.prisma` (le schéma actuel est celui du scaffold : User/Post — incohérent avec la DB réelle qui contient les 11 tables Alpha).

### 1.3 Problèmes détectés dans les fichiers récupérés

- **Bug P1** : `src/lib/alpha/evolution-store.ts:49` importe `db` (Prisma) dans un store `"use client"` → casserait le build client. Utilisé une seule fois (ligne 440, `setAutonomyLevel`) → à remplacer par un `fetch` POST vers `/api/alpha/personality` (le GET existe déjà dans le même fichier ligne 813).
- **Dépendances manquantes** dans `package.json` : `@babel/standalone`, `@xterm/xterm`, `@xterm/addon-fit`, `socket.io-client`, `html-to-image` (toutes utilisées par les fichiers récupérés).
- `tsconfig.json` : `ignoreBuildErrors: true` côté next.config → les erreurs TS ne bloquent pas le build, mais on vise `tsc --noEmit` propre sur les nouveaux fichiers.
- `.gitignore` scaffold : à compléter (`*.db` ? NON — la DB doit rester versionnée ici pour survivre aux recyclages ; à la place ignorer `models/*.gguf`, `*.log`, `upload/`).

---

## 2. Matériel de reconstruction disponible

### 2.1 Worklog (`WORKLOG.md`) — spécifications de référence

27 tâches documentées avec vérifications : thème Liquid Obsidian, évolution engine, fenêtre manager (tiling/float, 4 bureaux virtuels, snap), dock flottant, start menu, 11+ apps réelles, terminal PTY (port 3003), sécurité kernel (6 fichiers protégés), rollback/snapshots, Akasha (mémoire persistante), plans/goaux, débat d'agents, exec sandbox, compilation réelle, web search, modèle-agnostique (cloud/aether), vault, reset, proxy navigateur, Aether Engine Rust v3.2 (port 3004, 16+ endpoints, agent loop 12 tools).

### 2.2 Fichiers sources récupérés (extraits vers leurs emplacements)

| Fichier restauré | Lignes | Statut |
|---|---|---|
| `src/lib/alpha/evolution-store.ts` | 1114 | ✅ récupéré (bug `db` ligne 49 à patcher) |
| `src/lib/alpha/metacognition.ts` | 690 | ✅ récupéré |
| `src/app/api/alpha/think/route.ts` | 616 | ✅ récupéré |
| `src/app/api/alpha/generate-app/route.ts` | 648 | ✅ récupéré |
| `src/components/alpha/autonomous-loop.tsx` | 908 | ✅ récupéré |
| `src/components/alpha/chat-panel.tsx` | 950 | ✅ récupéré |
| `src/components/alpha/apps/os-apps.tsx` | 968 | ✅ récupéré (BrowserApp, FilesApp, MonitorApp, SecurityApp, CustomApp, OptionsApp, VaultApp) |
| `src/components/alpha/apps/generated-app-renderer.tsx` | 745 | ✅ récupéré |
| `mini-services/aether-engine/src/handlers.rs` | 1687 | ✅ récupéré (v3.2) |
| `mini-services/aether-engine/src/agent.rs` | 771 | ✅ récupéré |
| `mini-services/aether-engine/src/tools.rs` | 659 | ✅ récupéré |
| `recovered/*` (dups + handlers v1) | — | archives de secours |

### 2.3 Contrats exacts des modules manquants (extraits par analyse des usages)

Spec complète dérivée des call-sites réels — résumée dans chaque tâche ci-dessous.

---

## 3. PLAN DE RECONSTRUCTION — cases à cocher

### Phase A — Fondations lib/alpha (bloquant tout le reste)

- [x] **A1. `prisma/schema.prisma`** — restaurer les 11 modèles exacts depuis la DDL SQLite : AkashaMemory{text,kind=lesson,createdAt}, AkashaIntention{text,priority=normal,resolved=false}, Plan{goal,rationale,status=active,stepsJson="[]",createdAt,updatedAt}, Goal{text,level=long,active=true}, SystemEvent{type,content}, MutationReward{mutationKind,description,coherenceBefore,coherenceAfter,delta,helpful}, UserPreference{key,value,updatedAt}, Wallpaper{name,presetId,config="{}",isCustom}, GeneratedApp{name,description,category=Productivity,code}, EpisodeLog{cycle,action,description,reasoning="",result="",reward=0,screenshot="",timestamp}, Constraint{text,scope=global,active}. Puis `prisma db push` (les tables existent déjà → drift only pour User/Post retirés).
- [x] **A2. `package.json`** — ajouter `@babel/standalone`, `@xterm/xterm`, `@xterm/addon-fit`, `socket.io-client`, `html-to-image` + `bun install`.
- [x] **A3. `src/lib/alpha/use-mounted.ts`** — `useMounted(): boolean` (hydration guard).
- [x] **A4. `src/lib/alpha/evolution-data.ts`** — types (AgentRole=architect|developer|critic|optimizer|nucleus, AgentStatus=6 états, AiState=3 états, LogLevel=observe|critique|hypothesis|deploy|evolve|heal, Agent{role,status,thought,load}, CodeLine{no,tokens:[{text,cls?}]}, EvolutionVersion{id,version,generation,timestamp,title,summary,category,agentLead,deltas,diff,insight}, LogEntry, Scenario{title,summary,category,agentLead,deltas,diff,insight,logs}), constantes (LIVING_CODE ~40 lignes de code vivant tokenisé, GHOST_CODE, SCENARIOS ≥7 scénarios d'auto-amélioration, SEED_VERSION).
- [x] **A5. `src/lib/alpha/mutations.ts`** — union `Mutation` (50 variantes discriminées par `type`, cf. spec : set_state…create_wallpaper), 17 types (AppliedMutation, BeforeAfter, WebSearchResult, CodeExecResult, CompileResult, DebateResult, MutationRewardEntry, EpisodeEntry, ChatMessage, FileReadResult, MetricKey, AkashaPlan, AkashaGoal, AkashaMemory, AkashaIntention), `describeMutation(m)`, `textLinesToCodeLines(lines,startNo)`, `validateCodeLines(lines)` (équilibre accolades/parenthèses/crochets).
- [x] **A6. `src/lib/alpha/evolution-store-helpers.ts`** — T0, STATUS_BY_LEVEL, idleAgents(), makeLog(level,agent,message,time), bumpVersion("0.2.1"→semver), nextMutId/nextChatId/nextMemId/nextIntId, seedHistoryEntry, seedLogs, seedChat, type ActiveEvolution.
- [x] **A7. `src/lib/alpha/autonomy-policy.ts`** — AutonomyLevel=sandbox|moderate|yolo, DEFAULT_AUTONOMY_LEVEL="moderate", Policy{level,capabilities:{actionsPerMinute,execNetwork,…}}, getPolicy(level), authorize(action,policy,args?)->{allowed,reason}, isConsequential(action), journal d'audit (exporté pour audit-trail).
- [x] **A8. `src/lib/alpha/reward-model.ts`** — `computeReward({toolOk,toolError,blocked,rolledBack}): number`.
- [x] **A9. `src/lib/alpha/learning-engine.ts`** — EpisodeForLearning{kind,description,result,reward}, Lesson (opaque), buildLesson(episodes), renderLessonPrompt(lesson,persistedLessons), derivePersistedLesson(lesson,episodes)->{id,text,weight,createdAt}|null.
- [x] **A10. `src/lib/alpha/os-types.ts`** — AppKind (terminal,editor,loom,files,browser,monitor,evolution,agents,security,custom,options,vault,memory,wallpaper,appstore,control,calculator,notes,clipboard,ambient,stats,clock,weather,music), OSWindow{id,kind,title,icon,rect,minimized,maximized,z,desktop,opacity,snapState,data}, Rect, Viewport, SnapState, protectedFiles (6 kernel: boot,security,rollback,sandbox,pty-bridge,akasha), isProtected(path), DOCK_APPS, computeTiledLayout/clampRect/defaultSplits (tiling), DESKTOPS=4, WORKSPACE constants.
- [x] **A11. `src/lib/alpha/os-store.ts`** — useOS : windows, zCounter, activeDesktop, layoutMode, theme, pinnedTaskbar/desktop, protectedFiles, violationAttempts, snapshots, rollbackEvents, terminalQueue ; actions : openApp(kind,opts?) (anti-doublon), closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow, setWindowData, queueTerminalCommand, recordViolation, takeSnapshot(label,state), rollback(snapshot,reason), pin/unpinToTaskbar, pinToDesktop, snapWindow, setTheme, minimizeAll, setAlwaysOnTop, setActiveDesktop, setLayoutMode, setViewport… (signatures exactes de la spec agent).
- [x] **A12. `src/lib/alpha/model-config.ts`** — ModelConfig{provider:cloud|aether,aetherModel,aetherHasVision}, config par défaut, callLLM(system,user,screenshot?)->{content} (cloud via z-ai-web-dev-sdk `createVision`, aether via fetch :3004 OpenAI-compatible), testModelConnection(), erreurs typées 429/fetch pour backoff think.
- [x] **A13. `src/lib/alpha/ai-client.ts`** — captureScreenshot(el,kind) via html-to-image (skip [data-ai-skip]), think(payload)->{mutations,reasoning,message,rateLimited?,error?}, webSearch, readFile, writeFile, runDebate, executeCode, runCompile, auditAction (fetch vers les routes API).
- [x] **A14. Patch evolution-store.ts:49** — retirer `import { db }`, remplacer l'upsert UserPreference ligne 440 par `fetch POST /api/alpha/personality {key:"autonomyLevel", value:level}`.

### Phase B — Routes API `/api/alpha/*` (16 routes manquantes)

- [x] **B1. `akasha/route.ts`** — GET {memory,intentions,plans,goals,events?} (hydrate), POST {type:memory|intention|plan|goal|event|advance_plan|abandon_plan|resolve_intention,…} (persist), DELETE ?id.
- [x] **B2. `personality/route.ts`** — GET (sans key: 4 profils ; ?key=autonomyLevel: {value}), POST {key,value} upsert UserPreference OU {key:profile}.
- [x] **B3. `files/route.ts`** — GET ?path= (lecture fichier/dossier, blocage kernel/), POST {path,content|action:mkdir|touch} avec sécurité (blocage kernel/, violations).
- [x] **B4. `exec/route.ts`** — POST {code,language,network?} → /tmp/alpha-sandbox, timeout 8s, {stdout,stderr,exitCode,ok}.
- [x] **B5. `compile/route.ts`** — POST {check:tsc|eslint|both} → npx tsc --noEmit / eslint src/, timeout 30s, {tscOk,tscOutput,eslintOk,eslintOutput,ok}.
- [x] **B6. `debate/route.ts`** — POST {proposal,context,recent} → 4 appels callLLM (architect/developer/critic/optimizer), verdicts + consensus + tally.
- [x] **B7. `search/route.ts`** — POST {query} → z-ai web_search → {results:[{title,snippet,host,url}]}.
- [x] **B8. `model/route.ts`** — GET config, POST {provider|action:test}.
- [x] **B9. `models-list/route.ts`** — GET → scan models/*.gguf avec tailles.
- [x] **B10. `proxy/route.ts`** — GET ?url= → fetch, strip X-Frame-Options/CSP, injecte <base>, retourne HTML.
- [x] **B11. `reset/route.ts`** — POST → purge DB (deleteMany sur toutes les tables Akasha).
- [x] **B12. `vault/route.ts`** — GET ?password= / POST {label,value,password} / DELETE ?id= — XOR encrypt, stockage SystemEvent type vault_entry.
- [x] **B13. `wallpaper/route.ts`** — GET actif, POST {action:set,presetId,config,name} upsert.
- [x] **B14. `aether/route.ts`** — proxy GET/POST vers localhost:3004 (?endpoint=graph/add etc.), graceful si service down.
- [x] **B15. `vision/route.ts`** — POST {image,prompt} → callLLM avec vision → {description}.
- [x] **B16. `episode-log/route.ts`** — GET ?limit, POST {cycle,action,description,reasoning,result,reward,screenshot}, PATCH ?id= {reward} (rateEpisode).
- [x] **B17. `constraints/route.ts`** — GET, POST {text,scope}, DELETE ?id.

### Phase C — Composants système (le bureau)

- [x] **C1. `src/app/globals.css`** — thème Liquid Obsidian & Neural Glow : fond oklch obsidienne, accents cyan oklch(0.82 0.17 195) / amethyst oklch(0.74 0.22 300) / gold oklch(0.85 0.16 85) / emerald 145 / red 25 (PAS de bleu/indigo), utilitaires `font-mono-ae`, `eyebrow`, `scroll-ae`, `glass-strong`, `glow-cyan|amethyst|gold`, `neural-dot`, scrollbars custom, styles xterm.
- [x] **C2. `src/components/alpha/obsidian-background.tsx`** — canvas plein écran : gradients dérivants "oil under moon" + grain, respecte prefers-reduced-motion, data-ai-skip.
- [x] **C3. `src/components/alpha/chat-helpers.tsx`** — PERSONALITIES (4 profils architect/hacker/mentor/rogue avec accent hex + preamble), DEFAULT_PERSONALITY, getPersonality, generateSuggestions(1-3), IMAGE_EXTENSIONS, TEXT_EXTENSIONS, fileExtension, readFileAsDataUrl/Text, loadString/loadJson/saveString/saveJson, LS_PERSONALITY/LS_TTS/LS_PINS, highlightMatch, formatBytes, getSpeechRecognitionCtor, types PersonalityKey/PersonalityProfile/AttachedFile/SpeechRecognitionLike.
- [x] **C4. `src/components/alpha/context-menu.tsx`** — ContextMenuAction{label,icon,onClick,danger,submenu,separator}, triggerContextMenu(e,actions) (portal global), buildFileActions (open/rename/delete/mkdir/touch + event alpha-files-refresh), buildDesktopActions (wallpaper submenu, show desktop), buildWindowActions (transparency 100/80/60/40, snap, always-on-top, close), buildDockAppActions.
- [x] **C5. `src/components/alpha/audit-trail.tsx`** — AuditTrail{max?} : liste des actions conséquentes du journal d'autonomie (lit autonomy-policy), auto-refresh.
- [x] **C6. `src/components/alpha/window-frame.tsx`** — chrome draggable/resizable (poignées 8 directions), minimize/maximize/close, mode tiled (rect imposé, drag désactivé), drag-to-edge snap avec preview portal, badges (desktop, snap, opacity), opacité inline.
- [x] **C7. `src/components/alpha/window-manager.tsx`** — layout tiling computeTiledLayout + SplitHandleBar (drag ratio), filtre par desktop actif, switch sur AppKind → composants d'apps, portal des handles.
- [x] **C8. `src/components/alpha/dock.tsx`** — dock flottant (reveal proximité bas 60px), DOCK_APPS + chat + synapse, minimized-to-dock (restaure/focus), toggle thème Sun/Moon, raccourcis clavier globaux (Alt+Tab, Alt+F4, Cmd+W, Win+arrows snap, Win+D, Ctrl+1..4), injecte style light-theme.
- [x] **C9. `src/components/alpha/start-menu.tsx`** — bouton "α" bas-gauche, launcher recherche toutes apps, indicateur ouvert.
- [x] **C10. `src/components/alpha/top-bar.tsx`** — brand Alpha-OS, chips council, telemetry (gen/version/coherence), contrôles : LayoutControls (tile/float + 4 bureaux), ModelSettings button, evolve, synapse, flow, chat, notification bell.
- [x] **C11. `src/components/alpha/status-bar.tsx`** — footer sticky : CPU/RAM/entropy/coherence, heartbeat, agents actifs, horloge (useMounted).
- [x] **C12. `src/components/alpha/boot-sequence.tsx`** — overlay cinématique d'init (lignes de boot, "permission granted: i may rewrite myself"), dismiss auto.
- [x] **C13. `src/components/alpha/before-after.tsx`** — notification toast non-intrusive (top-right) quand beforeAfter set ; clic → modal avant/après screenshots + toggle.
- [x] **C14. `src/components/alpha/model-settings.tsx`** — modal provider Cloud/Aether, GGUF picker (GET /api/alpha/models-list), test connexion, save & apply (POST /api/alpha/model).
- [x] **C15. `src/components/alpha/mutation-viewer.tsx`** — panneau latéral droit (chevron) : stream mutations temps réel + bannière thinking.
- [x] **C16. `src/app/layout.tsx`** — metadata Alpha-N, fonts, dark class.
- [x] **C17. `src/app/page.tsx`** — bureau complet : ObsidianBackground, TopBar, WindowManager, SplitHandles, Dock, StartMenu, StatusBar, ChatPanel, AutonomousLoop, BootSequence, BeforeAfter, ModelSettings, MutationViewer, context menu desktop, viewport tracking → store, montée des composants système (Phase E).

### Phase D — Applications

- [x] **D1. `apps/terminal-app.tsx`** — xterm.js + addon-fit + socket.io `io("/?XTransformPort=3003")`, événements terminal:* , refit ResizeObserver, historique commandes (ArrowUp/Down, localStorage `alpha-terminal-history`, \x15), queue IA (terminalQueue).
- [x] **D2. `apps/real-code-editor.tsx`** — arbre fichiers réel via /api/alpha/files, code réel auto-refresh 3s, lecture écritures IA.
- [x] **D3. `apps/loom-app.tsx`** — the Loom : rendu codeLines vivants du store (tokens glow), lignes mutées marquées, click-to-explain, ghost lines, lifeline compile pulse.
- [x] **D4. `apps/council-app.tsx`** — 4 agents (load rings + pensées live depuis le store).
- [x] **D5. `apps/evolution-log-app.tsx`** — logs OODA streaming + timeline versions (history) cliquable → openHistoryDiff.
- [x] **D6. `apps/memory-network.tsx`** — graphe force-directed SVG du Aether Engine (GET /api/alpha/aether?endpoint=graph), recherche sémantique, stats santé, refresh 4s, graceful offline.
- [x] **D7. `apps/wallpaper-app.tsx`** — picker presets (wallpaper-presets.ts ~24 presets générés procéduralement), POST /api/alpha/wallpaper, event alpha-wallpaper-change.
- [x] **D8. `src/lib/alpha/wallpaper-presets.ts`** — presets {id,name,colors[],style} pour fond + app.
- [x] **D9. Apps SA1 (8 fichiers autonomes)** : calculator-app (évaluateur récursif sans eval, histo 20, scientifique), notes-app (markdown maison, autosave 400ms), clipboard-app (history 50, pin, permissions), ambient-app (6 soundscapes Web Audio + Pomodoro), stats-app (9 cartes système, dégradation N/A), clock-app (SVG analogique rAF + 9 villes Intl), weather-app (Open-Meteo, géocodage, °C/°F), music-app (4 tracks génératives, scheduler lookahead, visualiseur).
- [x] **D10. Enregistrement des apps** — window-manager switch complet (toutes AppKind), DOCK_APPS cohérent, defaultRect pour chaque kind.

### Phase E — System UI (7 overlays autonomes)

- [x] **E1. `command-palette.tsx`** — Cmd+K, 14 apps + 3 actions IA + 6 fenêtres + 4 système (reset, theme, wallpaper), nav clavier.
- [x] **E2. `toast-system.tsx`** — store addToast/dismiss + CustomEvent alpha-toast, 4 types, bottom-right.
- [x] **E3. `shortcuts-overlay.tsx`** — `?` ouvre, KEYBOARD_SHORTCUTS export, kbd.
- [x] **E4. `notification-center.tsx`** — panneau droit F8, agrège violations/mutations/rollbacks/compile/events + plans/goaux, unread badge.
- [x] **E5. `evolution-graph.tsx`** — SVG mutationStream en 4 lanes catégorisées, zoom wheel/pan drag, tooltip rewards.
- [x] **E6. `debate-replay.tsx`** — modal sidebar + replay agents séquencé (play/step/reveal), consensus, localStorage alpha-n:debates.
- [x] **E7. `system-search.tsx`** — Cmd+Shift+F, index apps/windows/files/memories/chat/plans/goals, debounce 300ms, nav clavier.

### Phase F — Mini-services & vérification

- [x] **F1. `mini-services/terminal/`** — package.json (socket.io, node-pty, tsx), index.ts (launcher bun --hot → spawn node worker, garde __alphaTerminalLaunched, watch *.ts), worker.ts (socket.io :3003 path "/", node-pty bash TERM=xterm-256color, resize/kill/respawn, graceful shutdown). + `bun install` dans le service.
- [x] **F2. Aether Engine** — ✅ RECONSTRUIT : les 9 modules perdus (main.rs, graph.rs, tfidf.rs, cache.rs, compress.rs, decompose.rs, hcm.rs, clt.rs, atd.rs, dashboard.rs) + Cargo.toml + engine.rs (découvert manquant : parser GGUF + discovery + chat-template, requis par handlers.rs) reconstruits en cohérence totale avec les 3 fichiers récupérés (7080 lignes au total, 14 modules). 27 routes câblées sur :3004. ⚠️ cargo/rustc non installés dans ce sandbox : la compilation n'a pas pu être vérifiée (vérification manuelle call-site par call-site + scripts scripts/verify_aether.py et scripts/rust_syntax_check.py). À compiler dès qu'un toolchain Rust est disponible : `cd mini-services/aether-engine && cargo build --release`.

