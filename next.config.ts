import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Campus hosting runs this as a container, so the build emits `.next/standalone`:
   * a minimal server plus only the files tracing proved it needs, with no
   * `node_modules` install at runtime.
   *
   * Tracing does not copy `public` or `.next/static` — the Dockerfile does that
   * explicitly. Miss it and the app serves HTML with no CSS and no favicon.
   */
  output: "standalone",
};

export default nextConfig;
