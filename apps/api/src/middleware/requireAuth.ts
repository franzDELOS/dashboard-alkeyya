import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/tokens.js";

/**
 * Gate a route behind a valid Bearer access token. On success, attaches the
 * caller's user id to req.userId (typed via src/types/express.d.ts) and
 * continues. Any missing/invalid/expired token is a flat 401 — we don't
 * distinguish the failure mode to the client.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const { sub } = verifyAccessToken(token);
    req.userId = sub;
    next();
  } catch {
    res.status(401).json({ error: "UNAUTHORIZED" });
  }
}
