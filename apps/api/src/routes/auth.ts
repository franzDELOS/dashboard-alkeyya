import { Router, type Request, type Response } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { env } from "../config/env.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from "../lib/tokens.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email.js";
import { requireAuth } from "../middleware/requireAuth.js";
import crypto from "crypto";

export const authRouter: Router = Router();

// ---- Constants --------------------------------------------------------------

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_COOKIE = "refresh_token";
// The browser only ever talks to the API through the /api proxy (Next.js
// rewrite in dev, Nginx in prod), so the cookie must be scoped to the path the
// BROWSER sees — /api/auth — not the backend's internal /auth. Both refresh and
// logout live under it, so the cookie is sent to exactly those endpoints.
const REFRESH_COOKIE_PATH = "/api/auth";

// ---- Validation -------------------------------------------------------------

// Simple, non-paranoid password policy: 8+ chars with at least one letter and
// one number. Shared by registration and password reset.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).optional(),
});

const emailOnlySchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ token: z.string().min(1) });
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

// ---- Helpers ----------------------------------------------------------------

/** Cookie options for the refresh token. Secure only in production (so local
 *  http dev still receives the cookie). Scoped to the proxied /api/auth path so
 *  it's only sent to the refresh/logout endpoints the browser actually calls. */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_MS,
  };
}

/** A 400 with the first zod issue message, or a generic fallback. */
function badRequest(res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  res.status(400).json({ error: first?.message ?? "Invalid request" });
}

/** Issue a fresh refresh token, persist its hash, and set the cookie. */
async function issueRefreshToken(
  res: Response,
  userId: string,
  req: Request
): Promise<void> {
  const raw = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  res.cookie(REFRESH_COOKIE, raw, refreshCookieOptions());
}

// ---- Routes -----------------------------------------------------------------

// TODO: rate limit in Phase 5.
authRouter.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password, firstName, lastName, companyName } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // Don't reveal whether an email is already registered: respond identically
  // either way, but skip creating a duplicate / re-sending email.
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    console.warn(
      `[auth] registration attempt for existing email: ${normalizedEmail}`
    );
    return res
      .status(201)
      .json({ message: "Check your email to verify your account." });
  }

  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      companyName: companyName ?? null,
    },
  });

  const rawToken = crypto.randomBytes(40).toString("hex");
  await prisma.emailVerification.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  // Fresh registration: surface email failures so the user knows to retry.
  await sendVerificationEmail(user.email, user.firstName, rawToken);

  return res
    .status(201)
    .json({ message: "Check your email to verify your account." });
});

authRouter.post("/verify-email", async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const record = await prisma.emailVerification.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res
      .status(400)
      .json({ error: "This verification link is invalid or has expired." });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.emailVerification.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    }),
  ]);

  return res
    .status(200)
    .json({ message: "Email verified. You can now log in." });
});

// TODO: rate limit in Phase 5.
authRouter.post("/resend-verification", async (req: Request, res: Response) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const genericMessage = {
    message:
      "If that account exists and is unverified, we've sent a new verification email.",
  };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  // Only act for a real, still-unverified user — but never reveal that.
  if (user && !user.emailVerifiedAt) {
    const now = new Date();
    // Invalidate prior unused tokens (keep the rows for audit trail).
    await prisma.emailVerification.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });

    const rawToken = crypto.randomBytes(40).toString("hex");
    await prisma.emailVerification.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
    });

    await sendVerificationEmail(user.email, user.firstName, rawToken);
  }

  return res.status(200).json(genericMessage);
});

// TODO: rate limit in Phase 5.
authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // Same generic 401 whether the user is missing or the password is wrong.
  const invalid = () =>
    res.status(401).json({ error: "Invalid email or password" });

  if (!user) {
    // Hash a dummy value to keep timing roughly constant against enumeration.
    await argon2.hash(password).catch(() => undefined);
    return invalid();
  }

  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) return invalid();

  if (!user.emailVerifiedAt) {
    return res.status(403).json({
      error: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email before logging in.",
    });
  }

  await issueRefreshToken(res, user.id, req);

  return res.status(200).json({
    accessToken: generateAccessToken(user.id),
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      companyName: user.companyName,
    },
  });
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) return res.status(401).json({ error: "UNAUTHORIZED" });

  const current = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });

  if (!current || current.revokedAt || current.expiresAt < new Date()) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  // Rotate: mint a new token, then revoke the old one pointing at its successor.
  const newRaw = generateRefreshToken();
  const created = await prisma.refreshToken.create({
    data: {
      userId: current.userId,
      tokenHash: hashToken(newRaw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  await prisma.refreshToken.update({
    where: { id: current.id },
    data: { revokedAt: new Date(), replacedBy: created.id },
  });

  res.cookie(REFRESH_COOKIE, newRaw, refreshCookieOptions());
  return res.status(200).json({ accessToken: generateAccessToken(current.userId) });
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  return res.status(200).json({ message: "Logged out." });
});

// TODO: rate limit in Phase 5.
authRouter.post("/forgot-password", async (req: Request, res: Response) => {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const genericMessage = {
    message: "If that email exists, we've sent a reset link.",
  };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  if (user) {
    const now = new Date();
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });

    const rawToken = crypto.randomBytes(40).toString("hex");
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    try {
      await sendPasswordResetEmail(user.email, user.firstName, rawToken);
    } catch (err) {
      // Swallow: never reveal (via an error) whether the account exists.
      console.error("[auth] failed to send password reset email:", err);
    }
  }

  return res.status(200).json(genericMessage);
});

authRouter.post("/reset-password", async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const record = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res
      .status(400)
      .json({ error: "This reset link is invalid or has expired." });
  }

  const passwordHash = await argon2.hash(parsed.data.newPassword);
  const now = new Date();

  // Update the password, consume the reset token, and revoke every existing
  // session — a password reset should sign out everywhere.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  return res.status(200).json({ message: "Password updated. Please log in." });
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  return res.status(200).json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    companyName: user.companyName,
    emailVerifiedAt: user.emailVerifiedAt,
  });
});
