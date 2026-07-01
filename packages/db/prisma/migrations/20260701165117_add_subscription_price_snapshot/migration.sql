-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "priceUsdAtSubscription" INTEGER;

-- Backfill: seed existing subscriptions with their plan's CURRENT price. This is
-- best-effort — we have no historical price data, so any subscriber who was
-- grandfathered by Polar onto an older amount before this column existed will be
-- backfilled at today's list price rather than their true original price.
-- Going forward the snapshot is captured accurately at subscription-creation time.
UPDATE "Subscription" AS s
SET "priceUsdAtSubscription" = p."monthlyPriceUsd"
FROM "Plan" AS p
WHERE s."planId" = p."id"
  AND s."priceUsdAtSubscription" IS NULL;
