-- AlterTable
ALTER TABLE "OrderSync" ADD COLUMN IF NOT EXISTS "shopifyCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderSync_shopifyCreatedAt_idx" ON "OrderSync"("shopifyCreatedAt");
