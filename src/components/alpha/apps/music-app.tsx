/**
 * music-app.tsx — generative ambient music player.
 *
 * Features:
 * - 4 generative "tracks" (Focus, Chill, Epic, Sleep) — each generates a
 *   different pattern of notes via oscillators + a feedback-delay reverb
 * - Procedural: NO audio files, no samples. Every note is synthesized live.
 * - Play / pause / stop, track selector, master volume slider
 * - Live frequency-bar visualizer (AnalyserNode → canvas, rAF loop)
 *
 * Browser compatibility notes:
 * - `AudioContext` requires a user gesture before producing sound; the play
 *   button itself satisfies that gesture requirement.
 * - `webkitAudioContext` fallback is provided for older Safari.
 * - The `OfflineAudioContext`-based convolver impulse is generated on demand
 *   so we don't ship an impulse-response file.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Square, Volume2, VolumeX, Music, Brain, Cloud, Zap, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface MusicAppProps {
  windowId?: string;
}

type TrackKind = "focus" | "chill" | "epic" | "sleep";

interface TrackDef {
  kind: TrackKind;
  label: string;
  description: string;
  icon: typeof Music;
  accent: string;
  // Scale degrees (semitone offsets from the root) — pentatonic / minor modes
  scale: number[];
  // Base note (MIDI note number)
  root: number;
  // Tempo: how often a new note fires (ms)
  noteInterval: number;
  // Note duration (s)
  noteDuration: number;
  // Waveform
  waveform: OscillatorType;
  // Reverb decay (s) for the feedback delay
  reverbDecay: number;
  // Octave range to randomly pick from (e.g. [0, 1] = root octave + 1 above)
  octaveRange: [number, number];
}

const TRACKS: TrackDef[] = [
  {
    kind: "focus",
    label: "Focus",
    description: "Pentatonic arpeggio · steady 2 notes/s",
    icon: Brain,
    accent: "oklch(0.82 0.17 195)",
    scale: [0, 3, 5, 7, 10], // minor pentatonic
    root: 57, // A3
    noteInterval: 500,
    noteDuration: 0.8,
    waveform: "triangle",
    reverbDecay: 1.2,
    octaveRange: [0, 1],
  },
  {
    kind: "chill",
    label: "Chill",
    description: "Sparse major-mode tones · long reverb",
    icon: Cloud,
    accent: "oklch(0.7 0.18 145)",
    scale: [0, 2, 4, 7, 9], // major pentatonic
    root: 52, // E3
    noteInterval: 1400,
    noteDuration: 2.0,
    waveform: "sine",
    reverbDecay: 2.8,
    octaveRange: [0, 1],
  },
  {
    kind: "epic",
    label: "Epic",
    description: "Sawtooth chord stabs · driving rhythm",
    icon: Zap,
    accent: "oklch(0.85 0.16 85)",
    scale: [0, 3, 7, 10, 14], // minor 7 + 9
    root: 45, // A2
    noteInterval: 900,
    noteDuration: 0.7,
    waveform: "sawtooth",
    reverbDecay: 1.6,
    octaveRange: [0, 0],
  },
  {
    kind: "sleep",
    label: "Sleep",
    description: "Sub-bass sine tones · dreamlike drift",
    icon: Moon,
    accent: "oklch(0.74 0.22 300)",
    scale: [0, 5, 7, 12], // sparse perfect-fourth + fifth
    root: 40, // E2
    noteInterval: 2400,
    noteDuration: 3.2,
    waveform: "sine",
    reverbDecay: 3.5,
    octaveRange: [0, 1],
  },
];

/** Convert a MIDI note number to a frequency in Hz. */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Build a short impulse-response buffer for a ConvolverNode (procedural reverb).
 * This decays exponentially over `duration` seconds with white noise.
 */
function buildImpulse(ctx: AudioContext, duration: number, decay: number = 2): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // stereo decorrelation: different noise per channel
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

/**
 * MusicEngine — owns the AudioContext + master gain + analyser + reverb, and
 * runs a per-track scheduler (lookahead pattern). Stored in a ref so React
 * re-renders don't tear down the audio graph.
 */
class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private currentTrack: TrackDef | null = null;
  private volume = 0.5;
  private playing = false;
  // 25 ms lookahead, 100 ms schedule-ahead window
  private readonly LOOKAHEAD_MS = 25;
  private readonly SCHEDULE_AHEAD_S = 0.1;

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Lazily create the AudioContext + master chain. */
  private ensureContext(): { ctx: AudioContext; master: GainNode; analyser: AnalyserNode } {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      // Reverb chain: dry + wet → master → analyser → destination
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = buildImpulse(this.ctx, 2, 2);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.4;
      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 0.7;
      this.dryGain.connect(this.master);
      this.reverb.connect(this.reverbGain).connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return { ctx: this.ctx, master: this.master!, analyser: this.analyser! };
  }

  /** Schedule one note (oscillator + gain envelope) at an exact audio time. */
  private scheduleNote(track: TrackDef, time: number) {
    if (!this.ctx || !this.dryGain || !this.reverb) return;
    const ctx = this.ctx;
    // Pick a random scale degree + octave
    const degree = track.scale[Math.floor(Math.random() * track.scale.length)];
    const oct = track.octaveRange[0] + Math.floor(Math.random() * (track.octaveRange[1] - track.octaveRange[0] + 1));
    const midi = track.root + degree + oct * 12;
    const freq = midiToFreq(midi);

    const osc = ctx.createOscillator();
    osc.type = track.waveform;
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const dur = track.noteDuration;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.22, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    // Add a soft low-pass for warmth
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(800, freq * 6);

    osc.connect(lp).connect(env);
    // send to dry + reverb
    env.connect(this.dryGain);
    env.connect(this.reverb);

    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  /** Lookahead scheduler — fires every LOOKAHEAD_MS and schedules any notes
   *  that fall within the next SCHEDULE_AHEAD_S seconds. */
  private scheduler = () => {
    if (!this.ctx || !this.currentTrack) return;
    const intervalS = this.currentTrack.noteInterval / 1000;
    while (this.nextNoteTime < this.ctx.currentTime + this.SCHEDULE_AHEAD_S) {
      this.scheduleNote(this.currentTrack, this.nextNoteTime);
      this.nextNoteTime += intervalS;
      // tiny humanization: ±5 % timing jitter
      this.nextNoteTime += (Math.random() - 0.5) * intervalS * 0.1;
    }
  };

  /** Start playing the given track. Switches seamlessly if already playing. */
  play(track: TrackDef) {
    const { ctx } = this.ensureContext();
    this.currentTrack = track;
    if (!this.playing) {
      this.playing = true;
      this.nextNoteTime = ctx.currentTime + 0.05;
      this.schedulerId = setInterval(this.scheduler, this.LOOKAHEAD_MS);
    }
  }

  /** Pause the scheduler (notes already scheduled will still ring out). */
  pause() {
    this.playing = false;
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  /** Full stop — pause + tear down any in-flight oscillators via quick fade. */
  stop() {
    this.pause();
    this.currentTrack = null;
    if (this.master && this.ctx) {
      // brief fade to silence to avoid clicks on abrupt stop
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + 0.05);
      this.master.gain.linearRampToValueAtTime(this.volume, now + 0.1);
    }
  }

  /** Switch the active track without stopping playback. */
  switchTrack(track: TrackDef) {
    this.currentTrack = track;
    // reset scheduling to land the next note quickly
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
  }
}

/**
 * MusicApp — generative ambient music player with visualizer.
 */
export function MusicApp({ windowId: _windowId }: MusicAppProps = {}) {
  // Create the MusicEngine instance exactly once. Using useState with a lazy
  // initializer avoids the "accessing refs during render" lint warning while
  // guaranteeing the same instance across re-renders.
  const [engine] = useState(() => new MusicEngine());

  const [activeTrack, setActiveTrack] = useState<TrackKind | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Apply volume changes
  useEffect(() => {
    engine.setVolume(muted ? 0 : volume);
  }, [volume, muted, engine]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engine.stop();
      cancelAnimationFrame(rafRef.current);
    };
  }, [engine]);

  /** Play/pause toggle. Picks the first track if none is selected. */
  const togglePlay = useCallback(() => {
    if (playing) {
      engine.pause();
      setPlaying(false);
    } else {
      const track = TRACKS.find((t) => t.kind === activeTrack) ?? TRACKS[0];
      if (!activeTrack) setActiveTrack(track.kind);
      engine.play(track);
      setPlaying(true);
    }
  }, [playing, activeTrack, engine]);

  /** Stop playback entirely. */
  const stop = useCallback(() => {
    engine.stop();
    setPlaying(false);
  }, [engine]);

  /** Select a different track (seamless switch if playing). */
  const selectTrack = useCallback((track: TrackDef) => {
    setActiveTrack(track.kind);
    if (playing) {
      engine.switchTrack(track);
    }
  }, [playing, engine]);

  /** Mute/unmute (preserves volume slider position). */
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // Visualizer rAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const analyser = engine.getAnalyser();
      if (!analyser || !playing) {
        // idle state: draw a flat baseline
        ctx.fillStyle = "oklch(0.3 0.08 290 / 0.3)";
        const barCount = 48;
        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const idleH = 2 + Math.sin(Date.now() / 600 + i * 0.3) * 1.5;
          ctx.fillRect(i * barW + 1, h - idleH, barW - 2, idleH);
        }
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const data = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(data);

      // Use the first 48 bins (low-mid frequencies, where the music lives)
      const barCount = 48;
      const barW = w / barCount;
      const accent = activeTrack
        ? TRACKS.find((t) => t.kind === activeTrack)?.accent ?? "oklch(0.82 0.17 195)"
        : "oklch(0.82 0.17 195)";

      for (let i = 0; i < barCount; i++) {
        const v = data[i] / 255;
        const barH = Math.max(2, v * h * 0.95);
        // gradient: accent at bottom → muted at top
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, "oklch(0.5 0.05 250 / 0.4)");
        ctx.fillStyle = grad;
        ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engine, playing, activeTrack]);

  // Resize the canvas to its container's pixel size (HiDPI-aware)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      // re-set the transform: the above scale stacks with each call, so reset
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
          <h3 className="font-mono-ae text-sm font-semibold">Generative Music</h3>
        </div>
        <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
          procedural · Web Audio API
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {/* Visualizer */}
        <div className="mb-4 overflow-hidden rounded-lg border border-border/50 bg-card/30 p-3">
          <canvas
            ref={canvasRef}
            className="h-32 w-full"
            style={{ width: "100%", height: "128px" }}
          />
        </div>

        {/* Track selector */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TRACKS.map((track) => {
            const Icon = track.icon;
            const isActive = activeTrack === track.kind;
            return (
              <motion.button
                key={track.kind}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => selectTrack(track)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all",
                  isActive
                    ? "border-2 bg-card/50"
                    : "border-border/50 bg-card/20 hover:bg-card/40"
                )}
                style={isActive ? { borderColor: track.accent, boxShadow: `0 0 14px -4px ${track.accent}` } : undefined}
              >
                <Icon
                  className="h-5 w-5"
                  style={{ color: isActive ? track.accent : "oklch(0.6 0.05 250)" }}
                />
                <span
                  className="font-mono-ae text-xs font-semibold"
                  style={{ color: isActive ? track.accent : "rgb(var(--foreground-rgb) / 0.85)" }}
                >
                  {track.label}
                </span>
                <span className="font-mono-ae text-[0.55rem] text-muted-foreground/60">
                  {track.description}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Transport controls */}
        <div className="mb-4 flex items-center justify-center gap-3">
          <Button
            onClick={togglePlay}
            size="lg"
            className="h-12 w-12 rounded-full bg-[oklch(0.82_0.17_195)] p-0 text-background hover:bg-[oklch(0.82_0.17_195)]/80"
            disabled={!activeTrack && false /* always allow — defaults to Focus */}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </Button>
          <Button
            onClick={stop}
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>

        {/* Volume */}
        <div className="mt-auto flex items-center gap-3 rounded-md border border-border/50 bg-card/30 p-3">
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

        {/* Status */}
        <div className="mt-3 flex items-center justify-center gap-2">
          {playing ? (
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="font-mono-ae flex items-center gap-1.5 text-[0.6rem] text-[oklch(0.7_0.18_145)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.7_0.18_145)]" />
              playing · {activeTrack ? TRACKS.find((t) => t.kind === activeTrack)?.label : "—"}
            </motion.span>
          ) : (
            <span className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
              stopped
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MusicApp;
