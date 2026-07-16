-- CreateTable
CREATE TABLE "SupportApp" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminOtpChallenge" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "SupportMessage" ADD COLUMN "appId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupportApp_slug_key" ON "SupportApp"("slug");

-- CreateIndex
CREATE INDEX "AdminOtpChallenge_adminUserId_expiresAt_idx" ON "AdminOtpChallenge"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "SupportMessage_appId_createdAt_idx" ON "SupportMessage"("appId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SupportMessage_status_createdAt_idx" ON "SupportMessage"("status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SupportApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminOtpChallenge" ADD CONSTRAINT "AdminOtpChallenge_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default apps
INSERT INTO "SupportApp" ("id", "slug", "name", "description", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('app_seoi', 'seoi', 'Product Image SEO Optimizer', 'AI product SEO & image optimization (seoi.in)', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('app_cod_guard', 'cod-guard-otp', 'COD Guard OTP', 'COD verification / OTP protection', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('app_pay_sync', 'pay-sync', 'Pay Sync', 'Payment sync support', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('app_store_pilot', 'store-pilot-ai', 'Store Pilot AI', 'Store pilot AI support', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Backfill existing messages onto SEOI
UPDATE "SupportMessage" SET "appId" = 'app_seoi' WHERE "appId" IS NULL;
UPDATE "SupportMessage" SET "status" = CASE WHEN "reply" IS NOT NULL AND "reply" <> '' THEN 'replied' ELSE 'open' END;
