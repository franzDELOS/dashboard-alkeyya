import { Router, type Request, type Response } from "express";
import express from "express";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { env } from "../config/env.js";
import { polar } from "../lib/polar.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const billingRouter: Router = Router();

// ---- Helpers ----------------------------------------------------------------

/** A 400 with the first zod issue message, or a generic fallback. */
function badRequest(res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  res.status(400).json({ error: first?.message ?? "Invalid request" });
}

const checkoutSchema = z.object({ planId: z.string().min(1) });
const approveSchema = z.object({ userId: z.string().min(1) });

/** Statuses that count as "the user already has billing" for the one-sub-per-
 *  user rule. A canceled/suspended row does not block starting fresh. */
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// ---- Authenticated customer routes -----------------------------------------

// GET /billing/plans — the public catalogue (still login-gated). We never leak
// Polar Product IDs to the browser; those stay server-side.
billingRouter.get("/plans", requireAuth, async (_req: Request, res: Response) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { monthlyPriceUsd: "asc" },
    select: { id: true, name: true, monthlyPriceUsd: true, features: true },
  });
  res.status(200).json({ plans });
});

// GET /billing/status — the current user's billing state. A newly-approved
// user with no Subscription yet returns subscription: null (expected).
billingRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      isPilotApproved: true,
      subscription: { include: { plan: { select: { name: true } } } },
    },
  });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

  const sub = user.subscription;
  return res.status(200).json({
    billingProvider: env.BILLING_PROVIDER,
    isPilotApproved: user.isPilotApproved,
    subscription: sub
      ? {
          planName: sub.plan.name,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
  });
});

// ---- Polar customer routes --------------------------------------------------
// Polar is the Merchant of Record. Checkout is a full-page redirect to Polar's
// hosted checkout (no embedded mode). Guards mirror the retired Stripe routes
// exactly: pilot gate + one active subscription per user.

/**
 * Lazily resolve (or create) the Polar customer for a user, keyed by our user
 * id as Polar's externalId, and persist polarCustomerId. getExternal 404s when
 * none exists yet, so we fall through to create.
 */
async function getOrCreatePolarCustomerId(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  polarCustomerId: string | null;
}): Promise<string> {
  if (user.polarCustomerId) return user.polarCustomerId;

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

  let customerId: string;
  try {
    const existing = await polar.customers.getExternal({ externalId: user.id });
    customerId = existing.id;
  } catch {
    // No customer with this externalId yet — create one.
    const created = await polar.customers.create({
      email: user.email,
      name: name || undefined,
      externalId: user.id,
      metadata: { userId: user.id },
    });
    customerId = created.id;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { polarCustomerId: customerId },
  });
  return customerId;
}

// POST /billing/polar/checkout-session — start a hosted Polar Checkout for a
// plan. Returns { url } for a full-page redirect to Polar's hosted checkout.
billingRouter.post(
  "/polar/checkout-session",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { subscription: true },
    });
    if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

    if (!user.isPilotApproved) {
      return res.status(403).json({
        error: "PILOT_NOT_APPROVED",
        message:
          "Your account is pending pilot approval. Contact your account manager to get started.",
      });
    }

    if (user.subscription && ACTIVE_STATUSES.has(user.subscription.status)) {
      return res.status(409).json({ error: "ALREADY_SUBSCRIBED" });
    }

    const plan = await prisma.plan.findFirst({
      where: { id: parsed.data.planId, isActive: true },
    });
    if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });
    if (!plan.polarProductId) {
      return res.status(422).json({ error: "PLAN_NOT_POLAR_ENABLED" });
    }

    const customerId = await getOrCreatePolarCustomerId(user);

    // No trial set here — Polar applies the trial configured on the product.
    // The success-url token `checkout_id={CHECKOUT_ID}` is Polar's own
    // placeholder; the return page reads it back. metadata.userId is the
    // webhook's primary way back to our user row.
    const checkout = await polar.checkouts.create({
      products: [plan.polarProductId],
      customerId,
      successUrl: `${env.APP_URL}/billing/return?checkout_id={CHECKOUT_ID}`,
      metadata: { userId: user.id },
    });

    return res.status(200).json({ url: checkout.url });
  }
);

// POST /billing/polar/portal-session — Polar's hosted customer portal, reached
// via a customer session. Returns { url } for a redirect.
billingRouter.post(
  "/polar/portal-session",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.polarCustomerId) {
      return res.status(404).json({ error: "NO_BILLING_ACCOUNT" });
    }

    const session = await polar.customerSessions.create({
      customerId: user.polarCustomerId,
    });

    return res.status(200).json({ url: session.customerPortalUrl });
  }
);

// ---- Admin route ------------------------------------------------------------

// POST /billing/approve-pilot — flips a user to approved so they can subscribe.
billingRouter.post(
  "/approve-pilot",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);

    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
    });
    if (!target) return res.status(404).json({ error: "USER_NOT_FOUND" });

    await prisma.user.update({
      where: { id: target.id },
      data: { isPilotApproved: true },
    });

    return res
      .status(200)
      .json({ message: "Pilot approved. Customer can now subscribe." });
  }
);

// ---- Polar webhook ----------------------------------------------------------
// Route-level express.raw() so Polar's Standard Webhooks signature verification
// gets the exact raw request bytes. app.ts carves this path out of the global
// rate limiter and JSON parser for the same reason.

// The discriminated union returned by validateEvent — narrowing on `.type`
// gives us the exact Subscription/Order payload without importing each model.
type PolarEvent = ReturnType<typeof validateEvent>;
type PolarSubscriptionData = Extract<
  PolarEvent,
  { type: "subscription.created" }
>["data"];
type PolarOrderData = Extract<PolarEvent, { type: "order.paid" }>["data"];

/** express IncomingHttpHeaders → the Record<string, string> validateEvent wants. */
function normalizeHeaders(headers: Request["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(", ");
  }
  return out;
}

/**
 * Map a Polar subscription status to OUR stored status. Unlike Stripe (where we
 * collapsed past_due into suspended), Polar keeps past_due distinct so the UI
 * can tell "retrying payment" apart from "access revoked". `unpaid` → suspended;
 * subscription.revoked also forces suspended (handled at the call site).
 */
function mapPolarStatus(status: string): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "suspended";
    default:
      return status;
  }
}

/**
 * Resolve our local user id from a Polar payload. Prefer metadata.userId (set
 * on checkout), then the customer's externalId (= our user id, set at customer
 * creation), then a lookup by polarCustomerId.
 */
async function resolvePolarUserId(
  metadata: Record<string, unknown> | null | undefined,
  externalId: string | null | undefined,
  customerId: string | null | undefined
): Promise<string | null> {
  const metaUserId =
    metadata && typeof metadata.userId === "string" ? metadata.userId : null;
  if (metaUserId) {
    const u = await prisma.user.findUnique({ where: { id: metaUserId } });
    if (u) return u.id;
  }
  if (externalId) {
    const u = await prisma.user.findUnique({ where: { id: externalId } });
    if (u) return u.id;
  }
  if (customerId) {
    const u = await prisma.user.findUnique({ where: { polarCustomerId: customerId } });
    if (u) return u.id;
  }
  return null;
}

/**
 * Upsert the Subscription row for a Polar subscription, keyed by userId.
 * subscription.revoked passes statusOverride="suspended".
 */
async function upsertPolarSubscription(
  sub: PolarSubscriptionData,
  statusOverride?: string
): Promise<void> {
  const userId = await resolvePolarUserId(
    sub.metadata,
    sub.customer?.externalId,
    sub.customerId
  );
  if (!userId) {
    console.error(
      `[billing] no user for Polar subscription ${sub.id} (customer ${sub.customerId}) — skipping`
    );
    return;
  }

  const plan = await prisma.plan.findUnique({
    where: { polarProductId: sub.productId },
  });
  if (!plan) {
    console.error(
      `[billing] no Plan matches Polar product ${sub.productId} (subscription ${sub.id}) — skipping`
    );
    return;
  }

  const data = {
    planId: plan.id,
    provider: "polar",
    polarSubscriptionId: sub.id,
    status: statusOverride ?? mapPolarStatus(sub.status),
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    trialEndsAt: sub.trialEnd ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
  };

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * Upsert the Invoice row for a Polar order, keyed by polarOrderId. Polar orders
 * carry no hosted invoice URL, so that stays null.
 */
async function upsertPolarOrder(
  order: PolarOrderData,
  statusOverride?: string
): Promise<void> {
  let localSub = order.subscriptionId
    ? await prisma.subscription.findUnique({
        where: { polarSubscriptionId: order.subscriptionId },
      })
    : null;

  if (!localSub) {
    const userId = await resolvePolarUserId(
      order.metadata,
      order.customer?.externalId,
      order.customerId
    );
    if (userId) {
      localSub = await prisma.subscription.findUnique({ where: { userId } });
    }
  }

  if (!localSub) {
    console.error(
      `[billing] no local Subscription for Polar order ${order.id} (subscription ${order.subscriptionId}) — skipping invoice row`
    );
    return;
  }

  const status = statusOverride ?? order.status;
  const amountPaidCents = order.paid ? order.totalAmount : 0;

  await prisma.invoice.upsert({
    where: { polarOrderId: order.id },
    create: {
      subscriptionId: localSub.id,
      polarOrderId: order.id,
      amountDueCents: order.totalAmount,
      amountPaidCents,
      status,
      hostedInvoiceUrl: null,
    },
    update: {
      amountDueCents: order.totalAmount,
      amountPaidCents,
      status,
    },
  });
}

async function processPolarEvent(event: PolarEvent): Promise<void> {
  switch (event.type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.active":
    case "subscription.canceled":
    case "subscription.uncanceled":
    case "subscription.past_due":
      await upsertPolarSubscription(event.data);
      break;
    case "subscription.revoked":
      await upsertPolarSubscription(event.data, "suspended");
      break;
    case "order.created":
      await upsertPolarOrder(event.data);
      break;
    case "order.paid":
      await upsertPolarOrder(event.data, "paid");
      break;
    default:
      console.log(`[billing] unhandled Polar webhook event type: ${event.type}`);
  }
}

billingRouter.post(
  "/polar/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    if (!env.POLAR_WEBHOOK_SECRET) {
      console.error(
        "[billing] POLAR_WEBHOOK_SECRET is not set — cannot verify Polar webhook"
      );
      return res.status(503).json({ error: "Polar webhook not configured" });
    }

    const headers = normalizeHeaders(req.headers);

    let event: PolarEvent;
    try {
      event = validateEvent(
        req.body as Buffer,
        headers,
        env.POLAR_WEBHOOK_SECRET
      );
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        console.error("[billing] Polar webhook verification failed:", err);
        return res.status(403).json({ error: "Invalid signature" });
      }
      throw err;
    }

    // Polar uses Standard Webhooks: the unique delivery id is the `webhook-id`
    // header — that's our idempotency key (mirrors the retired Stripe event.id).
    const eventId = headers["webhook-id"];
    if (!eventId) {
      console.error("[billing] Polar webhook missing webhook-id header");
      return res.status(400).json({ error: "Missing webhook-id" });
    }

    // IDEMPOTENCY FIRST: if seen, ack immediately; otherwise record BEFORE
    // processing so a redelivery never reprocesses.
    const already = await prisma.polarWebhookEvent.findUnique({
      where: { polarEventId: eventId },
    });
    if (already) return res.status(200).json({ received: true });

    await prisma.polarWebhookEvent.create({
      data: { polarEventId: eventId, type: event.type },
    });

    try {
      await processPolarEvent(event);
    } catch (err) {
      console.error(
        `[billing] FAILED to process Polar webhook ${event.type} (${eventId}) AFTER recording it — manual reconciliation may be needed:`,
        err
      );
    }

    return res.status(200).json({ received: true });
  }
);
