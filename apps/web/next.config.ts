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
};

export default nextConfig;
