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

/**
 * Build the billing-status payload for a user: pilot flag plus the current
 * subscription (with the plan fields the UI renders). Shared by GET /status and
 * POST /polar/reconcile so both return the exact same shape. Returns null when
 * the user no longer exists (caller should 401).
 */
async function buildStatusPayload(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isPilotApproved: true,
      subscription: {
        include: {
          plan: {
            select: {
              name: true,
              monthlyPriceUsd: true,
              includedCalls: true,
              overageUnitCents: true,
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const sub = user.subscription;
  return {
    billingProvider: env.BILLING_PROVIDER,
    isPilotApproved: user.isPilotApproved,
    subscription: sub
      ? {
          planName: sub.plan.name,
          // The grandfathered price the subscriber actually pays, not the current
          // list price. Legacy rows (null snapshot) fall back to the live plan.
          monthlyPriceUsd: sub.priceUsdAtSubscription ?? sub.plan.monthlyPriceUsd,
          includedCalls: sub.plan.includedCalls,
          overageUnitCents: sub.plan.overageUnitCents,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
  };
}

// GET /billing/status — the current user's billing state. A newly-approved
// user with no Subscription yet returns subscription: null (expected).
billingRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const payload = await buildStatusPayload(req.userId!);
  if (!payload) return res.status(401).json({ error: "UNAUTHORIZED" });
  return res.status(200).json(payload);
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

// POST /billing/polar/reconcile — pull the user's LIVE subscription state from
// Polar and upsert it locally, then return the same shape as GET /billing/status.
// This makes the UI resilient to webhook delays/failures — and to local dev,
// where Polar webhooks can't reach us at all. Idempotent and race-safe with the
// webhook (both key the Subscription row by userId).
const reconcileSchema = z.object({ checkoutId: z.string().min(1).optional() });

billingRouter.post(
  "/polar/reconcile",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = reconcileSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, polarCustomerId: true },
    });
    if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

    try {
      await reconcilePolarSubscription(user, parsed.data.checkoutId ?? null);
    } catch (err) {
      // Never fail the request on a reconciliation error — fall through and
      // return whatever state we currently hold locally.
      console.error(`[billing] reconcile error for user ${user.id}:`, err);
    }

    const payload = await buildStatusPayload(user.id);
    if (!payload) return res.status(401).json({ error: "UNAUTHORIZED" });
    return res.status(200).json(payload);
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

/** True for a Prisma unique-constraint violation (P2002), without importing the
 *  Prisma error class. Used to resolve the webhook↔reconcile create race. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Compact error text for logs (Error message, else String(err)). */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The single low-level writer for a Polar-backed Subscription row, keyed by
 * userId. Shared by the webhook and the live reconciliation path so both write
 * identically. `status` is already mapped to OUR vocabulary by the caller.
 * Returns true if a row was written (false = no matching Plan for the product).
 */
async function persistPolarSubscription(
  userId: string,
  fields: {
    polarSubscriptionId: string;
    productId: string;
    status: string;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
  }
): Promise<boolean> {
  const plan = await prisma.plan.findUnique({
    where: { polarProductId: fields.productId },
  });
  if (!plan) {
    console.error(
      `[billing] no Plan matches Polar product ${fields.productId} (subscription ${fields.polarSubscriptionId}) — skipping`
    );
    return false;
  }

  const data = {
    planId: plan.id,
    provider: "polar",
    polarSubscriptionId: fields.polarSubscriptionId,
    status: fields.status,
    currentPeriodEnd: fields.currentPeriodEnd,
    trialEndsAt: fields.trialEndsAt,
    cancelAtPeriodEnd: fields.cancelAtPeriodEnd,
  };

  // Grandfathering: capture the plan's CURRENT price only when the row is first
  // created, so a later admin price change (and the subscription.updated webhook
  // it never even fires) can't retroactively reprice this subscriber on our side.
  // Deliberately absent from `update` — the snapshot is immutable once set.
  const createData = { ...data, priceUsdAtSubscription: plan.monthlyPriceUsd };

  try {
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, ...createData },
      update: data,
    });
  } catch (err) {
    // Race: the webhook and a reconcile can upsert the same userId at the same
    // instant and collide on create. The loser simply retries as an update —
    // the row now exists, so this is safe and converges to the same state.
    if (isUniqueViolation(err)) {
      await prisma.subscription.update({ where: { userId }, data });
    } else {
      throw err;
    }
  }
  return true;
}

/**
 * Upsert the Subscription row for a Polar webhook subscription payload, keyed by
 * userId. subscription.revoked passes statusOverride="suspended".
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

  await persistPolarSubscription(userId, {
    polarSubscriptionId: sub.id,
    productId: sub.productId,
    status: statusOverride ?? mapPolarStatus(sub.status),
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    trialEndsAt: sub.trialEnd ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
  });
}

/**
 * Reconcile a user's subscription with Polar's LIVE state and upsert it locally.
 * The core of the webhook-independence fix: the UI can render an active plan
 * even when the webhook is delayed, failed, or (in local dev) never arrives.
 *
 * Two sources, tried in order:
 *  1. customers.getStateExternal(externalId = our user id) — the authoritative
 *     current state; `activeSubscriptions` holds the trialing/active/past_due
 *     subscriptions that presently grant access.
 *  2. checkouts.get(checkoutId) — covers the brief window right after payment
 *     where customer state can still lag but the checkout already carries the
 *     new subscription id. Also backfills polarCustomerId if we learned it.
 *
 * Returns true if a Subscription row was written. Safe to call repeatedly.
 */
async function reconcilePolarSubscription(
  user: { id: string; polarCustomerId: string | null },
  checkoutId?: string | null
): Promise<boolean> {
  // 1. Authoritative: the customer's live state, keyed by our user id.
  try {
    const state = await polar.customers.getStateExternal({
      externalId: user.id,
    });
    const active = state.activeSubscriptions?.[0];
    if (active) {
      return await persistPolarSubscription(user.id, {
        polarSubscriptionId: active.id,
        productId: active.productId,
        status: mapPolarStatus(active.status),
        currentPeriodEnd: active.currentPeriodEnd ?? null,
        trialEndsAt: active.trialEnd ?? null,
        cancelAtPeriodEnd: active.cancelAtPeriodEnd ?? false,
      });
    }
  } catch (err) {
    // 404 = no Polar customer with this externalId yet; fall through to (2).
    console.warn(
      `[billing] getStateExternal failed for user ${user.id}: ${describeError(err)}`
    );
  }

  // 2. Fallback: the just-completed checkout.
  if (checkoutId) {
    try {
      const checkout = await polar.checkouts.get({ id: checkoutId });

      // Backfill the Polar customer id if we learned it here (best-effort).
      if (checkout.customerId && !user.polarCustomerId) {
        await prisma.user
          .update({
            where: { id: user.id },
            data: { polarCustomerId: checkout.customerId },
          })
          .catch(() => {});
      }

      if (
        (checkout.status === "succeeded" || checkout.status === "confirmed") &&
        checkout.subscriptionId
      ) {
        const full = await polar.subscriptions.get({
          id: checkout.subscriptionId,
        });
        return await persistPolarSubscription(user.id, {
          polarSubscriptionId: full.id,
          productId: full.productId,
          status: mapPolarStatus(full.status),
          currentPeriodEnd: full.currentPeriodEnd ?? null,
          trialEndsAt: full.trialEnd ?? null,
          cancelAtPeriodEnd: full.cancelAtPeriodEnd ?? false,
        });
      }
    } catch (err) {
      console.warn(
        `[billing] checkout reconcile failed for ${checkoutId}: ${describeError(err)}`
      );
    }
  }

  return false;
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
