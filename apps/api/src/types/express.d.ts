// Declaration merging: attach the authenticated user id to Express requests so
// route handlers downstream of requireAuth can read req.userId without `any`.
import "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
