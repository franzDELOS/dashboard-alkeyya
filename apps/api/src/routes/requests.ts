import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendRequestNotificationEmail } from "../lib/email.js";

/**
 * Phase 3 support requests. A submission is persisted, emailed to the founder's
 * inbox, and forwarded to n8n. The DB write and email are the contract; the n8n
 * forward is best-effort — a failure there is logged but never surfaced to the
 * customer.
 */
export const requestsRouter: Router = Router();

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const createSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(200, "Subject must be 200 characters or fewer"),
  priority: z.enum(PRIORITIES, {
    message: "Priority must be low, normal, high, or urgent",
  }),
  message: z
    .string()
    .trim()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be 5000 characters or fewer"),
  company: z
    .string()
    .trim()
    .max(200, "Company must be 200 characters or fewer")
    .optional(),
});

/** A 400 with the first zod issue message, or a generic fallback. */
function badRequest(res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  res.status(400).json({ error: first?.message ?? "Invalid request" });
}

// ---- Routes -----------------------------------------------------------------

// POST /requests — name + email come from the authenticated user; only the
// request content (and an optional company override) is taken from the body.
requestsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  const { subject, priority, message } = parsed.data;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email;
  const company = parsed.data.company ?? user.companyName ?? null;

  // 1–2. Persist. This is the part that must not fail silently.
  const request = await prisma.request.create({
    data: {
      userId: user.id,
      name,
      company,
      email: user.email,
      subject,
      priority,
      message,
    },
  });

  // 3. Notify the founder's inbox. A send failure is logged but the request was
  //    saved — don't error the client.
  try {
    await sendRequestNotificationEmail({
      name,
      company,
      email: user.email,
      subject,
      priority,
      message,
      userId: user.id,
      requestId: request.id,
    });
  } catch (err) {
    console.error("[requests] failed to send notification email:", err);
  }

  // 4. Forward to n8n (best-effort). Catch everything — network errors, the
  //    5s timeout, non-2xx — and continue. n8n is downstream automation, not a
  //    dependency of the customer's submission.
  try {
    const response = await fetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": env.N8N_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        requestId: request.id,
        userId: user.id,
        name,
        email: user.email,
        company,
        subject,
        priority,
        message,
        createdAt: request.createdAt,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(
        `[requests] n8n webhook returned ${response.status} for request ${request.id}`
      );
    }
  } catch (err) {
    console.error("[requests] n8n webhook delivery failed:", err);
  }

  return res
    .status(201)
    .json({ message: "Request submitted.", requestId: request.id });
});

// GET /requests — the current user's requests, newest first (capped at 50).
requestsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  const requests = await prisma.request.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      subject: true,
      priority: true,
      status: true,
      message: true,
      createdAt: true,
    },
  });

  return res.status(200).json({ requests });
});
