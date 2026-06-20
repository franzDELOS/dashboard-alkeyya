import type { Request, Response, NextFunction } from "express";
import { prisma } from "@alkeyya/db";

/**
 * Gate a route to admins only. MUST run AFTER requireAuth in the chain, so
 * req.userId is already populated — this middleware only adds the role check.
 * Any non-admin (or missing user) is a flat 403.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }

  next();
}
