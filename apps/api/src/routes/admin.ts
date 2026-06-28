import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@alkeyya/db";
import { polar } from "../lib/polar.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

/**
 * Phase 4 admin panel API. Every route is gated by requireAuth THEN requireAdmin
 * (chained as middleware args, exactly as billing.ts does for approve-pilot).
 * Every privileged mutation is recorded in the AuditLog via logAudit().
 */
export const adminRouter: Router = Router();

// ---- Audit helper -----------------------------------------------------------

/**
 * Record an admin action. NEVER throws: an audit-write failure must not block
 * (or roll back) the action it describes — we log loudly and move on.
 */
async function logAudit(params: {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("[admin] FAILED to write audit log:", params, err);
  }
}

// ---- Pagination helpers -----------------------------------------------------

/** Clamp a 1-based page to >= 1. */
function pageFrom(value: unknown): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Clamp limit into [1, max] with a default. */
function limitFrom(value: unknown, def: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

// Every admin route requires an authenticated admin.
adminRouter.use(requireAuth, requireAdmin);

// ============================================================================
// User management
// ============================================================================

// GET /admin/users — paginated, searchable, status-filterable user list.
adminRouter.get("/users", async (req: Request, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status =
    typeof req.query.status === "string" ? req.query.status : "all";
  const page = pageFrom(req.query.page);
  const limit = limitFrom(req.query.limit, 20, 50);

  const where: Prisma.UserWhereInput = {};

  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
    ];
  }

  if (status === "active") {
    where.suspendedAt = null;
    where.isPilotApproved = true;
  } else if (status === "suspended") {
    where.suspendedAt = { not: null };
  } else if (status === "pending_approval") {
    where.suspendedAt = null;
    where.isPilotApproved = false;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        role: true,
        isPilotApproved: true,
        suspendedAt: true,
        createdAt: true,
        subscription: {
          select: { status: true, plan: { select: { name: true } } },
        },
      },
    }),
  ]);

  res.status(200).json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      companyName: u.companyName,
      role: u.role,
      isPilotApproved: u.isPilotApproved,
      suspendedAt: u.suspendedAt,
      createdAt: u.createdAt,
      subscription: u.subscription
        ? { planName: u.subscription.plan.name, status: u.subscription.status }
        : null,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// GET /admin/users/:userId — full user detail.
adminRouter.get("/users/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      companyName: true,
      role: true,
      isPilotApproved: true,
      suspendedAt: true,
      emailVerifiedAt: true,
      createdAt: true,
      // polarCustomerId gates the orders/refund admin section in the web UI.
      polarCustomerId: true,
      subscription: {
        select: {
          status: true,
          // provider gates the Polar-only trial controls in the web UI.
          provider: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true } },
          invoices: {
            orderBy: { createdAt: "desc" },
            select: {
              // Both ids selected; one is null depending on the provider that
              // issued the invoice (Stripe invoice vs Polar order).
              stripeInvoiceId: true,
              polarOrderId: true,
              amountPaidCents: true,
              status: true,
              hostedInvoiceUrl: true,
              createdAt: true,
            },
          },
        },
      },
      requests: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          subject: true,
          priority: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

  const recentAuditLogs = await prisma.auditLog.findMany({
    where: { OR: [{ resourceId: userId }, { actorId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      action: true,
      resourceType: true,
      resourceId: true,
      metadata: true,
      createdAt: true,
    },
  });

  return res.status(200).json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    companyName: user.companyName,
    role: user.role,
    isPilotApproved: user.isPilotApproved,
    suspendedAt: user.suspendedAt,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    polarCustomerId: user.polarCustomerId,
    subscription: user.subscription
      ? {
          planName: user.subscription.plan.name,
          status: user.subscription.status,
          provider: user.subscription.provider,
          currentPeriodEnd: user.subscription.currentPeriodEnd,
          trialEndsAt: user.subscription.trialEndsAt,
          cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
          invoices: user.subscription.invoices,
        }
      : null,
    requests: user.requests,
    recentAuditLogs,
  });
});

// POST /admin/users/:userId/approve-pilot — idempotent pilot approval.
adminRouter.post(
  "/users/:userId/approve-pilot",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    if (user.isPilotApproved) {
      return res.status(200).json({ message: "Already approved." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isPilotApproved: true },
    });

    await logAudit({
      actorId: req.userId as string,
      action: "pilot_approved",
      resourceType: "user",
      resourceId: userId,
    });

    return res.status(200).json({ message: "Pilot approved." });
  }
);

// POST /admin/users/:userId/suspend — block dashboard access. Never an admin.
adminRouter.post(
  "/users/:userId/suspend",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    if (user.role === "admin") {
      return res.status(403).json({ error: "CANNOT_SUSPEND_ADMIN" });
    }
    if (user.suspendedAt) {
      return res.status(200).json({ message: "Already suspended." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: new Date() },
    });

    await logAudit({
      actorId: req.userId as string,
      action: "user_suspended",
      resourceType: "user",
      resourceId: userId,
    });

    return res.status(200).json({ message: "User suspended." });
  }
);

// POST /admin/users/:userId/unsuspend — restore dashboard access.
adminRouter.post(
  "/users/:userId/unsuspend",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    if (!user.suspendedAt) {
      return res.status(200).json({ message: "Not suspended." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null },
    });

    await logAudit({
      actorId: req.userId as string,
      action: "user_unsuspended",
      resourceType: "user",
      resourceId: userId,
    });

    return res.status(200).json({ message: "User unsuspended." });
  }
);

// ============================================================================
// Request management
// ============================================================================

const REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Linear status machine: each status may only advance to the single next one. */
const NEXT_STATUS: Record<RequestStatus, RequestStatus[]> = {
  open: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

// GET /admin/requests — paginated, status/priority-filterable request list.
adminRouter.get("/requests", async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const priority =
    typeof req.query.priority === "string" ? req.query.priority : "all";
  const page = pageFrom(req.query.page);
  const limit = limitFrom(req.query.limit, 20, 50);

  const where: Prisma.RequestWhereInput = {};
  if ((REQUEST_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if ((REQUEST_PRIORITIES as readonly string[]).includes(priority)) {
    where.priority = priority;
  }

  const [total, requests] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        subject: true,
        priority: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    }),
  ]);

  res.status(200).json({
    requests,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// GET /admin/requests/:requestId — full request detail.
adminRouter.get("/requests/:requestId", async (req: Request, res: Response) => {
  const requestId = req.params.requestId as string;
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      subject: true,
      priority: true,
      status: true,
      message: true,
      company: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
    },
  });

  if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
  return res.status(200).json(request);
});

// PATCH /admin/requests/:requestId/status — advance one linear step only.
adminRouter.patch(
  "/requests/:requestId/status",
  async (req: Request, res: Response) => {
    const requestId = req.params.requestId as string;
    const requested = (req.body as { status?: unknown })?.status;

    if (
      typeof requested !== "string" ||
      !(REQUEST_STATUSES as readonly string[]).includes(requested)
    ) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const newStatus = requested as RequestStatus;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });

    const current = request.status as RequestStatus;
    const allowed = NEXT_STATUS[current] ?? [];
    if (!allowed.includes(newStatus)) {
      return res.status(422).json({
        error: "INVALID_TRANSITION",
        message: `Cannot move from ${current} to ${newStatus}.`,
      });
    }

    await prisma.request.update({
      where: { id: requestId },
      data: { status: newStatus },
    });

    await logAudit({
      actorId: req.userId as string,
      action: "request_status_changed",
      resourceType: "request",
      resourceId: requestId,
      metadata: { from: current, to: newStatus },
    });

    return res
      .status(200)
      .json({ message: "Status updated.", status: newStatus });
  }
);

// ============================================================================
// Audit log
// ============================================================================

// GET /admin/audit — newest-first audit feed, filterable by actor/resource type.
adminRouter.get("/audit", async (req: Request, res: Response) => {
  const actorId =
    typeof req.query.actorId === "string" ? req.query.actorId : undefined;
  const resourceType =
    typeof req.query.resourceType === "string"
      ? req.query.resourceType
      : undefined;
  const page = pageFrom(req.query.page);
  const limit = limitFrom(req.query.limit, 50, 100);

  const where: Prisma.AuditLogWhereInput = {};
  if (actorId) where.actorId = actorId;
  if (resourceType) where.resourceType = resourceType;

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  res.status(200).json({
    logs,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// ============================================================================
// Billing management (Phase 3)
// ============================================================================
// Admin-only billing controls layered on top of the Polar (Merchant of Record)
// flow built in Phase 2. Plan-price and trial/refund mutations call Polar first;
// if Polar rejects, we return 502 so our DB never silently runs ahead of Polar.
// Stripe subscriptions are intentionally out of scope for the trial/refund tools.

// Statuses that count as "subscribed" for stats; admin users are excluded
// everywhere so internal accounts never skew the numbers.
const NON_ADMIN: Prisma.UserWhereInput = { role: { not: "admin" } };

// GET /admin/billing/stats — subscription status counts + a rough MRR estimate.
adminRouter.get("/billing/stats", async (_req: Request, res: Response) => {
  const byStatus = (status: string) =>
    prisma.subscription.count({ where: { status, user: NON_ADMIN } });

  const [active, trialing, past_due, canceled, suspended, noSubscription] =
    await Promise.all([
      byStatus("active"),
      byStatus("trialing"),
      byStatus("past_due"),
      byStatus("canceled"),
      byStatus("suspended"),
      prisma.user.count({ where: { ...NON_ADMIN, subscription: { is: null } } }),
    ]);

  // MRR estimate: sum each active subscriber's CURRENT plan display price. This
  // is deliberately rough — it ignores grandfathered pricing (a subscriber kept
  // on an old amount by Polar still counts at the plan's present price).
  const activeSubs = await prisma.subscription.findMany({
    where: { status: "active", user: NON_ADMIN },
    select: { plan: { select: { monthlyPriceUsd: true } } },
  });
  const mrrCents = activeSubs.reduce((sum, s) => sum + s.plan.monthlyPriceUsd, 0);

  res.status(200).json({
    active,
    trialing,
    past_due,
    canceled,
    suspended,
    noSubscription,
    mrrCents,
  });
});

// PATCH /admin/plans/:planId/price — change a plan's monthly price (in cents).
const priceSchema = z.object({
  monthlyPriceCents: z.number().int().positive(),
});

adminRouter.patch(
  "/plans/:planId/price",
  async (req: Request, res: Response) => {
    const planId = req.params.planId as string;
    const parsed = priceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "monthlyPriceCents must be a positive integer" });
    }
    const { monthlyPriceCents } = parsed.data;

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

    // Polar grandfathers existing subscribers onto their current price — updating
    // the product's price only affects NEW checkouts. Replacing the `prices`
    // array archives the old fixed price and adds the new one (verified against
    // the SDK: products.update takes a full prices list, not a single amount).
    if (plan.polarProductId) {
      try {
        await polar.products.update({
          id: plan.polarProductId,
          productUpdate: {
            prices: [{ amountType: "fixed", priceAmount: monthlyPriceCents }],
          },
        });
      } catch (err) {
        console.error(
          `[admin] Polar product price update failed for plan ${planId} (product ${plan.polarProductId}):`,
          err
        );
        return res.status(502).json({
          error: "POLAR_UPDATE_FAILED",
          message: "Couldn't update the price in Polar. The local price was not changed.",
        });
      }
    }

    const updated = await prisma.plan.update({
      where: { id: planId },
      data: { monthlyPriceUsd: monthlyPriceCents },
      select: { id: true, name: true, monthlyPriceUsd: true },
    });

    await logAudit({
      actorId: req.userId as string,
      action: "plan_price_changed",
      resourceType: "plan",
      resourceId: planId,
      metadata: { from: plan.monthlyPriceUsd, to: monthlyPriceCents },
    });

    return res.status(200).json({ plan: updated });
  }
);

// ---- Trial controls (Polar subscriptions only) -----------------------------

/**
 * Load a user's subscription and assert it's a Polar subscription we can drive.
 * Returns the row on success, or sends the appropriate error response and null.
 */
async function loadPolarSubscription(
  userId: string,
  res: Response
): Promise<{ id: string; polarSubscriptionId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subscription: true },
  });
  if (!user) {
    res.status(404).json({ error: "USER_NOT_FOUND" });
    return null;
  }
  const sub = user.subscription;
  if (!sub || sub.provider !== "polar" || !sub.polarSubscriptionId) {
    res.status(422).json({
      error: "NO_POLAR_SUBSCRIPTION",
      message: "User has no Polar subscription to grant a trial to.",
    });
    return null;
  }
  return { id: sub.id, polarSubscriptionId: sub.polarSubscriptionId };
}

const grantTrialSchema = z.object({ days: z.number().int().min(1).max(90) });

// POST /admin/users/:userId/trial/grant — set/extend the Polar trial by N days.
adminRouter.post(
  "/users/:userId/trial/grant",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const parsed = grantTrialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "days must be an integer from 1 to 90" });
    }
    const { days } = parsed.data;

    const sub = await loadPolarSubscription(userId, res);
    if (!sub) return; // response already sent

    const trialEndsAt = new Date(Date.now() + days * 86_400_000);
    try {
      await polar.subscriptions.update({
        id: sub.polarSubscriptionId,
        subscriptionUpdate: { trialEnd: trialEndsAt },
      });
    } catch (err) {
      console.error(`[admin] Polar trial grant failed for sub ${sub.id}:`, err);
      return res.status(502).json({
        error: "POLAR_UPDATE_FAILED",
        message: "Couldn't update the trial in Polar.",
      });
    }

    await logAudit({
      actorId: req.userId as string,
      action: "trial_granted",
      resourceType: "subscription",
      resourceId: sub.id,
      metadata: { days, trialEndsAt },
    });

    return res
      .status(200)
      .json({ message: `Trial granted (${days} days).`, trialEndsAt });
  }
);

// POST /admin/users/:userId/trial/end — end the Polar trial now (charges today).
adminRouter.post(
  "/users/:userId/trial/end",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;

    const sub = await loadPolarSubscription(userId, res);
    if (!sub) return; // response already sent

    // The SDK types trialEnd as Date | null, so we end the trial by setting it to
    // now (Polar's API also accepts the literal "now", but the typed client doesn't).
    try {
      await polar.subscriptions.update({
        id: sub.polarSubscriptionId,
        subscriptionUpdate: { trialEnd: new Date() },
      });
    } catch (err) {
      console.error(`[admin] Polar trial end failed for sub ${sub.id}:`, err);
      return res.status(502).json({
        error: "POLAR_UPDATE_FAILED",
        message: "Couldn't end the trial in Polar.",
      });
    }

    await logAudit({
      actorId: req.userId as string,
      action: "trial_ended",
      resourceType: "subscription",
      resourceId: sub.id,
    });

    return res.status(200).json({ message: "Trial ended." });
  }
);

// ---- Orders + refund (Polar orders only) -----------------------------------

// GET /admin/users/:userId/orders — the user's 10 most recent Polar orders.
adminRouter.get(
  "/users/:userId/orders",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { polarCustomerId: true },
    });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    if (!user.polarCustomerId) return res.status(200).json({ orders: [] });

    try {
      const page = await polar.orders.list({
        customerId: user.polarCustomerId,
        limit: 10,
      });
      const orders = page.result.items.map((o) => ({
        id: o.id,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: o.createdAt,
        productName: o.product?.name ?? null,
      }));
      return res.status(200).json({ orders });
    } catch (err) {
      console.error(`[admin] Polar orders list failed for user ${userId}:`, err);
      return res.status(502).json({
        error: "POLAR_LIST_FAILED",
        message: "Couldn't load orders from Polar.",
      });
    }
  }
);

// POST /admin/users/:userId/refund — refund a Polar order (full or partial).
const refundSchema = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().min(1).optional(),
});

// Polar's refund `reason` is a fixed enum (the SDK types it as a branded
// open-enum), but the admin UI offers a free-text reason. We coerce: an exact
// enum match passes through, anything else falls back to customer_request. The
// admin's original free text is still preserved in the audit log.
const REFUND_REASONS = [
  "duplicate",
  "fraudulent",
  "customer_request",
  "service_disruption",
  "satisfaction_guarantee",
  "dispute_prevention",
  "other",
] as const;
type PolarRefundReason = (typeof REFUND_REASONS)[number];
function toRefundReason(input: string | undefined): PolarRefundReason {
  return input && (REFUND_REASONS as readonly string[]).includes(input)
    ? (input as PolarRefundReason)
    : "customer_request";
}

adminRouter.post(
  "/users/:userId/refund",
  async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "orderId is required" });
    }
    const { orderId, amountCents, reason } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { polarCustomerId: true },
    });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    if (!user.polarCustomerId) {
      return res.status(422).json({ error: "NO_BILLING_ACCOUNT" });
    }

    // Confirm the order belongs to THIS user's Polar customer before refunding —
    // an admin must not be able to refund order ids from other customers.
    let order: Awaited<ReturnType<typeof polar.orders.get>>;
    try {
      order = await polar.orders.get({ id: orderId });
    } catch (err) {
      console.error(`[admin] Polar order fetch failed (${orderId}):`, err);
      return res.status(502).json({
        error: "POLAR_FETCH_FAILED",
        message: "Couldn't load the order from Polar.",
      });
    }
    if (order.customerId !== user.polarCustomerId) {
      return res.status(403).json({ error: "ORDER_NOT_OWNED_BY_USER" });
    }

    // The SDK requires both amount and reason. A blank amount = full refund of
    // whatever is still refundable; a blank reason defaults to customer_request.
    const amount = amountCents ?? order.totalAmount - order.refundedAmount;
    if (amount <= 0) {
      return res.status(422).json({
        error: "NOTHING_TO_REFUND",
        message: "This order has no refundable amount remaining.",
      });
    }

    try {
      await polar.refunds.create({
        orderId,
        amount,
        reason: toRefundReason(reason),
        revokeBenefits: false,
      });
    } catch (err) {
      console.error(`[admin] Polar refund failed (order ${orderId}):`, err);
      return res.status(502).json({
        error: "POLAR_REFUND_FAILED",
        message: "Couldn't issue the refund in Polar.",
      });
    }

    await logAudit({
      actorId: req.userId as string,
      action: "refund_issued",
      resourceType: "order",
      resourceId: orderId,
      metadata: { amountCents: amount, reason: reason ?? "customer_request" },
    });

    return res.status(200).json({ message: "Refund issued." });
  }
);
