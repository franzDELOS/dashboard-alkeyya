import { Router, type Request, type Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { env } from "../config/env.js";
import { stripe } from "../lib/stripe.js";
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

/** Unix seconds → Date, tolerant of null/undefined. */
function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * In the pinned Stripe API version (2026-05-27.dahlia) the subscription's
 * billing period lives on its items, not on the subscription itself. We track
 * a single-item subscription, so the first item's period end is the one we
 * surface to the customer.
 */
function periodEndFrom(sub: Stripe.Subscription): Date | null {
  return toDate(sub.items.data[0]?.current_period_end);
}

// ---- Authenticated customer routes -----------------------------------------

// GET /billing/plans — the public catalogue (still login-gated). We never leak
// Stripe Product/Price IDs to the browser; those stay server-side.
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

  // The subscription lookup is by userId (one row per user), so it already
  // returns whichever provider's row exists. billingProvider lets the web app
  // branch its checkout/portal calls to the Stripe vs Polar endpoints.
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

// POST /billing/checkout-session — start an embedded Checkout for a plan.
billingRouter.post(
  "/checkout-session",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { subscription: true },
    });
    if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });

    // THE PILOT GATE. A fresh registration cannot reach Checkout until an admin
    // has manually approved them (a manual two-week pilot runs first, outside
    // this dashboard). This is a real gate, not polish.
    if (!user.isPilotApproved) {
      return res.status(403).json({
        error: "PILOT_NOT_APPROVED",
        message:
          "Your account is pending pilot approval. Contact your account manager to get started.",
      });
    }

    // One subscription per user in this phase — no upgrades/downgrades yet.
    if (user.subscription && ACTIVE_STATUSES.has(user.subscription.status)) {
      return res.status(409).json({ error: "ALREADY_SUBSCRIBED" });
    }

    const plan = await prisma.plan.findFirst({
      where: { id: parsed.data.planId, isActive: true },
    });
    if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

    // stripePriceId became optional with the Polar migration (a Polar-only plan
    // has no Stripe price). This Stripe checkout path requires it; every current
    // plan still has one, so this guard never trips today — it just keeps the
    // Stripe flow type-safe and fails cleanly if a non-Stripe plan reaches here.
    if (!plan.stripePriceId) {
      return res.status(400).json({ error: "PLAN_NOT_STRIPE_ENABLED" });
    }

    // Lazily create the Stripe Customer the first time the user checks out.
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
      const customer = await stripe.customers.create({
        email: user.email,
        name: name || undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      // "embedded_page" is what the pinned Stripe API version (2026-05-27.dahlia)
      // calls embedded Checkout — it returns a client_secret for Stripe.js's
      // EmbeddedCheckout (older API versions named this value "embedded"). This
      // is the locked decision: Checkout stays on our domain, not a redirect.
      ui_mode: "embedded_page",
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      // The 14-day trial clock starts HERE — only for an admin-approved user
      // who initiates Checkout, never at registration.
      subscription_data: { trial_period_days: 14 },
      return_url: `${env.APP_URL}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
    });

    return res.status(200).json({ clientSecret: session.client_secret });
  }
);

// GET /billing/checkout-session/:sessionId — used by the return page to confirm
// the outcome. We verify the session belongs to THIS user's Stripe customer so
// user A can't peek at user B's session.
billingRouter.get(
  "/checkout-session/:sessionId",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "NO_BILLING_ACCOUNT" });
    }

    const sessionId = req.params.sessionId;
    if (typeof sessionId !== "string") {
      return res.status(400).json({ error: "Invalid session id" });
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const sessionCustomer =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (sessionCustomer !== user.stripeCustomerId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    return res.status(200).json({
      status: session.status,
      paymentStatus: session.payment_status,
    });
  }
);

// POST /billing/portal-session — Stripe's hosted Customer Portal. Fine to be
// hosted (not embedded): it's for already-paying customers managing payment
// methods / invoices / cancellation, not the trust-sensitive initial sale.
billingRouter.post(
  "/portal-session",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "NO_BILLING_ACCOUNT" });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${env.APP_URL}/dashboard`,
    });

    return res.status(200).json({ url: portalSession.url });
  }
);

// ---- Polar customer routes (migration) --------------------------------------
// Built ALONGSIDE the Stripe routes above and selected by BILLING_PROVIDER in
// the web app. Guards mirror the Stripe routes exactly (pilot gate + one active
// subscription per user). Stripe = embedded Checkout; Polar = hosted Checkout
// (Polar is the Merchant of Record, so the payment page lives on Polar).

/**
 * Lazily resolve (or create) the Polar customer for a user, keyed by our user id
 * as Polar's externalId, and persist polarCustomerId. Mirrors the lazy Stripe
 * customer creation in /checkout-session. getExternal 404s when none exists yet,
 * so we fall through to create.
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
// plan. Same pilot gate + one-sub rule as the Stripe route. Returns { url } for
// a full-page redirect to Polar (no embedded mode; Polar hosts the payment).
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

    // Identical pilot gate to the Stripe route.
    if (!user.isPilotApproved) {
      return res.status(403).json({
        error: "PILOT_NOT_APPROVED",
        message:
          "Your account is pending pilot approval. Contact your account manager to get started.",
      });
    }

    // Identical one-subscription-per-user rule.
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
    // placeholder (verified against the SDK); the return page reads it back.
    // customerId binds the resulting order to our Polar customer (whose
    // externalId is already user.id); metadata.userId is the webhook's primary
    // way back to our user row.
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
// via a customer session. Returns { url } (customerPortalUrl) for a redirect.
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

// POST /billing/approve-pilot — the ONLY admin billing action this phase.
// Flips a user to approved so they can subscribe. (A full admin dashboard
// listing pending users is out of scope; the founder calls this directly.)
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

// ---- Webhook ----------------------------------------------------------------
// NOTE: this route is mounted with express.raw() as route-specific middleware.
// Stripe signature verification needs the EXACT raw request bytes, so this must
// run before any JSON body parsing touches it. See app.ts — the global
// express.json() explicitly skips POST /billing/webhook for the same reason.

billingRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("[billing] webhook signature verification failed:", err);
      return res.status(400).json({ error: "Invalid signature" });
    }

    // IDEMPOTENCY FIRST. If we've seen this event.id, ack immediately. Otherwise
    // record it BEFORE processing so a Stripe redelivery never reprocesses.
    // Tradeoff: if processing crashes after this insert we may skip applying
    // that one event — so we log loudly below if processing throws.
    const already = await prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (already) return res.status(200).json({ received: true });

    await prisma.stripeWebhookEvent.create({
      data: { stripeEventId: event.id, type: event.type },
    });

    try {
      await processEvent(event);
    } catch (err) {
      // We've already recorded the event id, so this won't be retried into
      // success. Log loudly so it's noticed and can be reconciled by hand.
      console.error(
        `[billing] FAILED to process webhook ${event.type} (${event.id}) AFTER recording it — manual reconciliation may be needed:`,
        err
      );
    }

    // Always 2xx once recorded/processed — Stripe retries on non-2xx/timeout.
    return res.status(200).json({ received: true });
  }
);

/**
 * Map a Stripe subscription status to OUR stored status. The only divergence:
 * once Stripe exhausts its automatic retries the subscription goes "past_due"
 * and ultimately "unpaid"; we collapse BOTH to our own "suspended" flag, which
 * is the gate the rest of the app checks to block access. We keep the row (no
 * delete) — reactivation is a manual admin action in this phase.
 */
function mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): string {
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") {
    return "suspended";
  }
  return stripeStatus;
}

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      await handleCheckoutCompleted(session);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: {
          status: mapSubscriptionStatus(sub.status),
          currentPeriodEnd: periodEndFrom(sub),
          trialEndsAt: toDate(sub.trial_end),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: "canceled" },
      });
      break;
    }
    case "invoice.paid": {
      await upsertInvoice(event.data.object, "paid");
      break;
    }
    case "invoice.payment_failed": {
      // Record the failed invoice but do NOT suspend here — suspension is
      // driven by customer.subscription.updated once Stripe exhausts retries.
      await upsertInvoice(event.data.object);
      break;
    }
    default:
      // Acknowledge unhandled events so Stripe stops retrying them.
      console.log(`[billing] unhandled webhook event type: ${event.type}`);
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!customerId || !subscriptionId) {
    console.error(
      `[billing] checkout.session.completed ${session.id} missing customer/subscription`
    );
    return;
  }

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!user) {
    console.error(
      `[billing] no user for stripeCustomerId ${customerId} (session ${session.id})`
    );
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceId
    ? await prisma.plan.findUnique({ where: { stripePriceId: priceId } })
    : null;
  if (!plan) {
    console.error(
      `[billing] no Plan matches price ${priceId} (subscription ${subscriptionId})`
    );
    return;
  }

  // Upsert by userId: one subscription row per user this phase. A re-subscribe
  // after cancellation reuses the row rather than colliding on the unique key.
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      planId: plan.id,
      stripeSubscriptionId: subscription.id,
      status: mapSubscriptionStatus(subscription.status),
      currentPeriodEnd: periodEndFrom(subscription),
      trialEndsAt: toDate(subscription.trial_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      planId: plan.id,
      stripeSubscriptionId: subscription.id,
      status: mapSubscriptionStatus(subscription.status),
      currentPeriodEnd: periodEndFrom(subscription),
      trialEndsAt: toDate(subscription.trial_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

/**
 * Create or update the Invoice row for a Stripe invoice. If a status override
 * isn't supplied we mirror Stripe's own status. Links to our Subscription via
 * the invoice's parent.subscription_details (the subscription id moved off the
 * top level of the Invoice object in this API version).
 */
async function upsertInvoice(
  invoice: Stripe.Invoice,
  statusOverride?: string
): Promise<void> {
  const stripeSubId = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof stripeSubId === "string" ? stripeSubId : stripeSubId?.id;
  if (!subscriptionId) {
    console.log(
      `[billing] invoice ${invoice.id} has no subscription — skipping`
    );
    return;
  }

  const localSub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
  if (!localSub) {
    console.error(
      `[billing] no local Subscription for ${subscriptionId} (invoice ${invoice.id}) — skipping invoice row`
    );
    return;
  }

  if (!invoice.id) return;
  const status = statusOverride ?? invoice.status ?? "open";

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      subscriptionId: localSub.id,
      stripeInvoiceId: invoice.id,
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      status,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    },
    update: {
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      status,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    },
  });
}

// ---- Polar webhook (migration) ----------------------------------------------
// Same shape as the Stripe webhook above (route-level express.raw, signature
// verification, idempotency-first ledger, log-and-continue on processing
// errors), adapted to Polar's Standard Webhooks delivery and event payloads.
// app.ts carves THIS path out of the rate limiter and JSON parser too.

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
 * collapse past_due into suspended), Polar keeps past_due distinct so the UI can
 * tell "retrying payment" apart from "access revoked". `unpaid` → suspended; the
 * subscription.revoked EVENT also forces suspended (handled at the call site).
 * Unknown/transient statuses (incomplete, incomplete_expired) pass through.
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
 * Resolve our local user id from a Polar payload. Prefer metadata.userId (set on
 * checkout), then the customer's externalId (= our user id, set at customer
 * creation), then a lookup by polarCustomerId. Returns null if none match.
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
 * Upsert the Subscription row for a Polar subscription, keyed by userId (one row
 * per user, mirroring the Stripe handler). A re-subscribe reuses the row. The
 * subscription.revoked event passes statusOverride="suspended"; every other
 * event derives status from the payload.
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
 * Upsert the Invoice row for a Polar order, keyed by polarOrderId. Links to the
 * local Subscription via the order's subscriptionId (falling back to the user's
 * subscription row). Polar orders carry no hosted invoice URL, so that stays
 * null. This is also where renewals and future overage line items will land.
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
    // All of these deliver a full Subscription; status is derived from it.
    case "subscription.created":
    case "subscription.updated":
    case "subscription.active":
    case "subscription.canceled":
    case "subscription.uncanceled":
    case "subscription.past_due":
      await upsertPolarSubscription(event.data);
      break;
    // Access has actually been revoked — force suspended regardless of status.
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
      // Ack unhandled events so Polar stops retrying them.
      console.log(`[billing] unhandled Polar webhook event type: ${event.type}`);
  }
}

billingRouter.post(
  "/polar/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    // POLAR_WEBHOOK_SECRET is optional in env (the app boots pre-cutover). If it
    // isn't set we can't verify the signature — fail soft with 503 rather than
    // crash, so Polar retries once it's configured.
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

    // Polar uses Standard Webhooks: the verified payload has NO top-level event
    // id, so the unique delivery id is the `webhook-id` header — that's our
    // idempotency key (mirrors the Stripe event.id ledger).
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
