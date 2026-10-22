import type { NextConfig } from "next";

/**
 * Who may put `/embed/*` in an iframe: the department's site, plus any other nku.edu
 * host (the web CMS may preview from one). Fixed here rather than read from the
 * environment because `headers()` is evaluated at build time — a runtime variable in
 * the container would silently have no effect.
 */
const EMBED_ANCESTORS = "'self' https://nku.edu https://*.nku.edu";

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

  /**
   * Nothing but the embed may be framed. Without this, another site could load the
   * booking pages invisibly in a frame and trick a signed-in student into clicking
   * "Cancel". Later entries override earlier ones for the same header, so the embed
   * rule must stay second.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${EMBED_ANCESTORS}` },
        ],
      },
    ];
  },
};

export default nextConfig;
