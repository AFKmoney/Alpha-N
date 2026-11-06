/**
 * clock-app.tsx — Alpha-OS World Clock.
 *
 * Purpose: a 200px central analog clock whose second hand moves smoothly via
 * requestAnimationFrame (millisecond-aware angle), plus 9 predefined cities
 * (New York, London, Tokyo, Sydney, Dubai, Berlin, Mumbai, São Paulo,
 * Vancouver). Each city card shows a 64px mini analog clock, digital time,
 * sun/moon indicator (06:00–18:00 → sun) and the UTC offset derived from
 * Intl.DateTimeFormat with IANA timezones (DST-aware). Selection persists.
 *
 * Browser-API compatibility:
 *  - Intl.DateTimeFormat with timeZone + "shortOffset" — supported everywhere
 *    modern; offset falls back to "UTC" in the unlikely failure case.
 *  - localStorage (visible-city selection) wrapped in try/catch.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Sun, Moon, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ==================================== CITIES =================================

type City = { id: string; name: string; tz: string };

const CITIES: City[] = [
  { id: "new-york", name: "New York", tz: "America/New_York" },
  { id: "london", name: "London", tz: "Europe/London" },
  { id: "tokyo", name: "Tokyo", tz: "Asia/Tokyo" },
  { id: "sydney", name: "Sydney", tz: "Australia/Sydney" },
  { id: "dubai", name: "Dubai", tz: "Asia/Dubai" },
  { id: "berlin", name: "Berlin", tz: "Europe/Berlin" },
  { id: "mumbai", name: "Mumbai", tz: "Asia/Kolkata" },
  { id: "sao-paulo", name: "São Paulo", tz: "America/Sao_Paulo" },
  { id: "vancouver", name: "Vancouver", tz: "America/Vancouver" },
];

// Immutable per-city formatters created once at module scope (never mutated).
const TIME_FMT: Record<string, Intl.DateTimeFormat> = {};
const HOUR_FMT: Record<string, Intl.DateTimeFormat> = {};
const DATE_FMT: Record<string, Intl.DateTimeFormat> = {};
const OFFSET_FMT: Record<string, Intl.DateTimeFormat> = {};
for (const c of CITIES) {
  TIME_FMT[c.tz] = new Intl.DateTimeFormat("en-GB", {
    timeZone: c.tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  HOUR_FMT[c.tz] = new Intl.DateTimeFormat("en-GB", { timeZone: c.tz, hour: "numeric", hour12: false });
  DATE_FMT[c.tz] = new Intl.DateTimeFormat("en-US", {
    timeZone: c.tz, weekday: "short", month: "short", day: "numeric",
  });
  OFFSET_FMT[c.tz] = new Intl.DateTimeFormat("en-US", { timeZone: c.tz, timeZoneName: "shortOffset" });
}
const LOCAL_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const LOCAL_OFFSET_FMT = new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" });
const LOCAL_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

/** Extract H/M/S in a timezone; returns null if Intl ever fails. */
function cityParts(tz: string, date: Date): { h: number; m: number; s: number } | null {
  try {
    const parts = TIME_FMT[tz].formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "-1");
    const h = get("hour");
    const m = get("minute");
    const s = get("second");
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s) || h < 0) return null;
    return { h: h % 24, m, s };
  } catch {
    return null;
  }
}

/** "GMT+5:30"-style UTC offset for a timezone (DST-aware). */
function utcOffset(tz: string | undefined, date: Date): string {
  try {
    const fmt = tz ? OFFSET_FMT[tz] : LOCAL_OFFSET_FMT;
    const parts = fmt.formatToParts(date);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ?? "UTC";
  } catch {
    return "UTC";
  }
}

// ============================== MINI ANALOG CLOCK ============================

function MiniClock({ h, m, s }: { h: number; m: number; s: number }) {
  const secAngle = s * 6;
  const minAngle = m * 6 + s * 0.1;
  const hourAngle = (h % 12) * 30 + m * 0.5;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16">
      <circle cx="32" cy="32" r="29" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      <line x1="32" y1="32" x2="32" y2="19" stroke="rgb(212,212,216)" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${hourAngle} 32 32)`} />
      <line x1="32" y1="32" x2="32" y2="13" stroke="rgb(228,228,231)" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${minAngle} 32 32)`} />
      <line x1="32" y1="35" x2="32" y2="11" stroke="var(--ae-cyan)" strokeWidth="1" strokeLinecap="round" transform={`rotate(${secAngle} 32 32)`} />
      <circle cx="32" cy="32" r="1.8" fill="var(--ae-gold)" />
    </svg>
  );
}

// ================================= CITY CARD =================================

function CityCard({ city, date }: { city: City; date: Date }) {
  const parts = cityParts(city.tz, date);
  const digital = TIME_FMT[city.tz].format(date);
  const hourRaw = (() => {
    try {
      return Number(HOUR_FMT[city.tz].format(date)) % 24;
    } catch {
      return 12;
    }
  })();
  const isDay = hourRaw >= 6 && hourRaw < 18;
  const offset = utcOffset(city.tz, date);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.18 }}
      className="glass flex items-center gap-3 rounded-xl px-3 py-2.5"
    >
      {parts ? <MiniClock h={parts.h} m={parts.m} s={parts.s} /> : <MiniClock h={0} m={0} s={0} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-medium text-zinc-200">{city.name}</span>
          {isDay ? (
            <Sun className="h-3.5 w-3.5 shrink-0 text-(--ae-gold)" />
          ) : (
            <Moon className="h-3.5 w-3.5 shrink-0 text-(--ae-amethyst)" />
          )}
        </div>
        <div className="font-mono-ae text-lg font-semibold leading-tight text-(--ae-cyan) text-glow-cyan">{digital}</div>
        <div className="flex items-center justify-between font-mono-ae text-[9px] text-zinc-500">
          <span>{DATE_FMT[city.tz].format(date)}</span>
          <span>{offset}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ================================== THE APP ==================================

const CITIES_KEY = "alpha-os:clock:cities";

export function ClockApp({ windowId: _windowId }: { windowId?: string }) {
  const [now, setNow] = useState(0);
  const [visible, setVisible] = useState<string[]>(CITIES.map((c) => c.id));

  // Smooth central-clock hands: refs mutated inside rAF only (never render).
  const hourHandRef = useRef<SVGLineElement | null>(null);
  const minHandRef = useRef<SVGLineElement | null>(null);
  const secHandRef = useRef<SVGLineElement | null>(null);
  const lastSecRef = useRef(-1);

  // Deferred selection hydration.
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = window.localStorage.getItem(CITIES_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const ids = parsed.filter((v): v is string => typeof v === "string");
        const valid = ids.filter((id) => CITIES.some((c) => c.id === id));
        setVisible(valid.length > 0 ? valid : CITIES.map((c) => c.id));
      } catch {
        /* keep defaults */
      }
    });
  }, []);

  // Persist selection.
  useEffect(() => {
    try {
      window.localStorage.setItem(CITIES_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  // rAF loop: hands every frame, city cards re-render once per second.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const d = new Date();
      const sFloat = d.getSeconds() + d.getMilliseconds() / 1000;
      const mFloat = d.getMinutes() + sFloat / 60;
      const hFloat = (d.getHours() % 12) + mFloat / 60;
      if (secHandRef.current) secHandRef.current.setAttribute("transform", `rotate(${sFloat * 6} 100 100)`);
      if (minHandRef.current) minHandRef.current.setAttribute("transform", `rotate(${mFloat * 6} 100 100)`);
      if (hourHandRef.current) hourHandRef.current.setAttribute("transform", `rotate(${hFloat * 30} 100 100)`);
      const wholeSec = d.getSeconds();
      if (wholeSec !== lastSecRef.current) {
        lastSecRef.current = wholeSec;
        setNow(d.getTime());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleCity = (id: string) => {
    setVisible((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((v) => v !== id);
        return next.length > 0 ? next : prev; // never hide all
      }
      return [...prev, id];
    });
  };

  const date = now > 0 ? new Date(now) : null;
  const shownCities = CITIES.filter((c) => visible.includes(c.id));
  const dayFrac = date ? (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400 : 0;
  const localIsDay = date ? date.getHours() >= 6 && date.getHours() < 18 : false;

  return (
    <div className="scroll-ae flex h-full flex-col gap-2 overflow-y-auto bg-(--ae-obsidian-deep) p-2.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">World Clock</span>
        <span className="flex items-center gap-1.5 font-mono-ae text-[10px] text-zinc-500">
          <Globe2 className="h-3 w-3" /> {date ? LOCAL_TIME_FMT.format(date) : "--:--:--"} · {date ? utcOffset(undefined, date) : "UTC"}
        </span>
      </div>

      {/* central clock */}
      <div className="flex items-center justify-center py-1">
        <div className="relative">
          <svg viewBox="0 0 200 200" className="h-[200px] w-[200px]">
            <circle cx="100" cy="100" r="95" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            {Array.from({ length: 12 }, (_, i) => {
              const angle = i * 30;
              const major = i % 3 === 0;
              return (
                <line
                  key={i}
                  x1="100"
                  y1={major ? 12 : 14}
                  x2="100"
                  y2={major ? 22 : 19}
                  stroke={major ? "var(--ae-cyan)" : "rgba(255,255,255,0.25)"}
                  strokeWidth={major ? 2 : 1}
                  strokeLinecap="round"
                  transform={`rotate(${angle} 100 100)`}
                />
              );
            })}
            <line ref={hourHandRef} x1="100" y1="100" x2="100" y2="55" stroke="rgb(212,212,216)" strokeWidth="5" strokeLinecap="round" />
            <line ref={minHandRef} x1="100" y1="100" x2="100" y2="34" stroke="rgb(228,228,231)" strokeWidth="3" strokeLinecap="round" />
            <line ref={secHandRef} x1="100" y1="106" x2="100" y2="24" stroke="var(--ae-cyan)" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="100" cy="100" r="4" fill="var(--ae-gold)" />
            <circle cx="100" cy="100" r="1.5" fill="oklch(0.13 0.02 280)" />
          </svg>
          <span className="neural-dot absolute right-3 top-6" />
        </div>
      </div>
      <p className="-mt-1 text-center font-mono-ae text-[10px] text-zinc-600">
        smooth sweep · rAF-driven second hand
      </p>

      {/* local date + day progress */}
      <div className="glass mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl px-3.5 py-2">
        <div className="min-w-0">
          <span className="eyebrow">Local date</span>
          <p className="truncate text-xs text-zinc-300">{date ? LOCAL_DATE_FMT.format(date) : "—"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {localIsDay ? (
            <Sun className="h-4 w-4 text-(--ae-gold)" />
          ) : (
            <Moon className="h-4 w-4 text-(--ae-amethyst)" />
          )}
          <div className="w-24">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full rounded-full bg-(--ae-cyan)"
                initial={false}
                animate={{ width: `${dayFrac * 100}%` }}
                transition={{ type: "spring", stiffness: 60, damping: 20 }}
              />
            </div>
            <p className="mt-0.5 text-right font-mono-ae text-[9px] text-zinc-600">
              {(dayFrac * 100).toFixed(1)}% of day
            </p>
          </div>
        </div>
      </div>

      {/* city toggles */}
      <div className="flex flex-wrap justify-center gap-1.5">
        {CITIES.map((c) => {
          const on = visible.includes(c.id);
          return (
            <motion.button
              key={c.id}
              whileTap={{ scale: 0.93 }}
              onClick={() => toggleCity(c.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] transition-colors",
                on
                  ? "border-(--ae-amethyst)/40 bg-(--ae-amethyst)/10 text-(--ae-amethyst)"
                  : "border-white/10 text-zinc-500 hover:text-zinc-300"
              )}
            >
              {c.name}
            </motion.button>
          );
        })}
      </div>

      {/* city cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shownCities.map((c) => (
          <CityCard key={c.id} city={c} date={date ?? new Date(0)} />
        ))}
      </div>

      <p className="mt-auto text-center font-mono-ae text-[9px] text-zinc-600">
        offsets resolved via Intl IANA timezones · DST handled automatically · selection saved locally
      </p>
    </div>
  );
}

export default ClockApp;
