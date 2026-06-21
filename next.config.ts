import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors now block the build (previously masked via ignoreBuildErrors,
  // which let real bugs ship). Run `npm run lint` in CI for static checks.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Pin the Turbopack workspace root to THIS project. Without it, Next infers
  // the root from the nearest lockfile — and if there's a stray package.json
  // in a parent dir (common on dev machines), Turbopack picks the wrong root,
  // breaks module resolution, and throws "unexpected Turbopack error".
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
