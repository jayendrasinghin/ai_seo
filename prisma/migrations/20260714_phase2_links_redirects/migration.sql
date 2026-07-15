-- AlterTable
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "autoRedirectOnDelete" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "autoRedirectTarget" TEXT NOT NULL DEFAULT '/collections/all';

-- CreateTable
CREATE TABLE IF NOT EXISTS "LinkScanRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "urlsChecked" INTEGER NOT NULL DEFAULT 0,
    "brokenCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "LinkScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BrokenLinkIssue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceTitle" TEXT,
    "sourceUrl" TEXT,
    "linkUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "finalUrl" TEXT,
    "redirectCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokenLinkIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductDeleteRedirect" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDeleteRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LinkScanRun_shop_startedAt_idx" ON "LinkScanRun"("shop", "startedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BrokenLinkIssue_shop_scanRunId_idx" ON "BrokenLinkIssue"("shop", "scanRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BrokenLinkIssue_shop_status_idx" ON "BrokenLinkIssue"("shop", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductDeleteRedirect_shop_createdAt_idx" ON "ProductDeleteRedirect"("shop", "createdAt" DESC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "BrokenLinkIssue" ADD CONSTRAINT "BrokenLinkIssue_scanRunId_fkey"
    FOREIGN KEY ("scanRunId") REFERENCES "LinkScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
