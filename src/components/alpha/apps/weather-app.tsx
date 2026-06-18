/**
 * weather-app.tsx — current-conditions + 6-hour forecast using the free
 * Open-Meteo API (no API key required).
 *
 * Features:
 * - City search via the Open-Meteo Geocoding API
 *   (`https://geocoding-api.open-meteo.com/v1/search?name=...`)
 * - Current temperature, apparent temperature, wind speed + direction
 * - 6-hour hourly forecast (temperature + weather code)
 * - WMO weather-code → text + emoji mapping
 * - Temperature-unit toggle (°C / °F) — switches both `temperature_unit`
 *   and `wind_speed_unit` query params
 * - Persists the last-searched city + unit preference to localStorage
 * - Loading + error + empty states
 *
 * Browser compatibility: standard fetch + JSON. CORS is permitted by the
 * Open-Meteo API for any origin. No compatibility concerns.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, X, MapPin, Wind, Thermometer, Droplets, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface WeatherAppProps {
  windowId?: string;
}

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone: string;
}

interface CurrentWeather {
  temperature: number;
  windspeed: number;
  winddirection: number;
  weathercode: number;
  is_day: number;
  time: string;
}

interface HourlyForecast {
  time: string[];
  temperature_2m: number[];
  weathercode: number[];
  windspeed_10m: number[];
}

interface WeatherData {
  current: CurrentWeather;
  hourly: HourlyForecast;
  units: {
    temp: string;
    wind: string;
  };
}

/** WMO weather code → { label, emoji, accent } */
const WMO_CODES: Record<number, { label: string; emoji: string; accent: string }> = {
  0:  { label: "Clear sky",         emoji: "☀️", accent: "oklch(0.85 0.16 85)" },
  1:  { label: "Mainly clear",      emoji: "🌤", accent: "oklch(0.85 0.16 85)" },
  2:  { label: "Partly cloudy",     emoji: "⛅", accent: "oklch(0.7 0.05 250)" },
  3:  { label: "Overcast",          emoji: "☁️", accent: "oklch(0.62 0.03 250)" },
  45: { label: "Fog",               emoji: "🌫", accent: "oklch(0.6 0.03 250)" },
  48: { label: "Rime fog",          emoji: "🌫", accent: "oklch(0.6 0.03 250)" },
  51: { label: "Light drizzle",     emoji: "🌦", accent: "oklch(0.7 0.18 195)" },
  53: { label: "Moderate drizzle",  emoji: "🌦", accent: "oklch(0.7 0.18 195)" },
  55: { label: "Dense drizzle",     emoji: "🌦", accent: "oklch(0.7 0.18 195)" },
  56: { label: "Light freezing drizzle", emoji: "🌧", accent: "oklch(0.7 0.2 195)" },
  57: { label: "Dense freezing drizzle", emoji: "🌧", accent: "oklch(0.7 0.2 195)" },
  61: { label: "Slight rain",       emoji: "🌧", accent: "oklch(0.7 0.18 195)" },
  63: { label: "Moderate rain",     emoji: "🌧", accent: "oklch(0.7 0.18 195)" },
  65: { label: "Heavy rain",        emoji: "🌧", accent: "oklch(0.7 0.2 195)" },
  66: { label: "Light freezing rain", emoji: "🌧", accent: "oklch(0.7 0.2 195)" },
  67: { label: "Heavy freezing rain", emoji: "🌧", accent: "oklch(0.7 0.2 195)" },
  71: { label: "Slight snow",       emoji: "🌨", accent: "oklch(0.7 0.05 250)" },
  73: { label: "Moderate snow",     emoji: "🌨", accent: "oklch(0.7 0.05 250)" },
  75: { label: "Heavy snow",        emoji: "❄️", accent: "oklch(0.7 0.05 250)" },
  77: { label: "Snow grains",       emoji: "🌨", accent: "oklch(0.7 0.05 250)" },
  80: { label: "Slight rain showers", emoji: "🌦", accent: "oklch(0.7 0.18 195)" },
  81: { label: "Moderate rain showers", emoji: "🌧", accent: "oklch(0.7 0.18 195)" },
  82: { label: "Violent rain showers", emoji: "⛈", accent: "oklch(0.7 0.2 15)" },
  85: { label: "Slight snow showers", emoji: "🌨", accent: "oklch(0.7 0.05 250)" },
  86: { label: "Heavy snow showers", emoji: "❄️", accent: "oklch(0.7 0.05 250)" },
  95: { label: "Thunderstorm",      emoji: "⛈", accent: "oklch(0.7 0.2 15)" },
  96: { label: "Thunderstorm + slight hail", emoji: "⛈", accent: "oklch(0.7 0.2 15)" },
  99: { label: "Thunderstorm + heavy hail", emoji: "⛈", accent: "oklch(0.7 0.2 15)" },
};

/** Convert a wind direction in degrees to a 16-point compass label. */
function windDirectionLabel(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

const LAST_CITY_KEY = "alpha-weather-last-city";
const UNIT_KEY = "alpha-weather-unit";
type Unit = "celsius" | "fahrenheit";

/**
 * WeatherApp — current weather + 6-hour forecast for any searchable city.
 */
export function WeatherApp({ windowId: _windowId }: WeatherAppProps = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeCity, setActiveCity] = useState<GeoResult | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("celsius");

  // Load saved preferences
  useEffect(() => {
    try {
      const savedUnit = localStorage.getItem(UNIT_KEY) as Unit | null;
      if (savedUnit === "celsius" || savedUnit === "fahrenheit") setUnit(savedUnit);
      const savedCity = localStorage.getItem(LAST_CITY_KEY);
      if (savedCity) {
        const parsed = JSON.parse(savedCity) as GeoResult;
        if (parsed && typeof parsed.latitude === "number") {
          setActiveCity(parsed);
        }
      }
    } catch {
      // localStorage unavailable — start with empty state
    }
  }, []);

  // Persist unit
  useEffect(() => {
    try { localStorage.setItem(UNIT_KEY, unit); } catch { /* ignore */ }
  }, [unit]);

  // Persist active city
  useEffect(() => {
    if (activeCity) {
      try { localStorage.setItem(LAST_CITY_KEY, JSON.stringify(activeCity)); } catch { /* ignore */ }
    }
  }, [activeCity]);

  // Search the geocoding API as the user types (debounced 350 ms)
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          query.trim()
        )}&count=6&language=en&format=json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
        const data = await res.json() as { results?: GeoResult[] };
        setResults(data.results ?? []);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  /** Fetch weather for a chosen geo result. */
  const fetchWeather = useCallback(async (city: GeoResult, currentUnit: Unit) => {
    setLoading(true);
    setError(null);
    try {
      const tempUnit = currentUnit === "fahrenheit" ? "fahrenheit" : "celsius";
      const windUnit = currentUnit === "fahrenheit" ? "mph" : "kmh";
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}` +
        `&current_weather=true` +
        `&hourly=temperature_2m,weathercode,windspeed_10m` +
        `&forecast_hours=6` +
        `&temperature_unit=${tempUnit}` +
        `&wind_speed_unit=${windUnit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Forecast failed (${res.status})`);
      const data = await res.json() as {
        current_weather: CurrentWeather;
        hourly: HourlyForecast;
      };
      if (!data.current_weather) throw new Error("No current-weather data in response");
      setWeather({
        current: data.current_weather,
        hourly: data.hourly,
        units: {
          temp: tempUnit === "fahrenheit" ? "°F" : "°C",
          wind: windUnit === "mph" ? "mph" : "km/h",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load weather";
      setError(msg);
      setWeather(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch weather when active city or unit changes
  useEffect(() => {
    if (activeCity) void fetchWeather(activeCity, unit);
  }, [activeCity, unit, fetchWeather]);

  /** Select a city from the search dropdown. */
  const selectCity = useCallback((city: GeoResult) => {
    setActiveCity(city);
    setShowResults(false);
    setQuery("");
    setResults([]);
  }, []);

  /** Toggle °C ↔ °F. */
  const toggleUnit = useCallback(() => {
    setUnit((u) => (u === "celsius" ? "fahrenheit" : "celsius"));
  }, []);

  /** Refresh the current weather. */
  const refresh = useCallback(() => {
    if (activeCity) void fetchWeather(activeCity, unit);
  }, [activeCity, unit, fetchWeather]);

  const wmo = weather ? WMO_CODES[weather.current.weathercode] : null;
  const isDay = weather ? weather.current.is_day === 1 : true;

  // Compute the index of the "current" hour in the hourly array so we slice
  // from now forward (the API returns hours starting from midnight today).
  const forecastHours = useMemo(() => {
    if (!weather) return [];
    const now = Date.now();
    const indices: number[] = [];
    weather.hourly.time.forEach((t, i) => {
      if (new Date(t).getTime() >= now - 60 * 60 * 1000 && indices.length < 6) {
        indices.push(i);
      }
    });
    // Fallback: first 6 entries if no match (e.g. clock skew)
    if (indices.length === 0) indices.push(...[0, 1, 2, 3, 4, 5].slice(0, weather.hourly.time.length));
    return indices.map((i) => ({
      time: weather.hourly.time[i],
      temp: weather.hourly.temperature_2m[i],
      code: weather.hourly.weathercode[i],
      wind: weather.hourly.windspeed_10m[i],
    }));
  }, [weather]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Search bar */}
      <header className="border-b border-border/50 p-3">
        <div className="relative">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setShowResults(true)}
              placeholder="Search a city…"
              className="min-w-0 flex-1 bg-transparent font-mono-ae text-sm text-foreground focus:outline-none"
            />
            {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={toggleUnit}
              className="ml-1 rounded border border-border/50 px-1.5 py-0.5 font-mono-ae text-[0.65rem] text-muted-foreground hover:border-[oklch(0.82_0.17_195)]/50 hover:text-[oklch(0.82_0.17_195)]"
            >
              {unit === "celsius" ? "°C" : "°F"}
            </button>
          </div>

          {/* Search results dropdown */}
          {showResults && results.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border/60 bg-card shadow-lg"
            >
              {results.map((r) => (
                <li key={`${r.id}`}>
                  <button
                    onClick={() => selectCity(r)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background/60"
                  >
                    <MapPin className="h-3 w-3 shrink-0 text-[oklch(0.82_0.17_195)]" />
                    <span className="font-mono-ae text-xs text-foreground">{r.name}</span>
                    {r.admin1 && (
                      <span className="font-mono-ae text-[0.6rem] text-muted-foreground/70">
                        {r.admin1}
                      </span>
                    )}
                    <span className="font-mono-ae ml-auto text-[0.6rem] text-muted-foreground/60">
                      {r.country}
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Empty state */}
          {!activeCity && !loading && !error && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <MapPin className="h-10 w-10 opacity-30" />
              <p className="font-mono-ae text-sm">Search for a city to see its weather.</p>
              <p className="font-mono-ae text-[0.6rem] text-muted-foreground/60">
                Try “Tokyo”, “Paris”, or “São Paulo”
              </p>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.82_0.17_195)]" />
              <p className="font-mono-ae text-xs text-muted-foreground">Fetching weather…</p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <AlertCircle className="h-10 w-10 text-[oklch(0.7_0.2_15)]/70" />
              <p className="font-mono-ae text-sm text-[oklch(0.7_0.2_15)]">{error}</p>
              {activeCity && (
                <Button variant="outline" size="sm" onClick={refresh} className="text-xs">
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Retry
                </Button>
              )}
            </div>
          )}

          {/* Weather panel */}
          {weather && activeCity && !loading && wmo && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Current conditions card */}
              <div
                className="relative overflow-hidden rounded-xl border border-border/50 p-5"
                style={{
                  background: isDay
                    ? `linear-gradient(135deg, oklch(0.18 0.04 85 / 0.6), oklch(0.13 0.015 265 / 0.8))`
                    : `linear-gradient(135deg, oklch(0.16 0.03 290 / 0.6), oklch(0.11 0.012 265 / 0.9))`,
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-[oklch(0.82_0.17_195)]" />
                      <span className="font-mono-ae text-sm font-semibold text-foreground">
                        {activeCity.name}
                      </span>
                    </div>
                    <div className="font-mono-ae mt-0.5 text-[0.6rem] text-muted-foreground">
                      {activeCity.admin1 ? `${activeCity.admin1}, ` : ""}{activeCity.country}
                    </div>
                    <div className="font-mono-ae mt-0.5 text-[0.55rem] text-muted-foreground/70">
                      {new Date(weather.current.time).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={refresh}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-[oklch(0.82_0.17_195)]"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>

                <div className="mt-4 flex items-center gap-5">
                  <div className="text-6xl leading-none">{wmo.emoji}</div>
                  <div>
                    <div className="font-mono-ae text-5xl font-semibold tabular-nums" style={{ color: wmo.accent }}>
                      {Math.round(weather.current.temperature)}{weather.units.temp}
                    </div>
                    <div className="font-mono-ae mt-1 text-sm text-foreground/80">{wmo.label}</div>
                  </div>
                </div>

                {/* Quick stats */}
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-border/40 bg-background/40 p-2.5">
                    <div className="flex items-center gap-1 text-[0.55rem] uppercase tracking-wider text-muted-foreground">
                      <Wind className="h-3 w-3" />
                      Wind
                    </div>
                    <div className="font-mono-ae mt-0.5 text-sm font-semibold text-foreground">
                      {Math.round(weather.current.windspeed)} {weather.units.wind}
                    </div>
                    <div className="font-mono-ae text-[0.55rem] text-muted-foreground/70">
                      {windDirectionLabel(weather.current.winddirection)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/40 bg-background/40 p-2.5">
                    <div className="flex items-center gap-1 text-[0.55rem] uppercase tracking-wider text-muted-foreground">
                      <Thermometer className="h-3 w-3" />
                      Time
                    </div>
                    <div className="font-mono-ae mt-0.5 text-sm font-semibold text-foreground">
                      {isDay ? "Day" : "Night"}
                    </div>
                    <div className="font-mono-ae text-[0.55rem] text-muted-foreground/70">
                      {new Date(weather.current.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/40 bg-background/40 p-2.5">
                    <div className="flex items-center gap-1 text-[0.55rem] uppercase tracking-wider text-muted-foreground">
                      <Droplets className="h-3 w-3" />
                      Code
                    </div>
                    <div className="font-mono-ae mt-0.5 text-sm font-semibold text-foreground">
                      WMO {weather.current.weathercode}
                    </div>
                    <div className="font-mono-ae text-[0.55rem] text-muted-foreground/70">
                      {isDay ? "daytime" : "nighttime"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Hourly forecast */}
              <div>
                <div className="eyebrow mb-2">next 6 hours</div>
                <div className="scroll-ae flex gap-2 overflow-x-auto pb-2">
                  {forecastHours.map((h, i) => {
                    const hw = WMO_CODES[h.code] ?? { label: "?", emoji: "❓", accent: "oklch(0.6 0.05 250)" };
                    const date = new Date(h.time);
                    return (
                      <motion.div
                        key={h.time}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex w-20 shrink-0 flex-col items-center rounded-lg border border-border/40 bg-card/30 p-2.5"
                      >
                        <div className="font-mono-ae text-[0.55rem] text-muted-foreground">
                          {i === 0 ? "now" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="my-1 text-2xl">{hw.emoji}</div>
                        <div className="font-mono-ae text-sm font-semibold tabular-nums" style={{ color: hw.accent }}>
                          {Math.round(h.temp)}{weather.units.temp}
                        </div>
                        <div className="font-mono-ae mt-0.5 flex items-center gap-0.5 text-[0.55rem] text-muted-foreground/70">
                          <Wind className="h-2 w-2" />
                          {Math.round(h.wind)}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Source attribution */}
              <p className="font-mono-ae text-center text-[0.55rem] text-muted-foreground/50">
                Data: Open-Meteo (no API key required) · geocoding-api.open-meteo.com
              </p>
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default WeatherApp;
