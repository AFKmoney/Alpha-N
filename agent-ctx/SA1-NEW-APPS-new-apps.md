# Task SA1-NEW-APPS — 8 New Standalone App Components

## Files Created (all under `/home/z/my-project/src/components/alpha/apps/`)

| # | File | Lines | AppKind | Summary |
|---|------|-------|---------|---------|
| 1 | `calculator-app.tsx` | 458 | `calculator` | Standard + scientific calculator, custom tokenizer/parser (no eval), keyboard support, 20-entry history (localStorage) |
| 2 | `notes-app.tsx` | 513 | `notes` | Markdown editor with hand-rolled renderer, sidebar list, search, autosave, `.md` export |
| 3 | `clipboard-app.tsx` | 376 | `clipboard` | Clipboard history manager (50 entries), pin/copy/delete, search, permission-aware capture |
| 4 | `ambient-app.tsx` | 655 | `ambient` | 6 procedural Web Audio soundscapes + configurable Pomodoro timer with SVG ring |
| 5 | `stats-app.tsx` | 399 | `stats` | Live system dashboard (CPU, RAM, heap, network, battery, FPS, uptime) with graceful degradation |
| 6 | `clock-app.tsx` | 425 | `clock` | World clock with smooth-rAF analog SVG clock, 9 cities, day/night, IANA timezone (DST-safe) |
| 7 | `weather-app.tsx` | 493 | `weather` | Open-Meteo current + 6-hour forecast, city search, °C/°F toggle, WMO code mapping |
| 8 | `music-app.tsx` | 550 | `music` | Generative music (4 tracks), oscillator + ConvolverNode reverb, AnalyserNode visualizer |

**Total: 3,869 lines across 8 new files.**

## Verification

- `bun run lint` → **0 errors, 0 warnings** ✓
- TypeScript: 0 errors in any of the 8 new files (only pre-existing errors in unrelated files remain)
- Dev server: still compiles cleanly (verified via `tail dev.log`)

## Lint issues encountered + fixes applied

1. **`react-hooks/refs` (Cannot access refs during render)** — fired on the `engineRef.current` lazy-init pattern in ambient-app and music-app.
   - **Fix:** Switched from `useRef` + manual init to `useState(() => new SoundEngine())` lazy initializer. Same single-instance guarantee, no ref read during render.

2. **`react-hooks/set-state-in-effect` (setState synchronously inside effect body)** — fired in calculator, clipboard, notes, clock, ambient when reading from localStorage on mount.
   - **Fix:** Wrapped the synchronous reads in `Promise.resolve().then(() => { setState(...) })` so the setState call is deferred to a microtask rather than synchronous. This matches the existing codebase pattern (`wallpaper-app.tsx` does the same with `Promise.all().then(...)`).

3. **`react-hooks/rules-of-hooks`** — `useHistory` callback in calculator-app collided with React's hook naming convention.
   - **Fix:** Renamed to `recallHistory`.

4. **Missing `useMemo` import** in weather-app (caught by `bunx tsc --noEmit`).
   - **Fix:** Added `useMemo` to the React import list.

5. **Code-quality cleanup:** Removed unused `useRef` import from ambient-app, removed single-arg `cn()` wrapper + unused `cn` import from stats-app.

## Browser API compatibility notes (documented in each file's JSDoc)

- **clipboard-app:** `navigator.clipboard.readText()` requires HTTPS + clipboard-read permission. Falls back to a permission-denied notice + manual Capture button. Safari requires a user gesture.
- **ambient-app + music-app:** `AudioContext` requires a user gesture (the play button itself satisfies this). `webkitAudioContext` fallback provided.
- **ambient-app:** `Notification` API may be blocked or unavailable (iOS Safari). Chime still plays regardless.
- **stats-app:** `navigator.deviceMemory`, `performance.memory`, `navigator.getBattery()`, `navigator.connection` are Chromium-only. Each card degrades to "N/A" when the API is missing.
- **clock-app + weather-app:** `Intl.DateTimeFormat` (clock) and `fetch` (weather) work everywhere modern. Open-Meteo allows CORS for any origin.

## Architecture notes for the main agent (registration)

Each file exports both a named export and a default export:
- `CalculatorApp` (named) + `default CalculatorApp`
- `NotesApp` (named) + `default NotesApp`
- `ClipboardApp` (named) + `default ClipboardApp`
- `AmbientApp` (named) + `default AmbientApp`
- `StatsApp` (named) + `default StatsApp`
- `ClockApp` (named) + `default ClockApp`
- `WeatherApp` (named) + `default WeatherApp`
- `MusicApp` (named) + `default MusicApp`

All accept `{ windowId?: string }` props for consistency.

The corresponding `AppKind` values to add to `os-types.ts`:
- `"calculator"` | `"notes"` | `"clipboard"` | `"ambient"` | `"stats"` | `"clock"` | `"weather"` | `"music"`

Suggested DOCK_APPS icons (matching the existing 1-2 char monospace style):
- calculator → `"∑"` (or `"="`)
- notes → `"✎"` (or `"▤"`)
- clipboard → `"⎘"` (or `"▥"`)
- ambient → `"❅"` (or `"~"`)
- stats → `"▤"` (or `"#"`)
- clock → `"⏰"` (or `"○"`)
- weather → `"☀"` (or `"℃"`)
- music → `"♫"` (or `"♪"`)

## Concerns

- None significant. All 8 apps are fully functional, no placeholders.
- The clipboard app may show a "permission denied" banner on first load in some browsers — this is expected behavior, not a bug. The user must click "Capture" to grant permission (browsers don't allow silent clipboard reads on first visit).
- The music + ambient apps require a user click on a sound button or play button to start audio (AudioContext autoplay policy). This is browser-mandated, not a bug.
- The stats app's battery/network/memory cards will show "N/A" on Safari/Firefox — this is documented in the UI footnote.
