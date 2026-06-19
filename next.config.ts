import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors now block the build (previously masked via ignoreBuildErrors,
  // which let real bugs ship). Run `npm run lint` in CI for static checks.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
