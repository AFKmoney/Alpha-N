/**
 * weather-app.tsx — Alpha-OS Weather (Open-Meteo, no API key).
 *
 * Purpose: city search via the Open-Meteo geocoding API (350 ms debounce, top
 * 6 results), current conditions (temperature, wind speed + 16-point compass
 * direction, WMO weather code → label/emoji/accent), a 6-hour hourly strip and
 * a day/night-aware gradient header. °C/°F toggle switches both
 * temperature_unit and wind_speed_unit params. Last city + unit persist.
 *
 * Browser-API compatibility:
 *  - Uses fetch + AbortController (universal); no keys, no auth.
 *  - localStorage (last place + unit) wrapped in try/catch; offline or API
 *    failure degrades to an error panel with retry.
 */
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle, MapPin, Search, ArrowLeft, Droplets, Wind, Navigation2, Thermometer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ==================================== TYPES ==================================

type Unit = "c" | "f";

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  country_code?: string;
}

interface Place {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

interface Forecast {
  current?: {
    time?: string;
    temperature_2m: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    wind_speed_10m: number[];
  };
}

type Accent = "cyan" | "amethyst" | "gold" | "emerald" | "rose";

interface WmoInfo {
  label: string;
  emoji: string;
  accent: Accent;
}

// ================================ WMO CODE MAP ===============================

const WMO: Record<number, WmoInfo> = {
  0: { label: "Clear sky", emoji: "☀️", accent: "gold" },
  1: { label: "Mainly clear", emoji: "🌤️", accent: "gold" },
  2: { label: "Partly cloudy", emoji: "⛅", accent: "cyan" },
  3: { label: "Overcast", emoji: "☁️", accent: "amethyst" },
  45: { label: "Fog", emoji: "🌫️", accent: "amethyst" },
  48: { label: "Rime fog", emoji: "🌫️", accent: "amethyst" },
  51: { label: "Light drizzle", emoji: "🌦️", accent: "cyan" },
  53: { label: "Drizzle", emoji: "🌦️", accent: "cyan" },
  55: { label: "Dense drizzle", emoji: "🌧️", accent: "cyan" },
  56: { label: "Freezing drizzle", emoji: "🌧️", accent: "emerald" },
  57: { label: "Heavy freezing drizzle", emoji: "🌧️", accent: "emerald" },
  61: { label: "Light rain", emoji: "🌦️", accent: "cyan" },
  63: { label: "Rain", emoji: "🌧️", accent: "cyan" },
  65: { label: "Heavy rain", emoji: "🌧️", accent: "amethyst" },
  66: { label: "Freezing rain", emoji: "🌧️", accent: "emerald" },
  67: { label: "Heavy freezing rain", emoji: "🌧️", accent: "emerald" },
  71: { label: "Light snow", emoji: "🌨️", accent: "emerald" },
  73: { label: "Snow", emoji: "🌨️", accent: "emerald" },
  75: { label: "Heavy snow", emoji: "❄️", accent: "emerald" },
  77: { label: "Snow grains", emoji: "🌨️", accent: "emerald" },
  80: { label: "Light showers", emoji: "🌦️", accent: "cyan" },
  81: { label: "Showers", emoji: "🌧️", accent: "cyan" },
  82: { label: "Violent showers", emoji: "⛈️", accent: "amethyst" },
  85: { label: "Snow showers", emoji: "🌨️", accent: "emerald" },
  86: { label: "Heavy snow showers", emoji: "❄️", accent: "emerald" },
  95: { label: "Thunderstorm", emoji: "⛈️", accent: "rose" },
  96: { label: "Storm with hail", emoji: "⛈️", accent: "rose" },
  99: { label: "Severe thunderstorm", emoji: "⛈️", accent: "rose" },
};

const WMO_FALLBACK: WmoInfo = { label: "Unknown", emoji: "🌡️", accent: "cyan" };

function wmo(code: number, isDay: boolean): WmoInfo {
  const info = WMO[code] ?? WMO_FALLBACK;
  if (code === 0 && !isDay) return { ...info, emoji: "🌙" };
  if (code === 1 && !isDay) return { ...info, emoji: "☁️" };
  return info;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function compass16(deg: number): string {
  return COMPASS[((Math.round(deg / 22.5) % 16) + 16) % 16];
}

const ACCENT_TEXT: Record<Accent, string> = {
  cyan: "text-(--ae-cyan)",
  amethyst: "text-(--ae-amethyst)",
  gold: "text-(--ae-gold)",
  emerald: "text-(--ae-emerald)",
  rose: "text-(--ae-rose)",
};

// ================================= PERSISTENCE ===============================

const PLACE_KEY = "alpha-os:weather:place";
const UNIT_KEY = "alpha-os:weather:unit";

function loadPlace(): Place | null {
  try {
    const raw = window.localStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Place>;
    if (typeof p.latitude !== "number" || typeof p.longitude !== "number" || typeof p.name !== "string") return null;
    return { name: p.name, country: p.country, admin1: p.admin1, latitude: p.latitude, longitude: p.longitude };
  } catch {
    return null;
  }
}

function loadUnit(): Unit {
  try {
    return window.localStorage.getItem(UNIT_KEY) === "f" ? "f" : "c";
  } catch {
    return "c";
  }
}

// ================================== THE APP ==================================

export function WeatherApp({ windowId: _windowId }: { windowId?: string }) {
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("c");
  const [hydrated, setHydrated] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Deferred hydration: last city + unit.
  useEffect(() => {
    Promise.resolve().then(() => {
      setUnit(loadUnit());
      const saved = loadPlace();
      if (saved) setPlace(saved);
      setHydrated(true);
    });
  }, []);

  // Persist place + unit.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (place) window.localStorage.setItem(PLACE_KEY, JSON.stringify(place));
      window.localStorage.setItem(UNIT_KEY, unit);
    } catch {
      /* ignore */
    }
  }, [place, unit, hydrated]);

  // Debounced (350 ms) city geocoding.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGeoResults(null);
      setGeoBusy(false);
      return;
    }
    setGeoBusy(true);
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, {
        signal: controller.signal,
      })
        .then((res) => res.json() as Promise<{ results?: GeoResult[] }>)
        .then((json) => {
          setGeoResults(json.results ?? []);
          setGeoBusy(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setGeoResults([]);
          setGeoBusy(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  // Forecast fetch — re-runs on place or unit change (abortable).
  useEffect(() => {
    if (!place) {
      setForecast(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          latitude: String(place.latitude),
          longitude: String(place.longitude),
          current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m",
          hourly: "temperature_2m,weather_code,wind_speed_10m",
          forecast_days: "2",
          timezone: "auto",
          temperature_unit: unit === "f" ? "fahrenheit" : "celsius",
          wind_speed_unit: unit === "f" ? "mph" : "kmh",
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Forecast;
        if (cancelled) return;
        setForecast(json);
        setBusy(false);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "request failed");
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [place, unit, retryNonce]);

  const pickPlace = (g: GeoResult) => {
    setPlace({ name: g.name, country: g.country, admin1: g.admin1, latitude: g.latitude, longitude: g.longitude });
    setQuery("");
    setGeoResults(null);
  };

  const cur = forecast?.current;
  const isDay = (cur?.is_day ?? 1) === 1;
  const info = cur ? wmo(cur.weather_code, isDay) : null;

  // 6-hour strip starting at the current hour. With timezone=auto the hourly
  // timestamps and current.time share the location's local clock, so a plain
  // ISO string comparison aligns them exactly (no Date parsing ambiguity).
  const hourly = forecast?.hourly;
  const strip: Array<{ hour: string; temp: number; code: number; wind: number }> = [];
  if (hourly && hourly.time && hourly.temperature_2m) {
    const nowIso = cur?.time;
    let start = -1;
    if (nowIso) start = hourly.time.findIndex((t) => t >= nowIso);
    if (start < 0) {
      start = hourly.time.findIndex((t) => {
        try {
          return new Date(`${t}Z`).getTime() >= Date.now() - 30 * 60 * 1000;
        } catch {
          return false;
        }
      });
    }
    if (start < 0) start = 0;
    for (let i = start; i < Math.min(start + 6, hourly.time.length); i += 1) {
      if (hourly.temperature_2m[i] === undefined) break;
      strip.push({
        hour: `${hourly.time[i].slice(11, 13)}:00`,
        temp: hourly.temperature_2m[i],
        code: hourly.weather_code?.[i] ?? 0,
        wind: hourly.wind_speed_10m?.[i] ?? 0,
      });
    }
  }

  const tempStr = (t: number) => `${Math.round(t)}°${unit === "f" ? "F" : "C"}`;
  const windUnit = unit === "f" ? "mph" : "km/h";

  return (
    <div className="scroll-ae flex h-full flex-col gap-2 overflow-y-auto bg-(--ae-obsidian-deep) p-2.5">
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {place && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setPlace(null)}
              aria-label="Back to search"
              className="rounded-full border border-white/10 p-1 text-zinc-400 transition-colors hover:text-(--ae-cyan)"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </motion.button>
          )}
          <span className="eyebrow">Weather · Open-Meteo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("font-mono-ae text-[11px]", unit === "c" ? "text-(--ae-cyan)" : "text-zinc-500")}>°C</span>
          <Switch
            checked={unit === "f"}
            onCheckedChange={(v) => setUnit(v ? "f" : "c")}
            aria-label="Toggle temperature unit"
            className="data-[state=checked]:bg-(--ae-gold)/60 data-[state=unchecked]:bg-(--ae-cyan)/40"
          />
          <span className={cn("font-mono-ae text-[11px]", unit === "f" ? "text-(--ae-gold)" : "text-zinc-500")}>°F</span>
        </div>
      </div>

      {/* search */}
      {!place && (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a city…"
              className="h-9 border-white/10 bg-white/[0.04] pl-8 text-sm"
            />
            {geoBusy && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-(--ae-cyan)" />}
          </div>

          {geoResults !== null && geoResults.length === 0 && query.trim().length >= 2 && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-zinc-500">
              <MapPin className="h-7 w-7 text-zinc-700" />
              <p className="text-xs">No cities found for “{query.trim()}”.</p>
            </div>
          )}
          {geoResults === null && query.trim().length < 2 && (
            <div className="flex flex-col items-center gap-1.5 py-10 text-zinc-500">
              <MapPin className="h-10 w-10 text-zinc-700" />
              <p className="text-xs">Search for a city to see live conditions.</p>
              <p className="text-[10px] text-zinc-600">Powered by Open-Meteo — no API key needed.</p>
            </div>
          )}
          <div className="space-y-1">
            {(geoResults ?? []).map((g) => (
              <motion.button
                key={`${g.id}-${g.latitude}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => pickPlace(g)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-(--ae-cyan)/30 hover:bg-(--ae-cyan)/[0.06]"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-(--ae-cyan)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-200">{g.name}</span>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {[g.admin1, g.country].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {g.country_code && <span className="font-mono-ae text-[10px] text-zinc-600">{g.country_code}</span>}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* current conditions */}
      {place && (
        <AnimatePresence mode="wait" initial={false}>
          {busy && (
            <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-(--ae-cyan)" />
            </motion.div>
          )}
          {!busy && error && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-(--ae-rose)" />
              <p className="text-xs text-zinc-400">Could not load the forecast — {error}.</p>
              <button
                onClick={() => setRetryNonce((n) => n + 1)}
                className="rounded-full border border-(--ae-cyan)/30 bg-(--ae-cyan)/10 px-3 py-1 text-[11px] text-(--ae-cyan) transition-colors hover:bg-(--ae-cyan)/20"
              >
                Retry
              </button>
            </motion.div>
          )}
          {!busy && !error && cur && info && (
            <motion.div key={`${place.name}-${unit}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
              {/* day/night gradient header */}
              <div
                className="rounded-xl border border-white/10 p-4"
                style={{
                  background: isDay
                    ? "linear-gradient(135deg, oklch(0.82 0.17 195 / 0.16), transparent 65%)"
                    : "linear-gradient(135deg, oklch(0.74 0.22 300 / 0.18), transparent 65%)",
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                      <MapPin className="h-3.5 w-3.5 text-(--ae-cyan)" /> {place.name}
                      {place.country ? <span className="text-xs text-zinc-500">{place.country}</span> : null}
                    </div>
                    <div className="mt-1 font-mono-ae text-5xl font-semibold text-zinc-50 text-glow-cyan">
                      {tempStr(cur.temperature_2m)}
                    </div>
                    <div className={cn("mt-1 text-xs", ACCENT_TEXT[info.accent])}>{info.label}</div>
                  </div>
                  <motion.span
                    animate={{ y: isDay ? [0, -3, 0] : [0, 2, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="text-4xl"
                  >
                    {info.emoji}
                  </motion.span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="font-mono-ae text-[11px] text-zinc-300">
                      feels {cur.apparent_temperature !== undefined ? tempStr(cur.apparent_temperature) : "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Droplets className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="font-mono-ae text-[11px] text-zinc-300">
                      {cur.relative_humidity_2m !== undefined ? `${Math.round(cur.relative_humidity_2m)}% rh` : "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="relative flex items-center">
                      <Navigation2
                        className="h-3.5 w-3.5 text-(--ae-cyan)"
                        style={{ transform: `rotate(${(cur.wind_direction_10m ?? 0) + 180}deg)` }}
                      />
                    </span>
                    <span className="font-mono-ae text-[11px] text-zinc-300">
                      {Math.round(cur.wind_speed_10m)} {windUnit} {compass16(cur.wind_direction_10m ?? 0)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500">
                  <Wind className="h-3 w-3" /> wind from {compass16(cur.wind_direction_10m ?? 0)} · {isDay ? "daytime" : "night"} mode
                </div>
              </div>

              {/* 6-hour strip */}
              <div>
                <span className="eyebrow mb-1.5 block">Next 6 hours</span>
                {strip.length === 0 ? (
                  <p className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-500">Hourly data unavailable.</p>
                ) : (
                  <div className="grid grid-cols-6 gap-1.5">
                    {strip.map((h) => {
                      const hi = wmo(h.code, true);
                      return (
                        <div key={h.hour} className="glass flex flex-col items-center gap-0.5 rounded-lg px-1 py-2">
                          <span className="font-mono-ae text-[9px] text-zinc-500">{h.hour}</span>
                          <span className="text-lg leading-none">{hi.emoji}</span>
                          <span className="font-mono-ae text-[11px] font-medium text-zinc-200">{tempStr(h.temp)}</span>
                          <span className="font-mono-ae text-[8px] text-zinc-600">
                            {Math.round(h.wind)} {windUnit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

export default WeatherApp;
