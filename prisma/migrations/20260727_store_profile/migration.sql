-- CreateTable
CREATE TABLE "StoreProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "storeName" TEXT,
    "primaryDomain" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "currency" TEXT,
    "planDisplayName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreProfile_shop_key" ON "StoreProfile"("shop");
