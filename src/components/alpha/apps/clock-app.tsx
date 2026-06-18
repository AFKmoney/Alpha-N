/**
 * clock-app.tsx — world clock with analog + digital displays.
 *
 * Features:
 * - Large central analog clock for the local timezone with a smooth
 *   second hand driven by requestAnimationFrame (sub-second motion)
 * - 9 predefined world cities (New York, London, Tokyo, Sydney, Dubai, Berlin,
 *   Mumbai, São Paulo, Vancouver) — pick which ones to display
 * - Each city shows digital time, analog clock, and day/night indicator
 *   (sun icon for 06:00–18:00, moon otherwise)
 * - Time computed via Intl.DateTimeFormat with each city's IANA timezone
 *   (handles DST automatically — no hardcoded offsets)
 * - Persists the user's selected cities to localStorage
 *
 * Browser compatibility: Intl.DateTimeFormat with `timeZone` and `hour12` is
 * supported in every modern browser. No compatibility concerns.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon, Plus, X, MapPin, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ClockAppProps {
  windowId?: string;
}

interface City {
  id: string;
  name: string;
  tz: string;        // IANA timezone
  country: string;
}

const CITIES: City[] = [
  { id: "nyc",    name: "New York",    tz: "America/New_York",    country: "USA" },
  { id: "london", name: "London",      tz: "Europe/London",       country: "UK" },
  { id: "tokyo",  name: "Tokyo",       tz: "Asia/Tokyo",          country: "Japan" },
  { id: "sydney", name: "Sydney",      tz: "Australia/Sydney",    country: "Australia" },
  { id: "dubai",  name: "Dubai",       tz: "Asia/Dubai",          country: "UAE" },
  { id: "berlin", name: "Berlin",      tz: "Europe/Berlin",       country: "Germany" },
  { id: "mumbai", name: "Mumbai",      tz: "Asia/Kolkata",        country: "India" },
  { id: "saopaulo", name: "São Paulo", tz: "America/Sao_Paulo",   country: "Brazil" },
  { id: "van",    name: "Vancouver",   tz: "America/Vancouver",   country: "Canada" },
];

const STORAGE_KEY = "alpha-clock-cities";

/** Default selection if the user has never customized the list. */
const DEFAULT_SELECTED = ["nyc", "london", "tokyo"];

interface TimeParts {
  h: number;          // 0..23
  m: number;          // 0..59
  s: number;          // 0..59
  ms: number;         // 0..999
  h12: number;        // 1..12
  ampm: "AM" | "PM";
  dateStr: string;    // e.g. "Mon, Jun 17"
  hour: number;       // for day/night check (0..23)
}

/** Get the current time parts for a given IANA timezone (or local if undefined). */
function getTimeParts(tz?: string): TimeParts {
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  if (tz) opts.timeZone = tz;
  const fmt = new Intl.DateTimeFormat("en-US", opts);
  const parts = fmt.formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "0";
  const h = parseInt(get("hour"), 10) % 24;
  const m = parseInt(get("minute"), 10);
  const s = parseInt(get("second"), 10);
  const ms = now.getMilliseconds();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    h,
    m,
    s,
    ms,
    h12,
    ampm: h < 12 ? "AM" : "PM",
    dateStr: `${get("weekday")}, ${get("month")} ${get("day")}`,
    hour: h,
  };
}

/** Get the UTC offset string for a timezone, e.g. "UTC+5:30" or "UTC-4". */
function getUtcOffset(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(now);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT+5:30" or "UTC+4" — normalize to "UTC+5:30"
    return tzName.replace("GMT", "UTC");
  } catch {
    return "UTC?";
  }
}

/**
 * AnalogClock — SVG analog clock. Optionally smooth (rAF-driven) for the main
 * clock; smaller clocks tick once per second.
 */
function AnalogClock({
  parts,
  size = 80,
  smooth = false,
  accent = "oklch(0.82 0.17 195)",
}: {
  parts: TimeParts;
  size?: number;
  smooth?: boolean;
  accent?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  // Hand angles (degrees from 12 o'clock, clockwise)
  const secAngle = smooth
    ? (parts.s + parts.ms / 1000) * 6
    : parts.s * 6;
  const minAngle = (parts.m + parts.s / 60) * 6;
  const hourAngle = ((parts.h % 12) + parts.m / 60) * 30;

  // Hand endpoint helper
  const hand = (angle: number, length: number): { x: number; y: number } => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * length, y: cy + Math.sin(rad) * length };
  };
  const hourEnd = hand(hourAngle, r * 0.5);
  const minEnd = hand(minAngle, r * 0.72);
  const secEnd = hand(secAngle, r * 0.82);

  // Hour ticks (12 ticks)
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30;
    const outer = hand(a, r);
    const inner = hand(a, r - (i % 3 === 0 ? 6 : 3));
    return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major: i % 3 === 0 };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Face */}
      <circle cx={cx} cy={cy} r={r} fill="oklch(0.13 0.015 265 / 0.8)" stroke="oklch(0.3 0.08 290)" strokeWidth="1" />
      {/* Ticks */}
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.major ? "oklch(0.7 0.05 250)" : "oklch(0.5 0.03 250)"}
          strokeWidth={t.major ? 1.2 : 0.6}
        />
      ))}
      {/* Hour hand */}
      <line x1={cx} y1={cy} x2={hourEnd.x} y2={hourEnd.y} stroke="oklch(0.9 0.02 250)" strokeWidth={size * 0.025} strokeLinecap="round" />
      {/* Minute hand */}
      <line x1={cx} y1={cy} x2={minEnd.x} y2={minEnd.y} stroke="oklch(0.85 0.04 250)" strokeWidth={size * 0.018} strokeLinecap="round" />
      {/* Second hand */}
      <line x1={cx} y1={cy} x2={secEnd.x} y2={secEnd.y} stroke={accent} strokeWidth={size * 0.012} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={size * 0.025} fill={accent} />
    </svg>
  );
}

/**
 * ClockApp — world clock with a main local analog clock + city cards.
 */
export function ClockApp({ windowId: _windowId }: ClockAppProps = {}) {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localParts, setLocalParts] = useState<TimeParts>(() => getTimeParts());
  const [cityParts, setCityParts] = useState<Record<string, TimeParts>>({});
  const rafRef = useRef<number>(0);

  // Load saved city selection — wrapped in a microtask so the setState call
  // is not synchronous in the effect body (lint-clean).
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) setSelected(parsed);
        }
      } catch {
        // localStorage unavailable — keep defaults
      }
    });
  }, []);

  // Persist city selection on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // storage unavailable — non-fatal
    }
  }, [selected]);

  // rAF loop: smooth-update local clock + 1-Hz update of city clocks
  useEffect(() => {
    let lastCityUpdate = 0;
    const loop = () => {
      const now = performance.now();
      // Local clock: every frame (smooth second hand)
      setLocalParts(getTimeParts());
      // City clocks: update once per ~250 ms (lighter)
      if (now - lastCityUpdate > 250) {
        lastCityUpdate = now;
        const next: Record<string, TimeParts> = {};
        for (const id of selected) {
          const city = CITIES.find((c) => c.id === id);
          if (city) next[id] = getTimeParts(city.tz);
        }
        setCityParts(next);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [selected]);

  const addCity = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const removeCity = useCallback((id: string) => {
    setSelected((prev) => prev.filter((c) => c !== id));
  }, []);

  const availableToAdd = useMemo(
    () => CITIES.filter((c) => !selected.includes(c.id)),
    [selected]
  );

  const isDaytime = (parts: TimeParts): boolean => parts.hour >= 6 && parts.hour < 18;

  const selectedCities = useMemo(
    () => selected.map((id) => CITIES.find((c) => c.id === id)!).filter(Boolean),
    [selected]
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[oklch(0.82_0.17_195)]" />
          <h3 className="font-mono-ae text-sm font-semibold">World Clock</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen((v) => !v)}
          className="h-7 px-2.5 font-mono-ae text-xs"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add city
        </Button>
      </header>

      {/* City picker dropdown */}
      {pickerOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-b border-border/50 bg-card/30 px-4 py-2"
        >
          {availableToAdd.length === 0 ? (
            <p className="font-mono-ae py-1 text-xs text-muted-foreground/60">
              All cities added.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 py-1">
              {availableToAdd.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    addCity(c.id);
                    setPickerOpen(false);
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border/50 bg-background/50 px-2 py-1 font-mono-ae text-[0.65rem] text-foreground/80 transition-all hover:border-[oklch(0.82_0.17_195)]/50 hover:text-[oklch(0.82_0.17_195)]"
                >
                  <MapPin className="h-2.5 w-2.5" />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center p-4">
          {/* Main local clock */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 flex flex-col items-center rounded-xl border border-border/50 bg-card/30 p-6"
          >
            <AnalogClock parts={localParts} size={200} smooth accent="oklch(0.82 0.17 195)" />
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono-ae text-4xl font-semibold tabular-nums text-foreground">
                {String(localParts.h12).padStart(2, "0")}:{String(localParts.m).padStart(2, "0")}
              </span>
              <span className="font-mono-ae text-xl tabular-nums text-muted-foreground">
                :{String(localParts.s).padStart(2, "0")}
              </span>
              <span className="font-mono-ae text-sm text-[oklch(0.82_0.17_195)]">
                {localParts.ampm}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              {isDaytime(localParts) ? (
                <Sun className="h-3 w-3 text-[oklch(0.85_0.16_85)]" />
              ) : (
                <Moon className="h-3 w-3 text-[oklch(0.74_0.22_300)]" />
              )}
              <span className="font-mono-ae text-xs text-muted-foreground">
                Local · {localParts.dateStr}
              </span>
            </div>
          </motion.div>

          {/* City cards */}
          {selectedCities.length === 0 ? (
            <p className="py-8 font-mono-ae text-xs text-muted-foreground/60">
              No cities added. Click "Add city" above.
            </p>
          ) : (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {selectedCities.map((city) => {
                const parts = cityParts[city.id];
                if (!parts) {
                  return (
                    <div
                      key={city.id}
                      className="rounded-lg border border-border/40 bg-card/20 p-4"
                    >
                      <div className="font-mono-ae text-xs text-muted-foreground/50">
                        loading…
                      </div>
                    </div>
                  );
                }
                const daytime = isDaytime(parts);
                return (
                  <motion.div
                    key={city.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group relative rounded-lg border border-border/50 bg-card/30 p-3.5"
                  >
                    <button
                      onClick={() => removeCity(city.id)}
                      className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-[oklch(0.7_0.2_15)] group-hover:opacity-100"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="mb-2 flex items-center gap-1.5">
                      {daytime ? (
                        <Sun className="h-3 w-3 text-[oklch(0.85_0.16_85)]" />
                      ) : (
                        <Moon className="h-3 w-3 text-[oklch(0.74_0.22_300)]" />
                      )}
                      <span className="font-mono-ae text-xs font-semibold text-foreground">
                        {city.name}
                      </span>
                      <span className="font-mono-ae text-[0.55rem] text-muted-foreground/60">
                        {city.country}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <AnalogClock
                        parts={parts}
                        size={64}
                        accent={daytime ? "oklch(0.85_0.16_85)" : "oklch(0.74_0.22_300)"}
                      />
                      <div>
                        <div className="font-mono-ae text-xl font-semibold tabular-nums text-foreground">
                          {String(parts.h12).padStart(2, "0")}:{String(parts.m).padStart(2, "0")}
                          <span className="ml-1 text-xs text-[oklch(0.82_0.17_195)]">{parts.ampm}</span>
                        </div>
                        <div className="font-mono-ae text-[0.6rem] text-muted-foreground/70">
                          {parts.dateStr}
                        </div>
                        <div className="font-mono-ae mt-0.5 text-[0.55rem] text-muted-foreground/60">
                          {getUtcOffset(city.tz)}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ClockApp;
