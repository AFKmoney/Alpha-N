/**
 * ambient-app.tsx — procedural ambient sound generator + Pomodoro focus timer.
 *
 * Features:
 * - 6 ambient soundscapes generated entirely with the Web Audio API (no audio
 *   files): rain, ocean, forest, café, white noise, brown noise.
 *   * rain       → high-passed white noise + droplet envelope pops
 *   * ocean      → brown noise through a low-pass with a slow LFO on the gain (waves)
 *   * forest     → band-passed noise bed + stochastic bird-chirp oscillator sweeps
 *   * café       → brown noise through band-pass + stochastic cup-clink tones
 *   * white      → pure white noise
 *   * brown      → integrated white noise (low-frequency emphasis)
 * - Master volume slider
 * - Pomodoro timer (configurable work/short-break/long-break durations)
 * - Visual SVG countdown ring + mm:ss display
 * - Start / Pause / Reset; auto-advances work → break → work…
 * - Completion chime (oscillator) + browser Notification (if permitted)
 *
 * Browser compatibility notes:
 * - `AudioContext` requires a user gesture before producing sound; the sound
 *   buttons themselves satisfy that gesture requirement.
 * - `Notification` API may be blocked or unavailable (mobile/iOS Safari). The
 *   chime still plays regardless.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, RotateCcw, Volume2, VolumeX, CloudRain, Waves, Trees, Coffee, Radio, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface AmbientAppProps {
  windowId?: string;
}

type SoundKind = "rain" | "ocean" | "forest" | "cafe" | "white" | "brown";

interface SoundDef {
  kind: SoundKind;
  label: string;
  icon: typeof CloudRain;
  hint: string;
}

const SOUNDS: SoundDef[] = [
  { kind: "rain",   label: "Rain",       icon: CloudRain, hint: "Filtered white noise + droplet pops" },
  { kind: "ocean",  label: "Ocean",      icon: Waves,     hint: "Brown noise + slow LFO wave swell" },
  { kind: "forest", label: "Forest",     icon: Trees,     hint: "Noise bed + stochastic bird chirps" },
  { kind: "cafe",   label: "Café",       icon: Coffee,    hint: "Brown noise + cup-clink tones" },
  { kind: "white",  label: "White Noise", icon: Radio,    hint: "Pure white noise (all frequencies)" },
  { kind: "brown",  label: "Brown Noise", icon: Radio,    hint: "Integrated noise (low-frequency rumble)" },
];

type TimerMode = "work" | "short" | "long";

const TIMER_PRESETS: Record<TimerMode, { label: string; minutes: number; color: string }> = {
  work:  { label: "Focus",       minutes: 25, color: "oklch(0.82 0.17 195)" },
  short: { label: "Short Break", minutes: 5,  color: "oklch(0.7 0.18 145)" },
  long:  { label: "Long Break",  minutes: 15, color: "oklch(0.85 0.16 85)" },
};

/** Build a noise AudioBuffer of the given type (white or brown). */
function buildNoiseBuffer(ctx: AudioContext, kind: "white" | "brown", seconds = 4): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * seconds;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === "white") {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else {
    // brown noise: leaky integrator of white noise
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** Play a short oscillator chime (used for Pomodoro completion). */
function playChime(ctx: AudioContext, destination: AudioNode, volume: number) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5 — a gentle major chord
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * 0.18, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
    osc.connect(gain).connect(destination);
    osc.start(start);
    osc.stop(start + 1.5);
  });
}

/**
 * SoundEngine — owns the AudioContext and the per-sound node graph. Each sound
 * kind is built lazily on first activation and reused for subsequent toggles.
 * Stored in a ref so React re-renders don't tear down the audio graph.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private whiteBuffer: AudioBuffer | null = null;
  private brownBuffer: AudioBuffer | null = null;
  private active: { kind: SoundKind; nodes: AudioNode[]; cleanup: () => void } | null = null;
  private stochasticTimer: ReturnType<typeof setInterval> | null = null;
  private volume = 0.6;

  /** Lazily create the AudioContext (must be triggered by a user gesture). */
  private ensureContext(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return { ctx: this.ctx, master: this.master! };
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  /** Stop the currently-playing sound and tear down its node graph. */
  stop() {
    if (this.stochasticTimer) {
      clearInterval(this.stochasticTimer);
      this.stochasticTimer = null;
    }
    if (this.active) {
      try { this.active.cleanup(); } catch { /* ignore */ }
      this.active = null;
    }
  }

  /** Build + start the node graph for the given sound kind. */
  play(kind: SoundKind) {
    this.stop();
    const { ctx, master } = this.ensureContext();
    if (!this.whiteBuffer) this.whiteBuffer = buildNoiseBuffer(ctx, "white");
    if (!this.brownBuffer) this.brownBuffer = buildNoiseBuffer(ctx, "brown");

    const nodes: AudioNode[] = [];
    let cleanup: () => void = () => {};

    if (kind === "white" || kind === "brown") {
      const src = ctx.createBufferSource();
      src.buffer = kind === "white" ? this.whiteBuffer : this.brownBuffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = kind === "white" ? 0.25 : 0.4;
      src.connect(gain).connect(master);
      src.start();
      nodes.push(src, gain);
      cleanup = () => { try { src.stop(); } catch { /* already stopped */ } };
    } else if (kind === "rain") {
      // high-passed white noise for the "hiss" + occasional droplet pops
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuffer;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.value = 0.22;
      src.connect(hp).connect(gain).connect(master);
      src.start();
      nodes.push(src, hp, gain);
      // droplet pops
      this.stochasticTimer = setInterval(() => {
        if (Math.random() > 0.4) return;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 1200 + Math.random() * 1800;
        const t = ctx.currentTime;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.06, t + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        osc.connect(env).connect(master);
        osc.start(t);
        osc.stop(t + 0.1);
      }, 90);
      cleanup = () => { try { src.stop(); } catch { /* ignore */ } };
    } else if (kind === "ocean") {
      // brown noise → low-pass → gain modulated by a slow LFO (wave swell)
      const src = ctx.createBufferSource();
      src.buffer = this.brownBuffer;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 500;
      const swell = ctx.createGain();
      swell.gain.value = 0.25;
      // LFO: 0.1 Hz sine between 0.05 and 0.45
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.1;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.2;
      lfo.connect(lfoGain).connect(swell.gain);
      src.connect(lp).connect(swell).connect(master);
      src.start();
      lfo.start();
      nodes.push(src, lp, swell, lfo, lfoGain);
      cleanup = () => {
        try { src.stop(); } catch { /* ignore */ }
        try { lfo.stop(); } catch { /* ignore */ }
      };
    } else if (kind === "forest") {
      // band-passed noise bed + stochastic bird chirps (oscillator sweeps)
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500;
      bp.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0.08;
      src.connect(bp).connect(gain).connect(master);
      src.start();
      nodes.push(src, bp, gain);
      this.stochasticTimer = setInterval(() => {
        if (Math.random() > 0.18) return;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "sine";
        const t = ctx.currentTime;
        const base = 1800 + Math.random() * 1400;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base + 600, t + 0.08);
        osc.frequency.linearRampToValueAtTime(base - 200, t + 0.16);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.05, t + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(env).connect(master);
        osc.start(t);
        osc.stop(t + 0.22);
      }, 400);
      cleanup = () => { try { src.stop(); } catch { /* ignore */ } };
    } else if (kind === "cafe") {
      // brown noise → bandpass (cafe hum) + stochastic cup-clink tones
      const src = ctx.createBufferSource();
      src.buffer = this.brownBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 400;
      bp.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0.18;
      src.connect(bp).connect(gain).connect(master);
      src.start();
      nodes.push(src, bp, gain);
      this.stochasticTimer = setInterval(() => {
        if (Math.random() > 0.12) return;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 800 + Math.random() * 1400;
        const t = ctx.currentTime;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.045, t + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(env).connect(master);
        osc.start(t);
        osc.stop(t + 0.2);
      }, 700);
      cleanup = () => { try { src.stop(); } catch { /* ignore */ } };
    }

    this.active = { kind, nodes, cleanup };
  }

  getActive(): SoundKind | null {
    return this.active?.kind ?? null;
  }

  /** Play a one-shot chime at the current master volume (for Pomodoro completion). */
  chime() {
    const { ctx, master } = this.ensureContext();
    playChime(ctx, master, this.volume);
  }
}

/**
 * AmbientApp — ambient sound generator + Pomodoro timer.
 */
export function AmbientApp({ windowId: _windowId }: AmbientAppProps = {}) {
  // Create the SoundEngine instance exactly once. Using useState with a lazy
  // initializer avoids the "accessing refs during render" lint warning while
  // guaranteeing the same instance across re-renders.
  const [engine] = useState(() => new SoundEngine());

  const [activeSound, setActiveSound] = useState<SoundKind | null>(null);
  const [volume, setVolume] = useState(0.6);
  const [muted, setMuted] = useState(false);

  // Pomodoro state
  const [mode, setMode] = useState<TimerMode>("work");
  const [durations, setDurations] = useState<Record<TimerMode, number>>({
    work: 25,
    short: 5,
    long: 15,
  });
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);

  // Notification permission
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  // Apply volume changes
  useEffect(() => {
    engine.setVolume(muted ? 0 : volume);
  }, [volume, muted, engine]);

  // Initialize notification-permission snapshot. Wrapped in a microtask so
  // the setState call is not synchronous in the effect body (lint-clean).
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    Promise.resolve().then(() => setNotifPerm(Notification.permission));
  }, []);

  /** Toggle a sound on/off. */
  const toggleSound = useCallback((kind: SoundKind) => {
    if (activeSound === kind) {
      engine.stop();
      setActiveSound(null);
    } else {
      engine.play(kind);
      setActiveSound(kind);
    }
  }, [activeSound, engine]);

  /** Mute/unmute (preserves volume slider position). */
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  /** Reset the timer to the current mode's full duration. */
  const resetTimer = useCallback(() => {
    setRunning(false);
    setSecondsLeft(durations[mode] * 60);
  }, [durations, mode]);

  /** Switch timer mode (resets the countdown). */
  const switchMode = useCallback((m: TimerMode) => {
    setMode(m);
    setRunning(false);
    setSecondsLeft(durations[m] * 60);
  }, [durations]);

  /** Adjust a mode's duration (clamped 1–90 minutes). */
  const adjustDuration = useCallback((m: TimerMode, minutes: number) => {
    const clamped = Math.max(1, Math.min(90, minutes));
    setDurations((prev) => {
      const next = { ...prev, [m]: clamped };
      if (m === mode) setSecondsLeft(clamped * 60);
      return next;
    });
  }, [mode]);

  /** Send a browser notification + chime when the timer hits zero. */
  const notifyCompletion = useCallback((finishedMode: TimerMode) => {
    engine.chime();
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      const label = TIMER_PRESETS[finishedMode].label;
      const next = finishedMode === "work" ? "Time for a break." : "Time to focus.";
      try {
        new Notification(`${label} complete`, { body: next });
      } catch {
        // notification creation failed — non-fatal
      }
    }
  }, [engine]);

  /** Request notification permission on user action. */
  const requestNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  }, []);

  // Countdown tick
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // advance to next mode
          const finishedMode = mode;
          let nextMode: TimerMode;
          if (finishedMode === "work") {
            const newCycles = cyclesCompleted + 1;
            setCyclesCompleted(newCycles);
            // every 4 work cycles → long break
            nextMode = newCycles % 4 === 0 ? "long" : "short";
          } else {
            nextMode = "work";
          }
          notifyCompletion(finishedMode);
          setMode(nextMode);
          setRunning(false);
          return durations[nextMode] * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, cyclesCompleted, durations, notifyCompletion]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      engine.stop();
    };
  }, [engine]);

  const totalSeconds = durations[mode] * 60;
  const progress = totalSeconds > 0 ? 1 - secondsLeft / totalSeconds : 0;
  const accent = TIMER_PRESETS[mode].color;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // SVG ring geometry
  const ringRadius = 70;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progress);

  const soundCards = useMemo(() => SOUNDS, []);

  return (
    <div className="flex h-full flex-col bg-background lg:flex-row">
      {/* Soundboard */}
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono-ae text-sm font-semibold">Soundscapes</h3>
          <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
            procedural · Web Audio API
          </span>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
          {soundCards.map((s) => {
            const Icon = s.icon;
            const isActive = activeSound === s.kind;
            return (
              <motion.button
                key={s.kind}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => toggleSound(s.kind)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  isActive
                    ? "border-[oklch(0.82_0.17_195)] bg-[oklch(0.82_0.17_195)]/[0.08] shadow-[0_0_18px_-4px_oklch(0.82_0.17_195/0.5)]"
                    : "border-border/50 bg-card/30 hover:border-[oklch(0.82_0.17_195)]/40 hover:bg-card/50"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      isActive ? "text-[oklch(0.82_0.17_195)]" : "text-muted-foreground"
                    )}
                  />
                  {isActive && (
                    <motion.span
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="h-1.5 w-1.5 rounded-full bg-[oklch(0.82_0.17_195)]"
                    />
                  )}
                </div>
                <div>
                  <div className="font-mono-ae text-xs font-semibold text-foreground">
                    {s.label}
                  </div>
                  <div className="font-mono-ae text-[0.55rem] text-muted-foreground/60">
                    {s.hint}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Volume */}
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border/50 bg-card/30 p-3">
          <button onClick={toggleMute} className="text-muted-foreground hover:text-foreground">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => {
              setVolume(v[0] ?? 0);
              if (muted && (v[0] ?? 0) > 0) setMuted(false);
            }}
            className="flex-1"
          />
          <span className="font-mono-ae w-10 text-right text-xs text-muted-foreground">
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </div>
      </div>

      {/* Pomodoro */}
      <aside className="flex w-full shrink-0 flex-col items-center border-t border-border/50 bg-card/20 p-4 lg:w-80 lg:border-l lg:border-t-0">
        <h3 className="mb-1 font-mono-ae text-sm font-semibold">Pomodoro</h3>
        <p className="mb-3 font-mono-ae text-[0.6rem] text-muted-foreground/60">
          focus cycle #{cyclesCompleted + 1}
        </p>

        {/* Mode tabs */}
        <div className="mb-4 flex gap-1 rounded-md border border-border/50 bg-background/60 p-1">
          {(Object.keys(TIMER_PRESETS) as TimerMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "rounded px-2.5 py-1 font-mono-ae text-[0.65rem] font-medium transition-all",
                mode === m
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              style={mode === m ? { color: TIMER_PRESETS[m].color } : undefined}
            >
              {TIMER_PRESETS[m].label}
            </button>
          ))}
        </div>

        {/* Countdown ring */}
        <div className="relative mb-4 h-44 w-44">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 160 160">
            <circle
              cx="80"
              cy="80"
              r={ringRadius}
              fill="none"
              stroke="oklch(0.22 0.03 280)"
              strokeWidth="6"
            />
            <circle
              cx="80"
              cy="80"
              r={ringRadius}
              fill="none"
              stroke={accent}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringOffset}
              style={{ transition: running ? "stroke-dashoffset 1s linear" : "none" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-mono-ae text-3xl font-semibold text-foreground tabular-nums">
              {timeStr}
            </div>
            <div className="font-mono-ae mt-1 text-[0.6rem] uppercase tracking-wider" style={{ color: accent }}>
              {TIMER_PRESETS[mode].label}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-4 flex gap-2">
          <Button
            onClick={() => setRunning((r) => !r)}
            size="sm"
            className="bg-[oklch(0.82_0.17_195)] px-4 text-background hover:bg-[oklch(0.82_0.17_195)]/80"
          >
            {running ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            {running ? "Pause" : "Start"}
          </Button>
          <Button variant="outline" size="sm" onClick={resetTimer}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        {/* Duration controls */}
        <div className="w-full space-y-2">
          <div className="font-mono-ae text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            durations (minutes)
          </div>
          {(Object.keys(TIMER_PRESETS) as TimerMode[]).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <span className="font-mono-ae w-20 text-[0.65rem]" style={{ color: TIMER_PRESETS[m].color }}>
                {TIMER_PRESETS[m].label}
              </span>
              <input
                type="range"
                min={1}
                max={90}
                value={durations[m]}
                onChange={(e) => adjustDuration(m, parseInt(e.target.value, 10))}
                className="flex-1 accent-[oklch(0.82_0.17_195)]"
              />
              <span className="font-mono-ae w-8 text-right text-xs text-muted-foreground tabular-nums">
                {durations[m]}
              </span>
            </div>
          ))}
        </div>

        {/* Notification permission toggle */}
        <div className="mt-4 w-full">
          {notifPerm === "unsupported" ? (
            <p className="font-mono-ae text-center text-[0.55rem] text-muted-foreground/50">
              Notifications not supported — chime will still play.
            </p>
          ) : notifPerm === "granted" ? (
            <p className="font-mono-ae flex items-center justify-center gap-1 text-[0.55rem] text-[oklch(0.7_0.18_145)]">
              <Bell className="h-3 w-3" />
              Notifications enabled
            </p>
          ) : (
            <Button variant="ghost" size="sm" onClick={requestNotifications} className="w-full text-xs">
              <Bell className="mr-1.5 h-3 w-3" />
              Enable notifications
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}

export default AmbientApp;
