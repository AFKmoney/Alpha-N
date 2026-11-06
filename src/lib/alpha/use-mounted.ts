/**
 * use-mounted.ts — hydration guard via useSyncExternalStore.
 * Returns false during SSR / first client render, true after mount.
 * Canonical React pattern: no setState-in-effect, no hydration mismatch.
 */
"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
