import { Router, type Request, type Response } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Phase 3 account settings. All routes require a valid access token. Profile
 * changes (including email) apply immediately — an email change deliberately
 * skips re-verification (less friction; the account is already owned). A
 * password change reuses the Phase 1 argon2 hashing and, like the reset flow,
 * revokes every other session.
 */
export const settingsRouter: Router = Router();

// The refresh cookie name/path must match auth.ts exactly so a password change
// can clear the same cookie the browser holds (scoped to the proxied path the
// browser actually sees, not the backend's internal /auth).
const REFRESH_COOKIE = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

// ---- Validation -------------------------------------------------------------

// Mirror Phase 1's policy: 8+ chars, at least one letter and one number.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const nameField = z.string().trim().max(100, "Must be 100 characters or fewer");

const profileSchema = z
  .object({
    firstName: nameField.optional(),
    lastName: nameField.optional(),
    companyName: nameField.optional(),
    email: z.string().email("Enter a valid email address").optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: "Provide at least one field to update" }
  );

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

/** A 400 with the first zod issue message, or a generic fallback. */
function badRequest(res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  res.status(400).json({ error: first?.message ?? "Invalid request" });
}

// ---- Routes -----------------------------------------------------------------

// GET /settings/profile — same shape as /auth/me's profile fields, lives here
// so settings fetches are cleanly separated from auth fetches.
settingsRouter.get("/profile", requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  return res.status(200).json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    companyName: user.companyName,
  });
});

// PATCH /settings/profile — partial update. Email changes immediately (no
// re-verification) but a collision with another user's email is a 409.
settingsRouter.patch("/profile", requireAuth, async (req: Request, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  const { firstName, lastName, companyName, email } = parsed.data;

  // Build the update from only the provided fields. Empty trimmed strings are
  // stored as null so "clear my company" works as expected.
  const data: {
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    email?: string;
  } = {};
  if (firstName !== undefined) data.firstName = firstName || null;
  if (lastName !== undefined) data.lastName = lastName || null;
  if (companyName !== undefined) data.companyName = companyName || null;

  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase();
    if (normalizedEmail !== user.email) {
      const clash = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (clash && clash.id !== user.id) {
        return res.status(409).json({ error: "EMAIL_IN_USE" });
      }
      data.email = normalizedEmail;
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
  });

  return res.status(200).json({
    message: "Profile updated.",
    user: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      companyName: updated.companyName,
    },
  });
});

// PATCH /settings/password — verify current password, set the new one, revoke
// every session, and clear this browser's refresh cookie so the client must
// log in again.
settingsRouter.patch("/password", requireAuth, async (req: Request, res: Response) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  const ok = await argon2
    .verify(user.passwordHash, parsed.data.currentPassword)
    .catch(() => false);
  if (!ok) return res.status(401).json({ error: "INVALID_PASSWORD" });

  const passwordHash = await argon2.hash(parsed.data.newPassword);
  const now = new Date();

  // Change the password and sign out everywhere — same posture as a reset.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  return res
    .status(200)
    .json({ message: "Password updated. Please log in again." });
});
