import { rateLimit } from "express-rate-limit";

/**
 * Phase 5 rate limiting.
 *
 * In-memory store only — this is a single-process API, so the default memory
 * store is correct and needs no external dependency (no Redis). If the API is
 * ever horizontally scaled to multiple processes, swap in a shared store here.
 *
 * `standardHeaders: "draft-7"` emits the RateLimit-* combined header (plus the
 * per-window RateLimit-Policy), letting clients see remaining quota; the legacy
 * X-RateLimit-* headers are disabled. Express must have `trust proxy` set (done
 * in app.ts) so the limiter keys on the real client IP from X-Forwarded-For
 * rather than Nginx's 127.0.0.1 — otherwise every user shares one bucket.
 */

/**
 * Tight limiter for authentication endpoints (login, register, resend
 * verification, forgot password). 10 attempts per IP per 15 minutes blunts
 * credential stuffing and email-enumeration sweeps without inconveniencing a
 * real user who mistypes a password a few times.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many attempts. Please wait 15 minutes before trying again.",
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/**
 * Global default limiter applied to every route in app.ts. 60 requests per IP
 * per minute is generous for normal dashboard use but caps runaway scripts.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Rate limit exceeded. Please slow down.",
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/**
 * Strictest limiter, reserved for the most abuse-prone endpoint: password
 * reset requests. 5 per IP per hour. Stacked ON TOP of authLimiter on
 * /auth/forgot-password (it is listed first so it fires within the hour window
 * before the 15-minute authLimiter is even consulted).
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please try again in an hour.",
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
