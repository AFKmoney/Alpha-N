import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors now block the build (previously masked via ignoreBuildErrors,
  // which let real bugs ship). ESLint stays non-blocking during builds so a
  // stylistic warning can't wedge a deploy — run `npm run lint` in CI instead.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
