// Seed the three fixed billing plans (Starter, Growth, Premium).
//
// Prices, included-call allowances, overage pricing, and feature lists are
// defined here (product config, not secrets) and upserted by plan name so
// re-running is idempotent. Polar Product IDs come from POLAR_*_PRODUCT_ID env
// vars; set them before seeding to wire the plans to Polar.
//
// Stripe columns still exist in the schema as historical data but are no longer
// written by this seed — Stripe is retired as of Phase 5.
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

/** Read an optional env var, returning undefined when unset/empty. */
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
    polarProductId: optional("POLAR_PREMIUM_PRODUCT_ID"),
  },
];

async function main() {
  for (const plan of plans) {
    // Only write polarProductId when set, so re-running before Polar products
    // exist doesn't blank out an already-seeded id.
    const data = {
      monthlyPriceUsd: plan.monthlyPriceUsd,
      includedCalls: plan.includedCalls,
      overageUnitCents: plan.overageUnitCents,
      features: plan.features,
      isActive: true,
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
