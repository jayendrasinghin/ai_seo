-- CreateTable
CREATE TABLE "ImageScanRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "productsScanned" INTEGER NOT NULL DEFAULT 0,
    "imagesScanned" INTEGER NOT NULL DEFAULT 0,
    "issuesOpen" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ImageScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageSeoIssue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "mediaId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "currentAlt" TEXT,
    "issueType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageSeoIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageScanRun_shop_startedAt_idx" ON "ImageScanRun"("shop", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ImageSeoIssue_shop_scanRunId_idx" ON "ImageSeoIssue"("shop", "scanRunId");

-- CreateIndex
CREATE INDEX "ImageSeoIssue_shop_issueType_idx" ON "ImageSeoIssue"("shop", "issueType");

-- CreateIndex
CREATE INDEX "ImageSeoIssue_shop_productId_idx" ON "ImageSeoIssue"("shop", "productId");

-- AddForeignKey
ALTER TABLE "ImageSeoIssue" ADD CONSTRAINT "ImageSeoIssue_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ImageScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
