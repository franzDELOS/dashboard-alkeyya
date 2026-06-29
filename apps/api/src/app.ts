import express, { type Application, type Request, type Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { corsOrigins } from "./config/env.js";
import { apiLimiter } from "./lib/rate-limit.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { settingsRouter } from "./routes/settings.js";
import { requestsRouter } from "./routes/requests.js";
import { adminRouter } from "./routes/admin.js";

/**
 * Build the Express 5 application. Kept separate from server startup so it can
 * be imported directly in tests (supertest) without binding a port.
 */
export function createApp(): Application {
  const app = express();

  // We sit behind Nginx (one proxy hop). Trust exactly that one hop so
  // `req.ip` and the rate limiter read the real client IP from the LAST entry
  // of X-Forwarded-For — not Nginx's 127.0.0.1. Without this, every request
  // looks like it comes from the proxy and the rate limiter would throttle all
  // users at once. Must run before any IP-dependent middleware.
  app.set("trust proxy", 1);

  // Security headers. The API serves only JSON (no HTML/scripts/images), so the
  // CSP can be maximally strict. HSTS for the public web app is owned by Nginx
  // (Phase 5); the short max-age here is belt-and-suspenders for the unlikely
  // case anything ever hits the API origin directly in a browser.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge: 60 * 60 * 24 * 365, // 1 year for the API
        includeSubDomains: false,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
    })
  );

  // Only allow the known web origin(s) to call the API from a browser.
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );

  // Global rate limit: 60 req/min/IP across every route, as a baseline DoS
  // guard on top of the tighter per-endpoint auth limiters. The Polar webhook is
  // exempt — Polar retries from unpredictable IP ranges and must never be
  // throttled (same carve-out as the JSON parser below).
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    if (req.path === "/billing/polar/webhook") {
      return next();
    }
    return apiLimiter(req, res, next);
  });

  // Parse JSON for every route EXCEPT the Polar billing webhook. Polar's
  // Standard Webhooks signature verification needs the exact raw request bytes,
  // so this path must never be JSON-parsed here — it uses its own express.raw()
  // in billing.ts. (Express 5's req.path is the full path at app level.)
  const jsonParser = express.json({ limit: "1mb" });
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    if (req.path === "/billing/polar/webhook") {
      return next();
    }
    return jsonParser(req, res, next);
  });
  app.use(cookieParser());

  // Health/readiness probes (no auth).
  app.use("/", healthRouter);

  // Phase 1 authentication (register, login, refresh, verify, reset, etc.).
  app.use("/auth", authRouter);

  // Phase 2 billing (plans, status, embedded checkout, portal, webhook).
  app.use("/billing", billingRouter);

  // Phase 3 account settings (profile + password) and support requests.
  app.use("/settings", settingsRouter);
  app.use("/requests", requestsRouter);

  // Phase 4 internal admin panel (user/request management, audit log). Every
  // route inside is gated by requireAuth + requireAdmin.
  app.use("/admin", adminRouter);

  // Root: a quiet identifier, not an error.
  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({ service: "Alkeyya Dashboard API", phase: 0 });
  });

  // 404 for anything unmatched.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Express 5 forwards rejected async errors here automatically.
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      console.error("Unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
