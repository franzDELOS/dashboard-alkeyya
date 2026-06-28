# Polar Migration Plan — Stripe → Polar (Merchant of Record)

This is a **phased, additive** migration. Polar is built *alongside* Stripe.
Nothing user-facing changes in Phase 1, and the existing Stripe billing flow keeps
working unchanged. This document describes what exists today and exactly what
**Phase 1** will touch. Phases 2+ are sketched only for context — not in scope now.

---

## What exists today

### Billing model (Stripe, fully wired)
- **`packages/db/prisma/schema.prisma`** — billing models:
  - `Plan` — `name @unique`, `stripeProductId @unique` (required), `stripePriceId @unique` (required), `monthlyPriceUsd` (cents, integer), `features String[]`, `isActive`.
  - `User` — `stripeCustomerId @unique`, `isPilotApproved`, `role`, `suspendedAt`, relation `subscription`.
  - `Subscription` — `userId @unique` (one sub/user), `planId`, `stripeSubscriptionId @unique` (required), `status`, `currentPeriodEnd`, `trialEndsAt`, `cancelAtPeriodEnd`.
  - `Invoice` — `stripeInvoiceId @unique` (required), `amountDueCents`, `amountPaidCents`, `status`, `hostedInvoiceUrl`.
  - `StripeWebhookEvent` — idempotency ledger: `stripeEventId @unique`, `type`, `processedAt`.
- **`packages/db/prisma/seed.ts`** — upserts 3 plans **by name** (idempotent). Reads `STRIPE_*_PRODUCT_ID` / `STRIPE_*_PRICE_ID` from env via a `required()` collector that fails fast if any are missing. **The price data here is STALE** (see below).
- **`apps/api/src/lib/stripe.ts`** — single `Stripe` client, `apiVersion` pinned to `2026-05-27.dahlia`.
- **`apps/api/src/routes/billing.ts`** — full Stripe flow: `/plans`, `/status`, `/checkout-session` (embedded, with pilot gate + 14-day trial), `/checkout-session/:id`, `/portal-session`, `/approve-pilot` (admin), `/webhook` (raw body, signature verify, idempotency-first ledger, subscription/invoice sync).
- **`apps/api/src/config/env.ts`** — Zod env schema, fail-fast at boot. Stripe vars are all **required** (no defaults): `STRIPE_SECRET_KEY` (`sk_`), `STRIPE_WEBHOOK_SECRET` (`whsec_`), and the six `STRIPE_*_PRODUCT_ID` / `STRIPE_*_PRICE_ID`.
- **`apps/api/src/app.ts`** — `/billing/webhook` is carved out of both the global rate limiter and the JSON body parser (Stripe needs raw bytes). `/billing` mounted with `billingRouter`.

### Stale seed data (current → corrected)
The current seed has wrong prices **and** inverted Growth/Premium tiers:

| Plan    | Current seed | **Corrected (live alkeyya.com/pricing)** | includedCalls | overageUnitCents |
|---------|--------------|------------------------------------------|---------------|------------------|
| Starter | $99 (9900c)  | **$39 (3900c)**                          | 35            | 49               |
| Growth  | $399 (39900c)| **$69 (6900c)**                          | 100           | 49               |
| Premium | $199 (19900c)| **$99 (9900c)**                          | null (unlim.) | null (none)      |

### Relevant infra/conventions
- Prisma 7, Rust-free: `prisma-client` generator → `packages/db/src/generated/prisma`, pg driver adapter. DB URL read from `prisma.config.ts` (root `.env`), not the schema.
- `pnpm db:migrate` = `prisma migrate dev`; `pnpm db:seed` = `prisma db seed` (`tsx prisma/seed.ts`).
- Money is always cents-based integers. Seed is upsert-by-name idempotent. Env validation is fail-fast at boot. ESM throughout (`"type": "module"`, `.js` import specifiers).

---

## Phase 1 — exactly what will change (ADDITIVE ONLY)

> Constraint check: no Stripe code removed or rewritten; no user-facing change; no Polar API called (SDK constructed but not exercised until Phase 2).

### 1. Install + Polar client — `apps/api`
- `pnpm add @polar-sh/sdk` (in `apps/api`).
- **New file `apps/api/src/lib/polar.ts`** — export a configured client built from env (`accessToken` + `server: 'sandbox' | 'production'`).
- **Before writing it**, verify the exact constructor shape against the installed types in `node_modules/@polar-sh/sdk` (the prompt flags this explicitly — I will not guess the SDK API). Any shape difference from the assumed `{ accessToken, server }` will be reported.

### 2. Env schema — `apps/api/src/config/env.ts` (add, keep all Stripe vars)
Add alongside Stripe vars:
- `POLAR_SERVER` — enum `'sandbox' | 'production'`, default `'sandbox'`.
- `BILLING_PROVIDER` — enum `'stripe' | 'polar'`, default `'stripe'`.
- `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_STARTER_PRODUCT_ID`, `POLAR_GROWTH_PRODUCT_ID`, `POLAR_PREMIUM_PRODUCT_ID` — all **optional** for now (not used until Phase 2; keeps the app booting whether or not the Polar products exist yet). A comment will note Phase 2 tightens the ones that become required.
- All existing Stripe fail-fast behavior left intact.

### 3. Schema — `packages/db/prisma/schema.prisma` (additive; keep all Stripe columns)
- `Plan`: add `polarProductId String? @unique`, `includedCalls Int?` (null = unlimited), `overageUnitCents Int?` (null = none), `polarMeterId String?`. Make `stripeProductId` and `stripePriceId` **optional** (`String?`) so Polar-only plans don't need Stripe IDs. (Existing `@unique` stays; Postgres allows multiple NULLs under a unique index.)
- `User`: add `polarCustomerId String? @unique`.
- `Subscription`: add `polarSubscriptionId String? @unique`, `provider String @default("stripe")`.
- `Invoice`: add `polarOrderId String? @unique`; make `stripeInvoiceId` **optional**.
- **New `PolarWebhookEvent`** `{ id, polarEventId String @unique, type String, processedAt DateTime @default(now()) }` — mirrors `StripeWebhookEvent`.
- **New `BillingConfig`** — single typed settings row holding `trialDays Int @default(14)` (admin-editable later).
- Run `pnpm db:migrate` with name **`add_polar_billing`**.

### 4. Seed — `packages/db/prisma/seed.ts`
- Correct plan data to the table above (fix stale prices + inverted Growth/Premium).
- Populate `includedCalls` (35 / 100 / null) and `overageUnitCents` (49 / 49 / null).
- Read `POLAR_*_PRODUCT_ID` from env; set `polarProductId` per plan **only when the env var is present** (seed works before Polar products exist).
- Keep populating Stripe fields when their env vars are present, but **no longer require them** (relax the hard `required()` fail so seed runs in a Polar-only / pre-Stripe state). Keep upsert-by-name idempotency.
- **Feature copy (decided):** drop only the now-incorrect call-count bullets so nothing contradicts the new `includedCalls` (e.g. remove Starter's "Up to 100 calls/month", Growth's call-count line, Premium's "Unlimited calls"). All other feature bullets stay intact.

---

## Phase 1 verification (then STOP)
- `pnpm typecheck` clean.
- `pnpm db:migrate` applies `add_polar_billing` cleanly.
- `pnpm db:seed` writes exactly 3 plans: prices 3900/6900/9900, includedCalls 35/100/null, overageUnitCents 49/49/null, polarProductId where env present.
- `pnpm dev` boots with no errors.
- Existing Stripe billing page still works unchanged at http://localhost:3001.

## Explicitly NOT in Phase 1
- No Polar API calls; no checkout/webhook/sync logic; no provider switching wired into `billing.ts`; no UI changes; no Stripe removal. Those are Phase 2+.

---

## Files Phase 1 will touch
- `apps/api/package.json` (+ lockfile) — add `@polar-sh/sdk`.
- `apps/api/src/lib/polar.ts` — **new**.
- `apps/api/src/config/env.ts` — add Polar/provider vars.
- `packages/db/prisma/schema.prisma` — additive columns + 2 new models.
- `packages/db/prisma/migrations/*_add_polar_billing/` — **new** migration.
- `packages/db/prisma/seed.ts` — corrected data + optional Polar/Stripe IDs.

---

## Phase 2 — wire Polar end-to-end ALONGSIDE Stripe (ADDITIVE ONLY)

> Constraint check: the existing Stripe billing flow stays **byte-for-byte unchanged**
> when `BILLING_PROVIDER` is `'stripe'` (the default). No Stripe route, handler, or UI
> branch is deleted or rewritten — Polar is built next to it and selected by env. The
> web app branches at runtime on `billingProvider` returned by `/billing/status`.

### A. API — shared `GET /billing/status` (provider-agnostic)
- Add `billingProvider: env.BILLING_PROVIDER` to the response. Existing
  `isPilotApproved` + `subscription` fields and shape stay identical.
- The subscription lookup is already by `userId` (one row per user), so it returns
  whichever row exists (Stripe or Polar). No query change needed beyond returning the
  provider flag.

### B. API — new Polar customer routes (in `apps/api/src/routes/billing.ts`)
Mirror the Stripe route guards exactly. Stripe routes are left untouched.
- `POST /billing/polar/checkout-session` — `requireAuth`. Same pilot gate (403
  `PILOT_NOT_APPROVED`) and same one-active-subscription rule (409 `ALREADY_SUBSCRIBED`
  for `trialing|active|past_due`). Look up plan by `planId` (404 `PLAN_NOT_FOUND`; 422
  `PLAN_NOT_POLAR_ENABLED` if no `polarProductId`). Lazily create-or-get a Polar
  customer keyed by `externalId = user.id`, persist `user.polarCustomerId`. Create a
  hosted checkout for `plan.polarProductId`. Return `{ url }`. No trial set here — it
  comes from the Polar product config.
- `POST /billing/polar/portal-session` — `requireAuth`. Require `user.polarCustomerId`
  (404 `NO_BILLING_ACCOUNT`). Create a Polar customer session, return `{ url }`.

### C. API — Polar webhook (`POST /billing/polar/webhook`)
- Mounted with route-level `express.raw({ type: "application/json" })`, like Stripe's.
- `app.ts`: add `/billing/polar/webhook` to **both** carve-outs (rate-limiter skip AND
  JSON-parser skip) next to the existing `/billing/webhook` check.
- Verify with `validateEvent(req.body, headers, env.POLAR_WEBHOOK_SECRET)`; on
  `WebhookVerificationError` → 403. If `POLAR_WEBHOOK_SECRET` is unset → log + 503
  (don't crash).
- Idempotency: record the event id in `PolarWebhookEvent` BEFORE processing; if present,
  ack 200 immediately. 2xx fast; log-and-continue on processing errors (Stripe pattern).
- Handle: `subscription.created`, `subscription.updated`, `subscription.active`,
  `subscription.canceled`, `subscription.uncanceled`, `subscription.past_due`,
  `subscription.revoked`, `order.created`, `order.paid`. Unknown → log + ack.
- Status map: `trialing→trialing`, `active→active`, `past_due→past_due`,
  `canceled→canceled`, `unpaid|revoked→suspended`. past_due is **not** collapsed into
  suspended (kept distinct).
- Upsert `Subscription` by `userId` (resolve user via `data.metadata.userId` →
  `customer.externalId` → `polarCustomerId`), set `provider="polar"`,
  `polarSubscriptionId`, `planId` (product → `Plan.polarProductId`), `status`,
  `currentPeriodEnd`, `trialEndsAt`, `cancelAtPeriodEnd`.
- On `order.created`/`order.paid`, upsert `Invoice` by `polarOrderId`
  (`amountDueCents`, `amountPaidCents`, `status`, `hostedInvoiceUrl` if present),
  linked to the local Subscription.

### D. Web — branch checkout + portal on provider (minimal diff)
- `billing-client.tsx`: read `billingProvider` from `/api/billing/status`. In
  `openPortal()`, call `/api/billing/polar/portal-session` when `'polar'`, else the
  Stripe portal. Update the "hosted Stripe portal" comment.
- `checkout/[planId]/`: thread the provider into `CheckoutClient` (fetch status in the
  client). When `'polar'`, POST `/api/billing/polar/checkout-session` and
  `window.location.href = url` (full redirect to Polar hosted checkout). When
  `'stripe'`, keep the embedded flow exactly. Blocked/error states
  (`PILOT_NOT_APPROVED`, `ALREADY_SUBSCRIBED`) keep working for both.
- `return/`: source of truth is `GET /billing/status`. Handle whichever param is
  present (`checkout_id` for Polar, `session_id` for Stripe). Keep Stripe's path.
- No restyling; reuse `BillingShell`, `buttonClass`, existing components.

### E. Env tightening (light)
- Polar vars stay optional, but add a boot-time **warning** (not a crash) if
  `BILLING_PROVIDER==='polar'` and any of `POLAR_ACCESS_TOKEN` /
  `POLAR_WEBHOOK_SECRET` / the three product IDs are missing. Default
  `BILLING_PROVIDER='stripe'`.

### Schema gap found in Phase 1 (one additive migration needed)
Phase 1 made `Plan.stripeProductId/stripePriceId` and `Invoice.stripeInvoiceId`
optional, but **left `Subscription.stripeSubscriptionId` as required (`String @unique`)**.
A Polar-only subscription row has no Stripe sub id, so Phase 2 must make
`stripeSubscriptionId String?` (additive; `@unique` keeps allowing multiple NULLs).
Migration name: `polar_subscription_optional`.

### Polar SDK shapes — verified against installed `@polar-sh/sdk@0.48.1`
Confirmed against `node_modules` types; differences from this phase's assumptions noted:
- **Checkout create** — `polar.checkouts.create({ products: [productId], successUrl,
  externalCustomerId, metadata })` → returns `{ id, url, clientSecret, customerId }`.
  - ⚠️ Customer-linkage field is **`externalCustomerId`** (the prompt guessed
    `customerExternalId`). Since checkout itself can create/link the customer by
    external id, we still pre-create the customer to persist `polarCustomerId`.
  - Success-URL token is **`checkout_id={CHECKOUT_ID}`** (matches assumption) →
    `successUrl = ${APP_URL}/billing/return?checkout_id={CHECKOUT_ID}`.
- **Customer create/lookup** — `polar.customers.getExternal({ externalId })` /
  `polar.customers.create({ email, name?, externalId, metadata })` → `Customer { id }`.
- **Customer session (portal)** — `polar.customerSessions.create({ customerId })` →
  returns `{ token, customerPortalUrl }`.
  - ⚠️ Portal URL field is **`customerPortalUrl`** (the prompt said `url`). We return
    `{ url: session.customerPortalUrl }` to the browser.
- **Subscription fetch** — `polar.subscriptions.get({ id })` exists, but the webhook
  payload already embeds the full `Subscription`, so we usually don't need a refetch.
- **Webhook verify** — `validateEvent(body: string|Buffer, headers: Record<string,
  string>, secret)` from `@polar-sh/sdk/webhooks`; throws `WebhookVerificationError`.
  - ⚠️ The verified payload is `{ type, timestamp, data }` with **no top-level event
    id**. Polar uses Standard Webhooks, so the unique delivery id is the **`webhook-id`
    header** — that's what we store in `PolarWebhookEvent.polarEventId` for idempotency.
- **Status enum** — `incomplete | incomplete_expired | trialing | active | past_due |
  canceled | unpaid`. Subscription carries `trialEnd`, `currentPeriodEnd`,
  `cancelAtPeriodEnd`, `productId`, `customerId`, `customer.externalId`, `metadata`.
- **Order** — carries `status` (`draft|pending|paid|refunded|partially_refunded|void`),
  `paid`, `totalAmount`, `subscriptionId`, `productId`, `customerId`, `metadata`. It
  has **no hosted invoice URL field** (only `invoiceNumber`/`isInvoiceGenerated`), so
  `Invoice.hostedInvoiceUrl` stays null for Polar orders.

### Files Phase 2 will touch
- `apps/api/src/config/env.ts` — boot-time Polar-misconfig warning (E).
- `apps/api/src/app.ts` — add `/billing/polar/webhook` to both carve-outs (C).
- `apps/api/src/routes/billing.ts` — add status `billingProvider`, the 3 Polar routes,
  webhook handler + Polar processEvent/upsert helpers (A,B,C).
- `packages/db/prisma/schema.prisma` — `stripeSubscriptionId String?` (schema gap).
- `packages/db/prisma/migrations/*_polar_subscription_optional/` — **new** migration.
- `apps/web/.../billing/billing-client.tsx` — provider-aware `openPortal` (D).
- `apps/web/.../billing/checkout/[planId]/checkout-client.tsx` + `page.tsx` —
  provider-aware checkout (D).
- `apps/web/.../billing/return/return-client.tsx` + `page.tsx` — handle `checkout_id`
  and confirm via `/billing/status` (D).

### Explicitly NOT in Phase 2
- No Stripe removal; no usage/overage metering reporting yet; no admin UI for trialDays;
  no plan upgrade/downgrade. Those are Phase 3+.

---

## Phase 3 — admin billing controls (ADDITIVE ONLY)

> Constraint check: auth, the Stripe flow, and every existing admin route
> (users/requests/audit, suspend/unsuspend, pilot approval) are untouched. New
> billing-admin routes are added next to them; `logAudit()` is reused exactly as
> today (fire-and-forget, never blocks the action). All money is integer cents.

### A. Bug fix — Invoice list key on user detail
- **`apps/api/src/routes/admin.ts`** — `GET /admin/users/:userId`: also `select`
  `polarOrderId` in the invoices block (both ids returned; one is null per provider).
- **`apps/web/.../admin/users/[userId]/page.tsx`** — `Invoice` type gains
  `polarOrderId: string | null`; list `key` becomes
  `inv.polarOrderId ?? inv.stripeInvoiceId ?? inv.createdAt`.

### B. API — billing stats (`apps/api/src/routes/admin.ts`)
- New `GET /admin/billing/stats`. Counts (all excluding `role: "admin"` users):
  `active`, `trialing`, `past_due`, `canceled`, `suspended` Subscription rows;
  `noSubscription` = Users with no subscription; `mrrCents` = Σ
  `Plan.monthlyPriceUsd` over active subscriptions (rough estimate; ignores
  grandfathered pricing).

### C. API — plan price update (`apps/api/src/routes/admin.ts`)
- New `PATCH /admin/plans/:planId/price`, body `{ monthlyPriceCents }` (Zod:
  positive int). 404 if plan missing. If `polarProductId` is set, update the Polar
  product price; on Polar failure → **502** (don't let the DB run ahead of Polar).
  Update `Plan.monthlyPriceUsd`. `logAudit({ action: "plan_price_changed", ... })`.
  Returns `{ plan: { id, name, monthlyPriceUsd } }`. Comment notes Polar
  grandfathers existing subscribers; only new checkouts pay the new price.

### D. API — trial controls (Polar subs only) (`apps/api/src/routes/admin.ts`)
- `POST /admin/users/:userId/trial/grant`, body `{ days }` (Zod 1–90). Sub must
  exist with `provider="polar"` + `polarSubscriptionId`, else **422**. Sets
  `trialEnd = now + days`. Polar failure → 502. `logAudit("trial_granted")`.
- `POST /admin/users/:userId/trial/end` (no body). Same provider guard. Ends the
  trial immediately. Polar failure → 502. `logAudit("trial_ended")`.

### E. API — orders + refund (Polar only) (`apps/api/src/routes/admin.ts`)
- `GET /admin/users/:userId/orders` — `[]` if no `polarCustomerId`; else last 10
  Polar orders as `[{ id, totalAmount, status, createdAt, productName }]`.
- `POST /admin/users/:userId/refund`, body `{ orderId, amountCents?, reason? }`
  (Zod: orderId required). Verify the order's `customerId` matches the user's
  `polarCustomerId` → **403** otherwise. Refund via Polar; failure → 502.
  `logAudit("refund_issued")`.

### F. Web — admin overview stat cards (`apps/web/.../admin/page.tsx`)
- Fetch `GET /api/admin/billing/stats` alongside the existing four fetches. Add two
  cards after the existing four: **In trial** (`trialing`) and **Past due**
  (`past_due`). The four existing cards (incl. "Active subscriptions" =
  approved-users count) stay unchanged.

### G. Web — new Plans admin page (`apps/web/.../admin/plans/page.tsx`, NEW)
- Fetch `GET /api/billing/plans`. Card per plan (existing card style). Inline price
  editor (dollars input → cents on submit) calling `PATCH
  /api/admin/plans/:planId/price`; inline success/error. Subtle note: "Existing
  subscribers keep their current price. Only new checkouts pay the updated amount."
  No sidebar/nav wiring (done manually later).

### H. Web — user detail billing additions (`apps/web/.../admin/users/[userId]/page.tsx`)
- `UserDetail` type + `GET /admin/users/:userId` response gain
  `subscription.provider` and top-level `polarCustomerId`.
- Trial controls render only when `subscription.provider === "polar"`: "End trial
  now" (confirm) when `status==="trialing"`, plus a "Grant trial" inline form
  (1–90 days, default 14).
- Orders & refund render only when `polarCustomerId` is set: fetch
  `/api/admin/users/:userId/orders`, small table (Amount/Status/Date/Action) with a
  per-paid-order "Refund" button opening an inline form (optional amount in dollars
  = blank → full; optional reason) POSTing to `/refund`.

### I. Admin-shared additions (`apps/web/.../admin-shared.tsx`)
- `auditActionLabel`: `trial_granted`→"Trial granted", `trial_ended`→"Trial ended
  early", `plan_price_changed`→"Plan price changed", `refund_issued`→"Refund issued".
- New `SubscriptionStatusBadge`: active→signal, trialing→amber "Free trial",
  past_due→amber/ink "Past due", suspended→ink "Suspended", canceled→paper "Canceled".

### Polar SDK shapes — verified against `@polar-sh/sdk@0.48.1` (deviations noted)
- **Plan price update is NOT a simple amount field.** `polar.products.update({ id,
  productUpdate: { prices: [{ amountType: "fixed", priceAmount: cents }] } })`
  — the `prices` array **replaces** the product's price list (Polar archives the old
  price; existing subscribers are grandfathered). ⚠️ More involved than "update the
  fixed price amount."
- **Refund requires `amount` AND `reason`.** `polar.refunds.create({ orderId,
  amount, reason, revokeBenefits: false })`. ⚠️ The prompt assumed both optional —
  the SDK makes both required, so: full refund computes `amount = order.totalAmount
  − order.refundedAmount`, and a missing reason defaults to `"customer_request"`
  (enum: duplicate | fraudulent | customer_request | service_disruption |
  satisfaction_guarantee | dispute_prevention | other).
- **Trial update.** `polar.subscriptions.update({ id, subscriptionUpdate: {
  trialEnd: Date } })`. ⚠️ The API doc mentions a literal `"now"` to end immediately,
  but the SDK types `trialEnd` as `Date | null`, so end-trial passes `new Date()`.
- **Orders list.** `polar.orders.list({ customerId, limit: 10 })`; the awaited
  result is the page object → `res.result.items: Order[]`. Order carries
  `totalAmount`, `refundedAmount`, `status`, `createdAt`, `customerId`,
  `product.name`.

### Files Phase 3 will touch
- `apps/api/src/routes/admin.ts` — invoice select fix; new billing/plan/trial/order
  /refund routes; provider + polarCustomerId in user detail. (+ imports: `z`, `polar`.)
- `apps/web/src/app/(admin)/admin/page.tsx` — 2 new stat cards.
- `apps/web/src/app/(admin)/admin/plans/page.tsx` — **new** plans page.
- `apps/web/src/app/(admin)/admin/users/[userId]/page.tsx` — invoice key fix; trial
  controls; orders & refund section; type additions.
- `apps/web/src/app/(admin)/admin-shared.tsx` — audit labels + `SubscriptionStatusBadge`.
- `POLAR_MIGRATION_PLAN.md` — this section.

### Explicitly NOT in Phase 3
- No schema/migration changes; no Stripe removal; no usage/overage metering; no admin
  sidebar nav wiring; no Stripe-side equivalents of the trial/refund controls.
</content>
</invoke>
