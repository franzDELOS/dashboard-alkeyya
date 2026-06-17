import { Router, type Request, type Response } from "express";
import { prisma } from "@alkeyya/db";

export const healthRouter: Router = Router();

/**
 * Liveness: is the process up and serving? No dependencies checked.
 * Used by Docker/Nginx to know the container itself is alive.
 */
healthRouter.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "alkeyya-dashboard-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness: can we actually serve traffic, i.e. is the database reachable?
 * A trivial `SELECT 1` proves the pg driver adapter + connection work
 * end-to-end without needing any domain models yet (Phase 0).
 */
healthRouter.get("/ready", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready", database: "up" });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      database: "down",
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
});
