"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * useMounted — returns true only on the client, false during SSR.
 * Uses useSyncExternalStore so it is hydration-safe and lint-clean
 * (no setState-in-effect). Guard time/locale-dependent rendering with it.
 */
export function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false // server snapshot
  );
}
