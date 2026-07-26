-- AlterTable
ALTER TABLE "OrderSync" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "OrderSync" ADD COLUMN IF NOT EXISTS "itemsSummary" TEXT;
