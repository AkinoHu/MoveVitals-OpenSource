import type { NextConfig } from "next";

// Content-Security-Policy. Next.js emits inline bootstrap scripts, so script-src
// needs 'unsafe-inline' unless every page is rendered dynamically with nonces;
// the rest of the policy still blocks framing, plugins, <base> hijacking and
// connections/scripts to origins we do not use. Cloudflare Turnstile (optional
// CAPTCHA) is the only third-party script. Not set: form-action, because the
// provider connect buttons are plain forms that redirect to the provider.
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com${isDev ? " ws: wss:" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  poweredByHeader: false,
  // CMS image uploads go through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      // Unhashed images in public/ otherwise get max-age=0, which costs a
      // revalidation round trip to the origin on every page view.
      ...["/:file(logo-wordmark-(?:black|white)\\.png)", "/brands/:file*", "/og/:file*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      })),
    ];
  },
  // Canonical host: www.movevitals.com → movevitals.com (path and query kept).
  async redirects() {
    return [
      // Guide categories moved from /guides/c/<category> to /guides/<category>.
      { source: "/:locale(en|zh-CN|zh-TW|fr|es)/guides/c/:category", destination: "/:locale/guides/:category", permanent: true },
      { source: "/guides/c/:category", destination: "/guides/:category", permanent: true },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.movevitals.com" }],
        destination: "https://movevitals.com/:path*",
        permanent: true,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
