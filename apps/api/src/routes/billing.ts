import { Router, type Request, type Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "@alkeyya/db";
import { env } from "../config/env.js";
import { stripe } from "../lib/stripe.js";
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

  const sub = user.subscription;
  return res.status(200).json({
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
