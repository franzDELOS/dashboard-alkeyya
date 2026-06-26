// Seed the three fixed billing plans (Starter, Premium, Growth).
//
// Real Stripe Product/Price IDs are never hardcoded in source — they come from
// environment variables so the same seed runs against test-mode and live-mode
// Stripe accounts. Prices and feature lists ARE defined here (they're product
// copy, not secrets) and upserted by plan name so re-running is idempotent.
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

/** Read a required env var or collect it into the missing list. */
const missing: string[] = [];
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    missing.push(name);
    return "";
  }
  return value;
}

type PlanSeed = {
  name: string;
  stripeProductId: string;
  stripePriceId: string;
  monthlyPriceUsd: number; // cents
  features: string[];
};

const plans: PlanSeed[] = [
  {
    name: "Starter",
    stripeProductId: required("STRIPE_STARTER_PRODUCT_ID"),
    stripePriceId: required("STRIPE_STARTER_PRICE_ID"),
    monthlyPriceUsd: 9900,
    features: [
      "1 phone number",
      "Business hours call handling",
      "Email notifications",
      "Up to 100 calls/month",
    ],
  },
  {
    name: "Premium",
    stripeProductId: required("STRIPE_PREMIUM_PRODUCT_ID"),
    stripePriceId: required("STRIPE_PREMIUM_PRICE_ID"),
    monthlyPriceUsd: 19900,
    features: [
      "1 phone number",
      "24/7 call handling",
      "SMS + email notifications",
      "Up to 500 calls/month",
      "Appointment booking integration",
    ],
  },
  {
    name: "Growth",
    stripeProductId: required("STRIPE_GROWTH_PRODUCT_ID"),
    stripePriceId: required("STRIPE_GROWTH_PRICE_ID"),
    monthlyPriceUsd: 39900,
    features: [
      "Up to 3 phone numbers",
      "24/7 call handling",
      "SMS + email notifications",
      "Unlimited calls",
      "Appointment booking integration",
      "Priority support",
    ],
  },
];

if (missing.length > 0) {
  console.error(
    "Cannot seed plans — missing required Stripe env vars:\n  " +
      missing.join("\n  ") +
      "\nSet these in the root .env (see .env.example) and re-run."
  );
  process.exit(1);
}

async function main() {
  for (const plan of plans) {
    const row = await prisma.plan.upsert({
      where: { name: plan.name },
      update: {
        stripeProductId: plan.stripeProductId,
        stripePriceId: plan.stripePriceId,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        features: plan.features,
        isActive: true,
      },
      create: plan,
    });
    console.log(`Seeded plan: ${row.name} ($${row.monthlyPriceUsd / 100}/mo)`);
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
