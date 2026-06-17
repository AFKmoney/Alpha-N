/**
 * use-mounted.ts — hydration-safe "is this the client?" hook.
 * Returns false during SSR and true after hydration, so time/locale-
 * dependent rendering can be guarded without causing hydration mismatches.
 */
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
