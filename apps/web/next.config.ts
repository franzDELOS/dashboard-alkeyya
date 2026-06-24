import type { NextConfig } from "next";
import path from "node:path";

// Single source of truth: the monorepo root .env (the same file the API loads).
// Pull it into process.env so vars like API_PROXY_TARGET and the NEXT_PUBLIC_*
// Stripe publishable key are available to dev builds without duplicating env
// files. In Docker/production these are injected directly, so a missing file is
// fine. Node 22 ships process.loadEnvFile, so no dotenv dependency is needed.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No root .env (e.g. production container) — env comes from the environment.
}

// In production, Nginx routes app.alkeyya.com/api -> the API service, so the
// browser always talks to the API same-origin at /api (no CORS).
// In local dev there is no Nginx, so we proxy /api -> the API port here.
const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET ?? "http://localhost:3020";

// Content-Security-Policy for the web app. Built as an explicit allowlist.
// NOTE the Stripe origins: js.stripe.com must appear in BOTH script-src AND
// frame-src — the embedded Checkout renders its card form in an iframe served
// from js.stripe.com, and omitting it from frame-src silently breaks Checkout
// with no console error. api.stripe.com is needed in connect-src for Stripe.js
// network calls. 'unsafe-inline' on script/style is required by Next.js
// hydration and Tailwind's inline styles respectively.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://api.stripe.com",
  "frame-src https://js.stripe.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// Security headers applied to every response. HSTS is intentionally absent here
// — it is owned solely by Nginx (Phase 5) so there is one place to manage the
// two-year commitment.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
