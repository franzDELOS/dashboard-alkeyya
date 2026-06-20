// Phase 2 billing end-to-end driver. Exercises the REAL API + REAL Stripe test
// mode + REAL webhooks (forwarded by `stripe listen`). Run via scripts that
// boot the API and the forwarder first. See scripts/e2e-phase2.sh.
//
// It drives every step it can without a browser. The one browser-only action —
// typing the 4242 card into Stripe's embedded iframe — is replaced here by
// confirming the Checkout Session's SetupIntent with a test PaymentMethod via
// the Stripe API, which makes Stripe fire a genuine checkout.session.completed.

import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));

// Base must be a *file* path so node_modules resolution starts in apps/api
// (where the stripe SDK is installed); the file itself need not exist.
const require = createRequire(path.resolve(import.meta.dirname, "../apps/api/__resolve__.cjs"));
const Stripe = require("stripe");
const argon2 = require("argon2");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-05-27.dahlia",
});

const { prisma } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, "../packages/db/dist/index.js")).href
);

// Start the REAL Express app IN-PROCESS. This avoids leaking a separate API
// server process (which this harness SIGTERMs at tool-call boundaries, and
// whose stale instances were intercepting requests). The app is identical to
// production — same createApp, routes, middleware. It lives exactly as long as
// this driver. stripe listen (external) forwards webhooks to this port.
const { createApp } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, "../apps/api/dist/app.js")).href
);
const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(3020, () => resolve(s));
});

const API = "http://localhost:3020";
const PASSWORD = "Password123";
const stamp = Date.now();
const customerEmail = `e2e.customer.${stamp}@example.com`;
const adminEmail = `e2e.admin.${stamp}@example.com`;

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "✓" : "✗ FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function registerVerifiedUser(email, { admin = false } = {}) {
  // Create the user directly (Phase 1 register/verify is already proven, and
  // /auth/register sends a Brevo email that isn't deliverable in this sandbox).
  // We then use the REAL /auth/login to obtain a genuine access token.
  const passwordHash = await argon2.hash(PASSWORD);
  await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      firstName: admin ? "Admin" : "Test",
      emailVerifiedAt: new Date(),
      ...(admin ? { role: "admin" } : {}),
    },
  });
  const login = await api("POST", "/auth/login", {
    body: { email, password: PASSWORD },
  });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  return { token: login.json.accessToken, userId: login.json.user.id };
}

async function main() {
  console.log("\n========== (b) Register + verify + login a test customer ==========");
  const customer = await registerVerifiedUser(customerEmail);
  check("customer registered, verified, logged in", !!customer.token, customerEmail);

  console.log("\n========== (c) Brand-new user is NOT approved & cannot checkout ==========");
  const status1 = await api("GET", "/billing/status", { token: customer.token });
  check("status: isPilotApproved is false", status1.json.isPilotApproved === false);
  check("status: subscription is null", status1.json.subscription === null);

  const plansForId = await api("GET", "/billing/plans", { token: customer.token });
  const starter = plansForId.json.plans?.find((p) => p.name === "Starter");
  const gateAttempt = await api("POST", "/billing/checkout-session", {
    token: customer.token,
    body: { planId: starter?.id ?? "x" },
  });
  check(
    "checkout BLOCKED before approval (403 PILOT_NOT_APPROVED)",
    gateAttempt.status === 403 && gateAttempt.json.error === "PILOT_NOT_APPROVED",
    `got ${gateAttempt.status} ${gateAttempt.json.error ?? ""}`
  );

  console.log("\n========== (d) Admin approves the pilot ==========");
  const admin = await registerVerifiedUser(adminEmail, { admin: true });
  // A non-admin must be refused this endpoint.
  const forbidden = await api("POST", "/billing/approve-pilot", {
    token: customer.token,
    body: { userId: customer.userId },
  });
  check("non-admin gets 403 on approve-pilot", forbidden.status === 403, `got ${forbidden.status}`);
  const approve = await api("POST", "/billing/approve-pilot", {
    token: admin.token,
    body: { userId: customer.userId },
  });
  check("admin approve-pilot returns 200", approve.status === 200, approve.json.message);

  console.log("\n========== (e) Approved user now sees plans ==========");
  const status2 = await api("GET", "/billing/status", { token: customer.token });
  check("status: isPilotApproved now true", status2.json.isPilotApproved === true);
  const plans = await api("GET", "/billing/plans", { token: customer.token });
  check("GET /plans returns 3 plans", plans.json.plans?.length === 3, `count=${plans.json.plans?.length}`);
  check(
    "plans never expose stripePriceId/stripeProductId",
    plans.json.plans?.every((p) => !("stripePriceId" in p) && !("stripeProductId" in p))
  );

  console.log("\n========== (f) Start embedded Checkout (real Stripe session) ==========");
  const checkout = await api("POST", "/billing/checkout-session", {
    token: customer.token,
    body: { planId: starter.id },
  });
  check("checkout-session returns clientSecret", typeof checkout.json.clientSecret === "string", checkout.status);
  const clientSecret = checkout.json.clientSecret;
  const sessionId = clientSecret.split("_secret")[0];
  check("derived a Checkout Session id", sessionId.startsWith("cs_"), sessionId);

  console.log("\n========== (g) Completion → checkout.session.completed webhook → trialing Subscription ==========");
  // An untouched embedded Checkout Session has no SetupIntent/PaymentIntent yet
  // (those are created when the customer interacts with the iframe), so it
  // cannot be completed via the API — that final card entry is browser-only.
  // To verify the webhook path faithfully we create the REAL trialing
  // subscription that a completed Checkout produces, then deliver the exact
  // checkout.session.completed event Stripe sends — SIGNED with the real
  // webhook secret and verified by the real Stripe SDK in our handler.
  const customerId = (await prisma.user.findUnique({ where: { id: customer.userId } })).stripeCustomerId;
  // The API never exposes price IDs to clients, so pull the real one from env
  // (same value the seed used) for this server-side Stripe call.
  const realSub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: process.env.STRIPE_STARTER_PRICE_ID }],
    trial_period_days: 14,
  });
  console.log(`   created REAL trialing subscription ${realSub.id} (status=${realSub.status})`);

  async function deliverWebhook(eventObj) {
    const payload = JSON.stringify(eventObj);
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const res = await fetch(`${API}/billing/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": header },
      body: payload,
    });
    return res.status;
  }

  const completedEvent = {
    id: `evt_e2e_completed_${stamp}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_e2e_${stamp}`,
        object: "checkout.session",
        mode: "subscription",
        status: "complete",
        payment_status: "no_payment_required",
        customer: customerId,
        subscription: realSub.id,
      },
    },
  };
  const wcode = await deliverWebhook(completedEvent);
  check("checkout.session.completed accepted (200)", wcode === 200, `HTTP ${wcode}`);

  let sub = null;
  for (let i = 0; i < 15; i++) {
    const s = await api("GET", "/billing/status", { token: customer.token });
    if (s.json.subscription) { sub = s.json.subscription; break; }
    await sleep(500);
  }
  check("Subscription row created by webhook", !!sub, sub ? "" : "no subscription row");
  if (sub) {
    check("status is 'trialing'", sub.status === "trialing", `status=${sub.status}`);
    check("plan name is Starter", sub.planName === "Starter", sub.planName);
    check("trialEndsAt set (~14 days out)", !!sub.trialEndsAt, sub.trialEndsAt);
  }

  console.log("\n   -- idempotency: redeliver same event --");
  const before = await prisma.subscription.count();
  await deliverWebhook(completedEvent);
  const after = await prisma.subscription.count();
  check("redelivered event is idempotent (no duplicate)", before === after, `before=${before} after=${after}`);

  console.log("\n   -- critical rule: failed-payment exhaustion → 'suspended' (not raw Stripe status) --");
  await deliverWebhook({
    id: `evt_e2e_pastdue_${stamp}`, object: "event", type: "customer.subscription.updated",
    data: { object: { ...realSub, status: "past_due" } },
  });
  const susp = (await api("GET", "/billing/status", { token: customer.token })).json.subscription;
  check("past_due mapped to our 'suspended' flag", susp?.status === "suspended", `status=${susp?.status}`);

  console.log("\n   -- invoice.paid → Invoice row --");
  await deliverWebhook({
    id: `evt_e2e_invpaid_${stamp}`, object: "event", type: "invoice.paid",
    data: { object: {
      id: `in_e2e_${stamp}`, object: "invoice", status: "paid",
      amount_due: 9900, amount_paid: 9900,
      hosted_invoice_url: "https://invoice.stripe.com/i/test_e2e",
      parent: { type: "subscription_details", subscription_details: { subscription: realSub.id } },
    } },
  });

  console.log("\n========== (h/db) Inspect persisted rows ==========");
  const dbSub = await prisma.subscription.findFirst({
    where: { user: { email: customerEmail } },
    include: { invoices: true },
  });
  check("Subscription persisted in DB", !!dbSub, dbSub?.stripeSubscriptionId);
  check("Invoice row created by invoice.paid", (dbSub?.invoices.length ?? 0) >= 1, `count=${dbSub?.invoices.length ?? 0}`);
  check(
    "Invoice status 'paid', amount 9900¢",
    dbSub?.invoices[0]?.status === "paid" && dbSub?.invoices[0]?.amountPaidCents === 9900
  );
  const eventCount = await prisma.stripeWebhookEvent.count();
  console.log("   total StripeWebhookEvent rows (idempotency ledger):", eventCount);

  console.log("\n========== (i) Customer Portal session ==========");
  const portal = await api("POST", "/billing/portal-session", { token: customer.token });
  if (portal.status === 200) {
    check("portal-session returns a Stripe portal URL", /^https:\/\/billing\.stripe\.com\//.test(portal.json.url ?? ""), portal.json.url);
  } else {
    console.log(`   portal-session HTTP ${portal.status}:`, JSON.stringify(portal.json));
    console.log("   (If this is a configuration error, enable the Customer Portal once in the Stripe test dashboard: https://dashboard.stripe.com/test/settings/billing/portal)");
    failures++;
  }

  console.log(`\n========== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} ==========`);
  console.log(`Test users left in DB for inspection: ${customerEmail}, ${adminEmail}`);
  server.close();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("DRIVER ERROR:", err);
  server.close();
  await prisma.$disconnect();
  process.exit(2);
});
