-- CreateTable
CREATE TABLE "SeoSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "indexNowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "indexNowKey" TEXT,
    "indexNowAutoPing" BOOLEAN NOT NULL DEFAULT true,
    "sitemapEnabled" BOOLEAN NOT NULL DEFAULT true,
    "llmsTxtEnabled" BOOLEAN NOT NULL DEFAULT true,
    "llmsTxtCustom" TEXT,
    "jsonLdEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexNowLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexNowLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoSettings_shop_key" ON "SeoSettings"("shop");

-- CreateIndex
CREATE INDEX "IndexNowLog_shop_createdAt_idx" ON "IndexNowLog"("shop", "createdAt" DESC);
