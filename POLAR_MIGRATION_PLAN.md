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
</content>
</invoke>
