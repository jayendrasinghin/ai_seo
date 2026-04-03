-- CreateTable
CREATE TABLE "StoreUsage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "usedCredits" INTEGER NOT NULL DEFAULT 0,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreUsage_shop_key" ON "StoreUsage"("shop");
