# SA2-CHAT-AI — chat AI power-ups

## What I did
Added 8 AI power-up features to the Alpha-N chat panel (`src/components/alpha/chat-panel.tsx`) and created 2 new API routes. The existing chat flow (input → `sendUserMessage` → autonomous loop → `pushAiMessage`) is fully preserved.

## Files I own / created
- `src/components/alpha/chat-panel.tsx` — **edited** (222 → 1170 lines, +948)
- `src/app/api/alpha/personality/route.ts` — **created** (GET + POST, 4 personality profiles)
- `src/app/api/alpha/vision/route.ts` — **created** (POST, image analysis via `callLLM`)

## The 8 features
1. **Voice input** — Mic button (lucide `Mic`/`MicOff`) next to the input. Uses `window.SpeechRecognition || window.webkitSpeechRecognition`. Pulsing red overlay when listening. Transcribed text fills the input. Button hidden when API unavailable (`voiceSupported` state). Properly typed with a minimal `SpeechRecognitionLike` interface — zero `any`.
2. **Text-to-speech** — Speaker toggle (`Volume2`/`VolumeX`) in the header. New AI responses are spoken via `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`. Persists to `localStorage` (`alpha-n:chat-tts`). Each AI message also has a "speak" button that speaks just that message.
3. **Personality profiles** — Pill button in the header showing the current personality with an accent dot. Dropdown (custom, absolute-positioned, outside-click-to-close) with 4 options: Architect (amethyst), Hacker (cyan), Mentor (gold), Rogue (red-orange). The selected personality's `preamble` is prepended to every user message before `sendUserMessage`. Persists to `localStorage` (`alpha-n:chat-personality`). The `/api/alpha/personality` route is the canonical source; the component mirrors the data locally for instant UI.
4. **File upload** — Paperclip button next to the input. Opens a hidden `<input type="file">`. Images (png/jpg/gif/webp) → read as data URL → POSTed to `/api/alpha/vision` → description folded into the message. Text files (txt/md/json/ts/tsx/js/jsx/py) → read as string → inlined in the message (capped at 4000 chars). Preview chip above the input shows thumbnail/icon + name + size + remove button.
5. **Conversation export** — Download button in the header. Builds a Markdown string (`# Alpha-N Conversation`, date, then `## N-Core`/`## User` per message with reasoning as blockquote), creates a `Blob`, downloads via `URL.createObjectURL` + a temporary `<a>`. Filename: `alpha-conversation-{timestamp}.md`.
6. **Proactive suggestions** — 1-3 chips below the latest AI message (only when not busy, only on the most recent AI turn, hidden during search dimming). Generated client-side from a 12-entry keyword pool (code→"Run this code", error→"How do I fix this?", etc.) with 3 fallback suggestions. Clicking a chip sends it as the next message (with personality preamble).
7. **Chat search** — Search button in the header toggles a search bar below the header. Typing filters in real-time: matching text is highlighted with `<mark>`, non-matching messages are dimmed to 25% opacity. Shows a live match count. Clear button resets.
8. **Pin messages** — Each AI message has a "pin" button (revealed on hover, in a row with the "speak" button). Pinned messages appear in a "Pinned (N)" section at the top of the messages area with a 3-line clamp + unpin button. Persists to `localStorage` (`alpha-n:chat-pins`).

## Existing functionality preserved
- `submit()` still calls `sendUserMessage(text)` + clears input (now async, adds personality preamble + attachment processing, but the core flow is identical).
- `chat.map()` renders all messages with the same avatar + bubble + reasoning + timestamp structure.
- Autonomy toggle, close button, header layout, form, Sparkles icon, Send button — all intact.
- The autonomous loop's chat-watching effect (which calls `runCycle(last.content)` on new user messages) is untouched.

## Verification
- `bun run lint` on my 3 files: **0 errors, 0 warnings** (exit 0).
  - Note: the full `bun run lint` reports 9 pre-existing errors in OTHER agents' untracked files (`ambient-app.tsx`, `calculator-app.tsx`, `clipboard-app.tsx`, `notes-app.tsx` — all `react-hooks/set-state-in-effect`). These are not my files and I was told not to touch them.
- Dev log: clean. `GET / 200` (chat-panel compiles), `GET /api/alpha/personality 200`, `POST /api/alpha/personality 200`, `POST /api/alpha/vision 400` (correct error for empty body). Zero compile errors.
- No `any` types. No `console.log`. All comments in English. No indigo/blue colors (uses oklch amethyst/cyan/gold/red-orange).

## Browser API compatibility concerns
- **Web Speech API** (`SpeechRecognition`/`webkitSpeechRecognition`): Chromium-only (Chrome, Edge, Opera). NOT in Firefox/Safari. The mic button is conditionally rendered — hidden entirely when the API is absent, so non-Chromium users see no broken UI.
- **speechSynthesis**: widely supported (all major browsers). Guarded with `"speechSynthesis" in window` checks; silently no-ops if absent.
- **FileReader / Blob / URL.createObjectURL / localStorage**: universally supported; all wrapped in try/catch and SSR guards (`typeof window === "undefined"`).
- The personality menu uses a manual outside-click handler (not a Radix portal) so it stays correctly positioned inside the fixed chat panel.

## Line counts
- `chat-panel.tsx`: **222 → 1170 lines** (+948)
- `personality/route.ts`: 100 lines (new)
- `vision/route.ts`: 64 lines (new)
