import express, { type Application, type Request, type Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { corsOrigins } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { settingsRouter } from "./routes/settings.js";
import { requestsRouter } from "./routes/requests.js";

/**
 * Build the Express 5 application. Kept separate from server startup so it can
 * be imported directly in tests (supertest) without binding a port.
 */
export function createApp(): Application {
  const app = express();

  // Security headers. We start strict; CSP/HSTS get tuned in Phase 5 once the
  // real frontend asset origins are known.
  app.use(helmet());

  // Only allow the known web origin(s) to call the API from a browser.
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );

  // Parse JSON for every route EXCEPT the Stripe webhook. Stripe signature
  // verification needs the exact raw request bytes, so /billing/webhook must
  // never be JSON-parsed here — it uses its own express.raw() in billing.ts.
  // (Express 5's req.path is the full path at app level; Stripe POSTs to this
  // exact path with no query string.)
  const jsonParser = express.json({ limit: "1mb" });
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    if (req.path === "/billing/webhook") return next();
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
