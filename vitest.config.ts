import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  css: {
    // Vitest must not try to load/transform the Next.js PostCSS pipeline.
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pure-logic tests run fast; keep the suite snappy for tight feedback.
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
