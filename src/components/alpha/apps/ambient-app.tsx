/**
 * ambient-app.tsx — Alpha-OS Ambient Soundscapes + Pomodoro.
 *
 * Purpose: six procedurally generated soundscapes built entirely from Web Audio
 * oscillators/filters/noise buffers (NO audio files): rain (high-passed white
 * noise + stochastic droplets), ocean (brown noise → low-pass → 0.1 Hz LFO
 * swell), forest (band-passed noise + bird-chirp frequency sweeps), café
 * (brown-noise murmur + cup-clink tones), white noise and brown noise. Plus a
 * full Pomodoro timer: configurable work/short/long durations, SVG countdown
 * ring, auto-advance (long break every 4 work cycles), a 3-note oscillator
 * arpeggio chime and desktop Notification on completion.
 *
 * Browser-API compatibility:
 *  - AudioContext is created lazily on first user interaction; unsupported
 *    browsers simply get a silent UI (engine guards on a missing constructor).
 *  - Notification is feature-detected; permission states degrade to a hint.
 *  - localStorage (settings) wrapped in try/catch.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CloudRain, Waves, Bird, Coffee, Radio, Activity, Volume2, VolumeX,
  Play, Pause, RotateCcw, SkipForward, BellRing, BellOff,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// ================================= SOUND ENGINE ==============================

type ScapeId = "rain" | "ocean" | "forest" | "cafe" | "white" | "brown";

type Phase = "work" | "short" | "long";

/** Build a looping noise buffer (brown via leaky integrator, white otherwise). */
function makeNoiseBuffer(ctx: AudioContext, brown: boolean): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/** Recursively run `fn` at random intervals; returns a stop function. */
function scheduleRandomLoop(fn: () => void, minMs: number, maxMs: number, timers: number[]): () => void {
  let stopped = false;
  const step = () => {
    if (stopped) return;
    fn();
    const id = window.setTimeout(step, minMs + Math.random() * (maxMs - minMs));
    timers.push(id);
  };
  const first = window.setTimeout(step, 250 + Math.random() * 700);
  timers.push(first);
  return () => {
    stopped = true;
  };
}

/** A one-shot tonal blip with exponential decay (droplets / chirps / clinks). */
function blip(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  endFreq: number | null,
  dur: number,
  peak: number,
  type: OscillatorType
): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + dur * 0.15);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

type BuilderCtx = {
  ctx: AudioContext;
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
  timers: number[];
  stops: Array<() => void>;
};

const SCAPE_BUILDERS: Record<ScapeId, (b: BuilderCtx) => void> = {
  rain: ({ ctx, out, nodes, timers, stops }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, false);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    src.connect(hp);
    hp.connect(gain);
    gain.connect(out);
    src.start();
    nodes.push(src);
    // stochastic droplets
    stops.push(
      scheduleRandomLoop(
        () => blip(ctx, out, 1600 + Math.random() * 1800, null, 0.06 + Math.random() * 0.05, 0.05, "sine"),
        90,
        550,
        timers
      )
    );
  },
  ocean: ({ ctx, out, nodes }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const swell = ctx.createGain();
    swell.gain.value = 0.3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.1;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.14;
    lfo.connect(lfoDepth);
    lfoDepth.connect(swell.gain);
    src.connect(lp);
    lp.connect(swell);
    swell.connect(out);
    src.start();
    lfo.start();
    nodes.push(src, lfo);
  },
  forest: ({ ctx, out, nodes, timers, stops }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, false);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.1;
    src.connect(bp);
    bp.connect(gain);
    gain.connect(out);
    src.start();
    nodes.push(src);
    // bird-chirp frequency sweeps (2-3 quick up-chirps per visit)
    stops.push(
      scheduleRandomLoop(
        () => {
          const chirps = 2 + Math.floor(Math.random() * 2);
          for (let c = 0; c < chirps; c += 1) {
            const base = 2400 + Math.random() * 1800;
            const id = window.setTimeout(
              () => blip(ctx, out, base, base * (1.25 + Math.random() * 0.35), 0.14, 0.06, "sine"),
              c * 160
            );
            timers.push(id);
          }
        },
        900,
        3800,
        timers
      )
    );
  },
  cafe: ({ ctx, out, nodes, timers, stops }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    const murmur = ctx.createGain();
    murmur.gain.value = 0.22;
    src.connect(lp);
    lp.connect(murmur);
    murmur.connect(out);
    src.start();
    nodes.push(src);
    // cup clinks
    stops.push(
      scheduleRandomLoop(
        () => blip(ctx, out, 1700 + Math.random() * 1200, null, 0.16, 0.045, "triangle"),
        700,
        2600,
        timers
      )
    );
  },
  white: ({ ctx, out, nodes }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, false);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 9000;
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    src.connect(lp);
    lp.connect(gain);
    gain.connect(out);
    src.start();
    nodes.push(src);
  },
  brown: ({ ctx, out, nodes }) => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, true);
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.24;
    src.connect(gain);
    gain.connect(out);
    src.start();
    nodes.push(src);
  },
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Map<ScapeId, () => void>();
  private volume = 0.7;
  private muted = false;

  /** Lazily create the AudioContext (must be triggered by a user gesture). */
  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  start(id: ScapeId): void {
    if (this.active.has(id)) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const nodes: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const stops: Array<() => void> = [];
    SCAPE_BUILDERS[id]({ ctx, out: this.master, nodes, timers, stops });
    this.active.set(id, () => {
      stops.forEach((s) => s());
      timers.forEach((t) => window.clearTimeout(t));
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      });
    });
  }

  stop(id: ScapeId): void {
    const cleanup = this.active.get(id);
    if (cleanup) cleanup();
    this.active.delete(id);
  }

  isActive(id: ScapeId): boolean {
    return this.active.has(id);
  }

  /** 3-note arpeggio chime (C5-E5-G5) for Pomodoro completions. */
  chime(): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain);
      gain.connect(this.master as GainNode);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  dispose(): void {
    this.active.forEach((cleanup) => cleanup());
    this.active.clear();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.master = null;
    }
  }
}

// ================================== POMODORO =================================

const PHASE_META: Record<Phase, { label: string; color: string }> = {
  work: { label: "Focus", color: "var(--ae-cyan)" },
  short: { label: "Short break", color: "var(--ae-emerald)" },
  long: { label: "Long break", color: "var(--ae-amethyst)" },
};

const SETTINGS_KEY = "alpha-os:ambient:settings";
type Settings = { work: number; short: number; long: number; volume: number };
type Minutes = Pick<Settings, "work" | "short" | "long">;
type Pomo = { phase: Phase; cycles: number; remaining: number; deadline: number; running: boolean };

function loadSettings(): Partial<Settings> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const s = parsed as Partial<Settings>;
    const out: Partial<Settings> = {};
    if (typeof s.work === "number") out.work = s.work;
    if (typeof s.short === "number") out.short = s.short;
    if (typeof s.long === "number") out.long = s.long;
    if (typeof s.volume === "number") out.volume = s.volume;
    return out;
  } catch {
    return {};
  }
}

function clampMinutes(v: number): number {
  return Math.min(120, Math.max(1, Math.round(v) || 1));
}

function minutesOf(m: Minutes, phase: Phase): number {
  return phase === "work" ? m.work : phase === "short" ? m.short : m.long;
}

// ================================== THE APP ==================================

const SCAPES: Array<{ id: ScapeId; label: string; desc: string; icon: typeof CloudRain }> = [
  { id: "rain", label: "Rain", desc: "high-passed hiss + droplets", icon: CloudRain },
  { id: "ocean", label: "Ocean", desc: "brown swell, 0.1 Hz LFO", icon: Waves },
  { id: "forest", label: "Forest", desc: "band-passed air + birds", icon: Bird },
  { id: "cafe", label: "Café", desc: "murmur + cup clinks", icon: Coffee },
  { id: "white", label: "White", desc: "flat spectrum masker", icon: Radio },
  { id: "brown", label: "Brown", desc: "deep low rumble", icon: Activity },
];

const INITIAL_MINUTES: Minutes = { work: 25, short: 5, long: 15 };

export function AmbientApp({ windowId: _windowId }: { windowId?: string }) {
  const [engine] = useState(() => new SoundEngine());
  const [activeScapes, setActiveScapes] = useState<ScapeId[]>([]);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  const [minutes, setMinutes] = useState<Minutes>(INITIAL_MINUTES);
  const [pomo, setPomo] = useState<Pomo>({ phase: "work", cycles: 0, remaining: 25 * 60, deadline: 0, running: false });
  const [notifState, setNotifState] = useState<"unsupported" | "default" | "granted" | "denied">("unsupported");

  // Mirror refs for the timer callback (written only inside effects/handlers).
  const pomoRef = useRef(pomo);
  const minutesRef = useRef(minutes);
  useEffect(() => {
    pomoRef.current = pomo;
  }, [pomo]);
  useEffect(() => {
    minutesRef.current = minutes;
  }, [minutes]);

  /** Fire the completion chime + notification (called from async contexts). */
  const celebrate = (finishedWork: boolean) => {
    engine.chime();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Alpha-OS Pomodoro", {
          body: finishedWork ? "Work cycle complete — take a break." : "Break over — back to focus.",
        });
      } catch {
        /* notifications unavailable */
      }
    }
  };

  /** Advance to the next phase; `prev` is read explicitly so this is safe
   *  from both the interval callback and the Skip button. The mirror ref is
   *  updated immediately so a re-entrant timer tick cannot double-advance. */
  const advanceFrom = (prev: Pomo, withChime: boolean) => {
    const wasWork = prev.phase === "work";
    const nextCycles = wasWork ? prev.cycles + 1 : prev.cycles;
    const next: Phase = wasWork ? (nextCycles % 4 === 0 ? "long" : "short") : "work";
    const dur = minutesOf(minutesRef.current, next) * 60;
    const updated: Pomo = {
      phase: next,
      cycles: nextCycles,
      remaining: dur,
      deadline: Date.now() + dur * 1000,
      running: prev.running,
    };
    pomoRef.current = updated;
    setPomo(updated);
    if (withChime) celebrate(wasWork);
  };

  // Deferred settings hydration.
  useEffect(() => {
    Promise.resolve().then(() => {
      const s = loadSettings();
      const next: Minutes = {
        work: clampMinutes(s.work ?? 25),
        short: clampMinutes(s.short ?? 5),
        long: clampMinutes(s.long ?? 15),
      };
      setMinutes(next);
      minutesRef.current = next;
      const vol = typeof s.volume === "number" ? Math.min(1, Math.max(0, s.volume)) : 0.7;
      setVolume(vol);
      engine.setVolume(vol);
      setPomo({ phase: "work", cycles: 0, remaining: next.work * 60, deadline: 0, running: false });
      if (typeof Notification === "undefined") setNotifState("unsupported");
      else setNotifState(Notification.permission);
    });
  }, [engine]);

  // Persist settings.
  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...minutes, volume }));
    } catch {
      /* ignore quota errors */
    }
  }, [minutes, volume]);

  // Teardown audio on unmount.
  useEffect(() => () => engine.dispose(), [engine]);

  // Countdown loop — the interval callback owns all mutations (async context).
  useEffect(() => {
    if (!pomo.running) return;
    const timer = window.setInterval(() => {
      const prev = pomoRef.current;
      if (!prev.running) return;
      const rem = Math.max(0, (prev.deadline - Date.now()) / 1000);
      if (rem > 0) {
        setPomo({ ...prev, remaining: rem });
      } else {
        advanceFrom(prev, true);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [pomo.running]);

  const toggleScape = (id: ScapeId) => {
    if (engine.isActive(id)) {
      engine.stop(id);
      setActiveScapes(activeScapes.filter((s) => s !== id));
    } else {
      engine.start(id);
      setActiveScapes([...activeScapes, id]);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engine.setMuted(next);
  };

  const startPause = () => {
    if (pomo.running) {
      setPomo({ ...pomo, running: false });
      return;
    }
    const dur = pomo.remaining > 0 ? pomo.remaining : minutesOf(minutes, pomo.phase) * 60;
    setPomo({ ...pomo, running: true, remaining: dur, deadline: Date.now() + dur * 1000 });
  };

  const resetPomo = () => {
    setPomo({ phase: "work", cycles: 0, remaining: minutes.work * 60, deadline: 0, running: false });
  };

  const changeMinutes = (key: "work" | "short" | "long", value: number) => {
    const v = clampMinutes(value);
    const next = { ...minutes, [key]: v };
    setMinutes(next);
    minutesRef.current = next;
    if (!pomo.running && pomo.phase === key) {
      setPomo((p) => ({ ...p, remaining: v * 60 }));
    }
  };

  const requestNotifications = () => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission()
      .then((p) => setNotifState(p))
      .catch(() => setNotifState("denied"));
  };

  const total = minutesOf(minutes, pomo.phase) * 60;
  const frac = total > 0 ? Math.min(1, Math.max(0, pomo.remaining / total)) : 0;
  const R = 86;
  const CIRC = 2 * Math.PI * R;
  const shown = Math.ceil(pomo.remaining);
  const mm = Math.floor(shown / 60);
  const ss = shown % 60;

  return (
    <div className="scroll-ae grid h-full grid-cols-1 grid-rows-[1fr_auto] gap-2 overflow-y-auto bg-(--ae-obsidian-deep) p-2.5 lg:grid-cols-2 lg:grid-rows-1 lg:overflow-hidden">
      {/* soundscapes */}
      <section className="glass flex min-h-0 flex-col rounded-xl p-3">
        <span className="eyebrow mb-2">Soundscapes · procedural</span>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5">
          {SCAPES.map(({ id, label, desc, icon: Icon }) => {
            const on = activeScapes.includes(id);
            return (
              <motion.button
                key={id}
                whileTap={{ scale: 0.96 }}
                onClick={() => toggleScape(id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  on
                    ? "border-(--ae-cyan)/40 bg-(--ae-cyan)/10 glow-cyan"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <Icon className={cn("h-4 w-4", on ? "text-(--ae-cyan)" : "text-zinc-400")} />
                  {on && <span className="neural-dot" />}
                </span>
                <span className={cn("text-xs font-medium", on ? "text-(--ae-cyan)" : "text-zinc-200")}>{label}</span>
                <span className="text-[9px] leading-tight text-zinc-500">{desc}</span>
              </motion.button>
            );
          })}
        </div>
        <div className="mt-2.5 flex items-center gap-2 border-t border-white/10 pt-2.5">
          <motion.button whileTap={{ scale: 0.9 }} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? (
              <VolumeX className="h-4 w-4 text-(--ae-rose)" />
            ) : (
              <Volume2 className="h-4 w-4 text-(--ae-cyan)" />
            )}
          </motion.button>
          <Slider
            value={[Math.round(volume * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(vals) => {
              const v = (vals[0] ?? 70) / 100;
              setVolume(v);
              engine.setVolume(v);
            }}
            className="flex-1"
          />
          <span className="w-8 text-right font-mono-ae text-[10px] text-zinc-500">{Math.round(volume * 100)}</span>
        </div>
      </section>

      {/* pomodoro */}
      <section className="glass flex min-h-0 flex-col items-center rounded-xl p-3">
        <div className="mb-1 flex w-full items-center justify-between">
          <span className="eyebrow">Pomodoro</span>
          <span className="font-mono-ae text-[10px] text-zinc-500">
            {pomo.cycles} work cycle{pomo.cycles === 1 ? "" : "s"} · long break every 4
          </span>
        </div>

        <div className="relative my-1">
          <svg viewBox="0 0 200 200" className="h-40 w-40 -rotate-90 lg:h-44 lg:w-44">
            <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={PHASE_META[pomo.phase].color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              style={{
                transition: "stroke-dashoffset 0.25s linear, stroke 0.4s",
                filter: `drop-shadow(0 0 5px ${PHASE_META[pomo.phase].color})`,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono-ae text-3xl font-semibold text-zinc-100">
              {mm}:{String(ss).padStart(2, "0")}
            </span>
            <span className="eyebrow mt-0.5" style={{ color: PHASE_META[pomo.phase].color }}>
              {PHASE_META[pomo.phase].label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={startPause}
            className="flex items-center gap-1.5 rounded-full border border-(--ae-cyan)/40 bg-(--ae-cyan)/15 px-4 py-1.5 text-xs text-(--ae-cyan) transition-colors hover:bg-(--ae-cyan)/25"
          >
            {pomo.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {pomo.running ? "Pause" : "Start"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => advanceFrom(pomoRef.current, false)}
            aria-label="Skip phase"
            className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-(--ae-amethyst)"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={resetPomo}
            aria-label="Reset"
            className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-(--ae-rose)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </motion.button>
        </div>

        <div className="mt-2.5 flex items-end gap-2">
          {(["work", "short", "long"] as const).map((k) => (
            <label key={k} className="flex flex-col items-center gap-0.5">
              <span className="eyebrow">{k === "work" ? "work" : k === "short" ? "short" : "long"}</span>
              <input
                type="number"
                min={1}
                max={120}
                value={minutes[k]}
                onChange={(e) => changeMinutes(k, Number(e.target.value))}
                className="w-12 rounded-md border border-white/10 bg-white/[0.04] px-1 py-0.5 text-center font-mono-ae text-xs text-zinc-200 focus:border-(--ae-cyan)/40 focus:outline-none"
              />
            </label>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
          {notifState === "granted" ? (
            <span className="flex items-center gap-1 text-(--ae-emerald)">
              <BellRing className="h-3 w-3" /> notifications on
            </span>
          ) : notifState === "unsupported" ? (
            <span className="flex items-center gap-1">
              <BellOff className="h-3 w-3" /> notifications unsupported — chime only
            </span>
          ) : notifState === "denied" ? (
            <span className="flex items-center gap-1">
              <BellOff className="h-3 w-3" /> notifications blocked in browser settings
            </span>
          ) : (
            <button
              onClick={requestNotifications}
              className="flex items-center gap-1 text-(--ae-gold) transition-colors hover:text-glow-gold"
            >
              <BellRing className="h-3 w-3" /> enable completion notifications
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default AmbientApp;
