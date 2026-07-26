-- CreateEnum
CREATE TYPE "PayPalMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('paypal', 'shopify_payments', 'stripe', 'razorpay', 'cashfree', 'cod', 'manual', 'other');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'queued', 'retrying', 'synced', 'needs_mapping', 'not_applicable', 'failed_permanent', 'failed');

-- CreateEnum
CREATE TYPE "MappingSource" AS ENUM ('AUTO', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('received', 'processing', 'processed', 'failed', 'duplicate');

-- DropTable

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "autoTaggingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyBuyerDefault" BOOLEAN NOT NULL DEFAULT true,
    "tagUnfulfilledPhysical" BOOLEAN NOT NULL DEFAULT true,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "carrierMappings" JSONB NOT NULL DEFAULT '{}',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPalConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mode" "PayPalMode" NOT NULL DEFAULT 'SANDBOX',
    "encryptedClientId" TEXT NOT NULL,
    "encryptedClientSecret" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPalConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSync" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "paymentProvider" "PaymentProvider" NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerCaptureId" TEXT,
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'unfulfilled',
    "trackingStatus" TEXT NOT NULL DEFAULT 'none',
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentSync" (
    "id" TEXT NOT NULL,
    "orderSyncId" TEXT NOT NULL,
    "shopifyFulfillmentGid" TEXT,
    "trackingNumber" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "carrierRaw" TEXT,
    "shipmentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paypalTrackerId" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "mappingSource" "MappingSource" NOT NULL DEFAULT 'AUTO',
    "mappedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'received',
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAttempt" (
    "id" TEXT NOT NULL,
    "shipmentSyncId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestSummary" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseSummary" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopId_key" ON "ShopSettings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalConnection_shopId_key" ON "PayPalConnection"("shopId");

-- CreateIndex
CREATE INDEX "OrderSync_shopId_syncStatus_idx" ON "OrderSync"("shopId", "syncStatus");

-- CreateIndex
CREATE INDEX "OrderSync_shopId_paymentProvider_idx" ON "OrderSync"("shopId", "paymentProvider");

-- CreateIndex
CREATE INDEX "OrderSync_updatedAt_idx" ON "OrderSync"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_shopId_shopifyOrderGid_key" ON "OrderSync"("shopId", "shopifyOrderGid");

-- CreateIndex
CREATE INDEX "ShipmentSync_syncStatus_nextRetryAt_idx" ON "ShipmentSync"("syncStatus", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentSync_orderSyncId_trackingNumber_key" ON "ShipmentSync"("orderSyncId", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMapping_shopId_shopifyOrderGid_provider_key" ON "ProviderMapping"("shopId", "shopifyOrderGid", "provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_topic_payloadHash_key" ON "WebhookEvent"("topic", "payloadHash");

-- CreateIndex
CREATE INDEX "SyncAttempt_shipmentSyncId_createdAt_idx" ON "SyncAttempt"("shipmentSyncId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalConnection" ADD CONSTRAINT "PayPalConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSync" ADD CONSTRAINT "OrderSync_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentSync" ADD CONSTRAINT "ShipmentSync_orderSyncId_fkey" FOREIGN KEY ("orderSyncId") REFERENCES "OrderSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMapping" ADD CONSTRAINT "ProviderMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_shipmentSyncId_fkey" FOREIGN KEY ("shipmentSyncId") REFERENCES "ShipmentSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

