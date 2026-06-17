import type { NextConfig } from "next";

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
