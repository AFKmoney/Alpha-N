/**
 * music-app.tsx — Alpha-OS Generative Music Player.
 *
 * Purpose: infinite ambient music generated live in the browser. MusicEngine
 * owns an AudioContext with a lookahead scheduler (25 ms tick, 100 ms schedule
 * ahead), 4 tracks (Focus/Chill/Epic/Sleep) each with its own scale (minor
 * pentatonic / major pentatonic / minor 7+9 / sparse perfect fourths), root
 * note, tempo, waveform and octave range; per note it picks a random scale
 * degree + octave and shapes it with a low-pass filter and an ADSR-style
 * envelope. Reverb uses a ConvolverNode whose impulse response is procedurally
 * generated (exponential-decay white noise — no audio files). Transport:
 * play/pause/stop, live 48-bar frequency visualizer (AnalyserNode → canvas via
 * rAF), volume and mute.
 *
 * Browser-API compatibility:
 *  - Web Audio is created lazily on first play (user gesture); if unavailable
 *    the UI stays inert instead of crashing.
 *  - requestAnimationFrame/canvas are universal; localStorage not required.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Square, Brain, Waves, Zap, MoonStar, Volume2, VolumeX, Music2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// ================================= TRACK DEFS ================================

type TrackId = "focus" | "chill" | "epic" | "sleep";

interface TrackDef {
  id: TrackId;
  name: string;
  desc: string;
  scale: number[];
  rootMidi: number;
  intervalMs: number;
  wave: OscillatorType;
  octaves: number[];
  filterHz: number;
  attack: number;
  noteGain: number;
}

const TRACKS: TrackDef[] = [
  {
    id: "focus", name: "Focus", desc: "A minor pentatonic · pulsing",
    scale: [0, 3, 5, 7, 10], rootMidi: 45, intervalMs: 300, wave: "sine",
    octaves: [0, 12], filterHz: 2200, attack: 0.03, noteGain: 0.17,
  },
  {
    id: "chill", name: "Chill", desc: "C major pentatonic · drifting",
    scale: [0, 2, 4, 7, 9], rootMidi: 48, intervalMs: 480, wave: "triangle",
    octaves: [0, 12, 24], filterHz: 1800, attack: 0.12, noteGain: 0.15,
  },
  {
    id: "epic", name: "Epic", desc: "D minor 7+9 · soaring",
    scale: [0, 3, 7, 10, 14], rootMidi: 38, intervalMs: 560, wave: "sawtooth",
    octaves: [0, 12], filterHz: 1200, attack: 0.05, noteGain: 0.12,
  },
  {
    id: "sleep", name: "Sleep", desc: "G perfect fourths · sparse",
    scale: [0, 5], rootMidi: 43, intervalMs: 1600, wave: "sine",
    octaves: [0, 12], filterHz: 900, attack: 0.5, noteGain: 0.14,
  },
];

const TRACK_ICONS: Record<TrackId, typeof Brain> = {
  focus: Brain,
  chill: Waves,
  epic: Zap,
  sleep: MoonStar,
};

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Procedural impulse response: stereo exponential-decay white noise. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

// ================================= MUSIC ENGINE ==============================

const LOOKAHEAD_S = 0.1;
const TICK_MS = 25;

class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dry: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  private track: TrackDef = TRACKS[0];
  private timer: number | null = null;
  private nextTime = 0;
  private playing = false;
  private volume = 0.6;
  private muted = false;
  private active: Array<{ osc: OscillatorNode; gain: GainNode; endsAt: number }> = [];

  /** Build the graph lazily (first user gesture). */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
      this.dry = this.ctx.createGain();
      this.dry.gain.value = 0.8;
      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = makeImpulse(this.ctx, 2.2, 3.2);
      this.wet = this.ctx.createGain();
      this.wet.gain.value = 0.4;
      this.dry.connect(this.master);
      this.convolver.connect(this.wet);
      this.wet.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setTrack(id: TrackId): void {
    this.track = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
  }

  getTrack(): TrackDef {
    return this.track;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.nextTime = ctx.currentTime + 0.06;
    if (!this.playing) {
      this.playing = true;
      this.timer = window.setInterval(() => this.scheduler(), TICK_MS);
    }
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) void this.ctx.suspend().catch(() => undefined);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.ctx?.currentTime ?? 0;
    this.active.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        osc.stop(now);
        osc.disconnect();
      } catch {
        /* already stopped */
      }
    });
    this.active = [];
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  /** Lookahead scheduler: queue notes until currentTime + LOOKAHEAD_S. */
  private scheduler(): void {
    if (!this.playing || !this.ctx || !this.dry) return;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_S) {
      this.scheduleNote(this.nextTime);
      this.nextTime += (this.track.intervalMs / 1000) * (0.9 + Math.random() * 0.25);
    }
    // prune finished notes
    this.active = this.active.filter((a) => a.endsAt > this.ctx!.currentTime);
  }

  private scheduleNote(time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return;
    const degree = this.track.scale[Math.floor(Math.random() * this.track.scale.length)];
    const octave = this.track.octaves[Math.floor(Math.random() * this.track.octaves.length)];
    const midi = this.track.rootMidi + degree + octave;
    const freq = midiToFreq(midi);

    const osc = ctx.createOscillator();
    osc.type = this.track.wave;
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() * 2 - 1) * 6;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.track.filterHz * (0.7 + Math.random() * 0.6);
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    const peak = this.track.noteGain * (0.7 + Math.random() * 0.5);
    const dur = (this.track.intervalMs / 1000) * (1.6 + Math.random() * 0.9);
    const release = Math.min(dur * 0.6, 1.6);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + this.track.attack);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, time + this.track.attack + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + this.track.attack + dur * 0.35 + release);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.convolver as ConvolverNode);
    osc.start(time);
    osc.stop(time + this.track.attack + dur * 0.35 + release + 0.1);
    this.active.push({ osc, gain, endsAt: time + this.track.attack + dur + release });
  }

  /** Copy the current spectrum into `buf`; false when audio is unavailable. */
  readFreq(buf: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(buf);
    return true;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && !this.muted && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.master = null;
      this.analyser = null;
      this.dry = null;
      this.convolver = null;
      this.wet = null;
    }
  }
}

// ================================== THE APP ==================================

type Transport = "stopped" | "playing" | "paused";

export function MusicApp({ windowId: _windowId }: { windowId?: string }) {
  const [engine] = useState(() => new MusicEngine());
  const [trackId, setTrackId] = useState<TrackId>("focus");
  const [status, setStatus] = useState<Transport>("stopped");
  const [volume, setVolume] = useState(0.6);
  const [muted, setMuted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Teardown on unmount.
  useEffect(() => () => engine.dispose(), [engine]);

  // 48-bar visualizer driven by rAF while playing.
  useEffect(() => {
    if (status !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const buf = new Uint8Array(128);
    let raf = 0;
    const draw = () => {
      engine.readFreq(buf);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      c2d.clearRect(0, 0, w, h);
      const bars = 48;
      const gap = 2;
      const bw = Math.max(1, (w - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i += 1) {
        // superlinear bin mapping keeps the musically active low end spread
        // across most of the bar range instead of crowding the left edge
        const bin = Math.min(127, Math.floor(Math.pow(i / bars, 1.5) * 90));
        const v = buf[bin] / 255;
        const bh = Math.max(2, v * (h - 4));
        c2d.fillStyle = `oklch(0.75 0.18 ${195 + (i / bars) * 105})`;
        c2d.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [status, engine]);

  const handlePlayPause = () => {
    if (status === "playing") {
      engine.pause();
      setStatus("paused");
      return;
    }
    engine.setTrack(trackId);
    engine.play();
    setStatus("playing");
  };

  const handleStop = () => {
    engine.stop();
    setStatus("stopped");
  };

  const selectTrack = (id: TrackId) => {
    setTrackId(id);
    engine.setTrack(id);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engine.setMuted(next);
  };

  const track = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];

  return (
    <div className="flex h-full flex-col gap-2 bg-[--ae-obsidian-deep] p-2.5">
      {/* header */}
      <div className="flex items-center justify-between">
        <span className="eyebrow">Generative Music</span>
        <span className="flex items-center gap-1.5 font-mono-ae text-[10px] text-zinc-500">
          <Music2 className="h-3 w-3" /> lookahead 100 ms · tick 25 ms
        </span>
      </div>

      {/* visualizer */}
      <div className="glass-strong relative flex h-28 shrink-0 items-end overflow-hidden rounded-xl p-2">
        <canvas ref={canvasRef} className="h-full w-full" />
        {status === "stopped" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-zinc-600">press play — every note is synthesized live</span>
          </div>
        )}
        {status === "paused" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="eyebrow rounded-full border border-[--ae-gold]/30 bg-[--ae-gold]/10 px-2 py-0.5 text-[--ae-gold]">paused</span>
          </div>
        )}
      </div>

      {/* track cards */}
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 lg:grid-cols-4">
        {TRACKS.map((t) => {
          const Icon = TRACK_ICONS[t.id];
          const selected = t.id === trackId;
          const active = selected && status === "playing";
          return (
            <motion.button
              key={t.id}
              whileTap={{ scale: 0.96 }}
              onClick={() => selectTrack(t.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-[--ae-amethyst]/40 bg-[--ae-amethyst]/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
              )}
            >
              <span className="flex w-full items-center justify-between">
                <Icon className={cn("h-4 w-4", selected ? "text-[--ae-amethyst]" : "text-zinc-400")} />
                {active && (
                  <span className="flex items-end gap-0.5">
                    {[0, 1, 2].map((b) => (
                      <motion.span
                        key={b}
                        className="w-0.5 rounded-full bg-[--ae-cyan]"
                        animate={{ height: [3, 9 + b * 2, 4, 11 - b * 2, 3] }}
                        transition={{ duration: 1.1 + b * 0.25, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ))}
                  </span>
                )}
              </span>
              <span className={cn("text-xs font-medium", selected ? "text-[--ae-amethyst]" : "text-zinc-200")}>{t.name}</span>
              <span className="text-[9px] leading-tight text-zinc-500">{t.desc}</span>
            </motion.button>
          );
        })}
      </div>

      {/* transport */}
      <div className="flex items-center gap-2 border-t border-white/10 pt-2.5">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handlePlayPause}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs transition-colors",
            status === "playing"
              ? "border-[--ae-gold]/40 bg-[--ae-gold]/15 text-[--ae-gold]"
              : "border-[--ae-cyan]/40 bg-[--ae-cyan]/15 text-[--ae-cyan] text-glow-cyan"
          )}
        >
          {status === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {status === "playing" ? "Pause" : "Play"}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleStop}
          disabled={status === "stopped"}
          aria-label="Stop"
          className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-[--ae-rose] disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5" />
        </motion.button>
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
          <span className="hidden truncate font-mono-ae text-[10px] text-zinc-500 sm:block">
            {track.name} · {track.wave} · {track.intervalMs} ms
          </span>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX className="h-4 w-4 text-[--ae-rose]" /> : <Volume2 className="h-4 w-4 text-[--ae-cyan]" />}
        </motion.button>
        <Slider
          value={[Math.round(volume * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={(vals) => {
            const v = (vals[0] ?? 60) / 100;
            setVolume(v);
            engine.setVolume(v);
          }}
          className="w-28"
        />
      </div>
    </div>
  );
}

export default MusicApp;
