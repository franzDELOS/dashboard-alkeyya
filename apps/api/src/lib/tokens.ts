import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Token helpers for Phase 1 auth.
 *
 * Two very different things live here:
 *  - The ACCESS token is a signed JWT the client holds in memory for 15 min.
 *  - The REFRESH token (and the email-verification / password-reset tokens)
 *    are opaque random strings. We hand the raw value to the user but persist
 *    only its SHA-256 hash, so the database never holds anything replayable.
 */

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Sign a short-lived access token carrying just the user id as `sub`. */
export function generateAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Verify + decode an access token. Throws (JsonWebTokenError) on any failure. */
export function verifyAccessToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new jwt.JsonWebTokenError("Malformed access token payload");
  }
  return { sub: decoded.sub };
}

/**
 * A cryptographically random opaque token. This RAW value is the one given to
 * the client (in a cookie or an email link); only its hash is stored.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}

/**
 * SHA-256 hex digest. Used consistently for refresh tokens, email verification
 * tokens, and password reset tokens so lookups always compare hashes, never
 * raw secrets.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
