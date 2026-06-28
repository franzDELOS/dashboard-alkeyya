// Seed the three fixed billing plans (Starter, Growth, Premium).
//
// Real Stripe/Polar Product/Price IDs are never hardcoded in source — they come
// from environment variables so the same seed runs against test/sandbox and
// live accounts. Prices, included-call allowances, overage pricing, and feature
// lists ARE defined here (they're product copy/config, not secrets) and upserted
// by plan name so re-running is idempotent.
//
// Migration note: billing is moving from Stripe to Polar (Merchant of Record).
// During the migration this seed populates BOTH provider id sets, but neither is
// required — a plan is seeded with whichever ids are present in the environment
// (or none yet, before the Polar products exist). Phase 2 will tighten this.
//
// Env lives in the monorepo root .env (same file the API loads), so we load it
// explicitly here rather than relying on Prisma's CWD-relative .env discovery.

// `import "dotenv/config"` MUST be the first import. Static imports are hoisted
// and evaluated in declaration order before any inline code runs, so loading the
// environment here guarantees DATABASE_URL is populated before "../src/index.js"
// evaluates src/client.ts (which constructs the PrismaClient from process.env).
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { prisma } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

/** Read an optional env var, returning undefined when unset/empty. Stripe and
 *  Polar ids are all optional during the migration: a plan is seeded with
 *  whichever ids exist in the environment. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

type PlanSeed = {
  name: string;
  monthlyPriceUsd: number; // cents
  includedCalls: number | null; // null = unlimited
  overageUnitCents: number | null; // cents per overage call; null = no overage
  features: string[];
  stripeProductId?: string;
  stripePriceId?: string;
  polarProductId?: string;
};

// Live pricing from alkeyya.com/pricing (cents). Call-count feature bullets are
// intentionally omitted here — the allowance lives in includedCalls/overage.
const plans: PlanSeed[] = [
  {
    name: "Starter",
    monthlyPriceUsd: 3900,
    includedCalls: 35,
    overageUnitCents: 49,
    features: [
      "1 phone number",
      "Business hours call handling",
      "Email notifications",
    ],
    stripeProductId: optional("STRIPE_STARTER_PRODUCT_ID"),
    stripePriceId: optional("STRIPE_STARTER_PRICE_ID"),
    polarProductId: optional("POLAR_STARTER_PRODUCT_ID"),
  },
  {
    name: "Growth",
    monthlyPriceUsd: 6900,
    includedCalls: 100,
    overageUnitCents: 49,
    features: [
      "Up to 3 phone numbers",
      "24/7 call handling",
      "SMS + email notifications",
      "Appointment booking integration",
      "Priority support",
    ],
    stripeProductId: optional("STRIPE_GROWTH_PRODUCT_ID"),
    stripePriceId: optional("STRIPE_GROWTH_PRICE_ID"),
    polarProductId: optional("POLAR_GROWTH_PRODUCT_ID"),
  },
  {
    name: "Premium",
    monthlyPriceUsd: 9900,
    includedCalls: null, // unlimited
    overageUnitCents: null, // no overage
    features: [
      "1 phone number",
      "24/7 call handling",
      "SMS + email notifications",
      "Appointment booking integration",
    ],
    stripeProductId: optional("STRIPE_PREMIUM_PRODUCT_ID"),
    stripePriceId: optional("STRIPE_PREMIUM_PRICE_ID"),
    polarProductId: optional("POLAR_PREMIUM_PRODUCT_ID"),
  },
];

async function main() {
  for (const plan of plans) {
    // Only write provider ids that are actually present, so re-running before
    // Polar products (or Stripe products) exist doesn't blank out a set id.
    const data = {
      monthlyPriceUsd: plan.monthlyPriceUsd,
      includedCalls: plan.includedCalls,
      overageUnitCents: plan.overageUnitCents,
      features: plan.features,
      isActive: true,
      ...(plan.stripeProductId ? { stripeProductId: plan.stripeProductId } : {}),
      ...(plan.stripePriceId ? { stripePriceId: plan.stripePriceId } : {}),
      ...(plan.polarProductId ? { polarProductId: plan.polarProductId } : {}),
    };

    const row = await prisma.plan.upsert({
      where: { name: plan.name },
      update: data,
      create: { name: plan.name, ...data },
    });
    const allowance =
      row.includedCalls === null ? "unlimited" : `${row.includedCalls} calls`;
    console.log(
      `Seeded plan: ${row.name} ($${row.monthlyPriceUsd / 100}/mo, ${allowance})`
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
