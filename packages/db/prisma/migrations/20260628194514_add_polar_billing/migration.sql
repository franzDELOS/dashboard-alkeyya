-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "polarOrderId" TEXT,
ALTER COLUMN "stripeInvoiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "includedCalls" INTEGER,
ADD COLUMN     "overageUnitCents" INTEGER,
ADD COLUMN     "polarMeterId" TEXT,
ADD COLUMN     "polarProductId" TEXT,
ALTER COLUMN "stripeProductId" DROP NOT NULL,
ALTER COLUMN "stripePriceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "polarSubscriptionId" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'stripe';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "polarCustomerId" TEXT;

-- CreateTable
CREATE TABLE "PolarWebhookEvent" (
    "id" TEXT NOT NULL,
    "polarEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolarWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingConfig" (
    "id" TEXT NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolarWebhookEvent_polarEventId_key" ON "PolarWebhookEvent"("polarEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_polarOrderId_key" ON "Invoice"("polarOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_polarProductId_key" ON "Plan"("polarProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_polarSubscriptionId_key" ON "Subscription"("polarSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_polarCustomerId_key" ON "User"("polarCustomerId");

