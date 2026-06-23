import { Router, type Request, type Response } from "express";
import { Prisma, prisma } from "@alkeyya/db";
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
      subscription: {
        select: {
          status: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true } },
          invoices: {
            orderBy: { createdAt: "desc" },
            select: {
              stripeInvoiceId: true,
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
    subscription: user.subscription
      ? {
          planName: user.subscription.plan.name,
          status: user.subscription.status,
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
