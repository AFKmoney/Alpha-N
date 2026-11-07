/**
 * use-theme-sync — keeps the <html> class in sync with the OS store's
 * theme value. Attaches "dark" when theme === "dark", removes it for the
 * light default. Runs once on mount + whenever the theme changes.
 *
 * This replaces the old approach where the dock injected a big CSS string
 * via a <style> tag and set data-theme manually — fragile and racy. Now
 * the light/dark split lives entirely in globals.css (:root = light,
 * .dark = dark), and this hook just flips the class.
 */
"use client";

import { useEffect } from "react";
import { useOS } from "@/lib/alpha/os-store";

export function useThemeSync() {
  const theme = useOS((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
    // Keep data-theme in sync for any legacy selectors still keyed on it.
    root.setAttribute("data-theme", theme);
  }, [theme]);
}
