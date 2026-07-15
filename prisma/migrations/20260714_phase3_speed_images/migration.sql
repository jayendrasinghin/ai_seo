-- AlterTable SeoSettings Phase 3 columns
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "lazyLoadEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "assetPreloadEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "scriptDeferEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "imageMaxWidth" INTEGER NOT NULL DEFAULT 2048;
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "imageQuality" INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageOptimizeRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "imagesChecked" INTEGER NOT NULL DEFAULT 0,
    "imagesOptimized" INTEGER NOT NULL DEFAULT 0,
    "bytesSaved" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ImageOptimizeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageOptimizeItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "mediaId" TEXT NOT NULL,
    "originalUrl" TEXT,
    "originalBytes" INTEGER,
    "newBytes" INTEGER,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageOptimizeItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImageOptimizeRun_shop_startedAt_idx" ON "ImageOptimizeRun"("shop", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "ImageOptimizeItem_shop_runId_idx" ON "ImageOptimizeItem"("shop", "runId");
CREATE INDEX IF NOT EXISTS "ImageOptimizeItem_shop_mediaId_idx" ON "ImageOptimizeItem"("shop", "mediaId");

DO $$ BEGIN
  ALTER TABLE "ImageOptimizeItem" ADD CONSTRAINT "ImageOptimizeItem_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ImageOptimizeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
