-- CreateTable
CREATE TABLE "InventoryAlertSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "alertEmail" TEXT,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER NOT NULL DEFAULT 5,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAlertSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LowStockNotification" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productTitle" TEXT,
    "variantLabel" TEXT,
    "locationName" TEXT,
    "quantity" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LowStockNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAlertSettings_shop_key" ON "InventoryAlertSettings"("shop");

-- CreateIndex
CREATE INDEX "LowStockNotification_shop_notifiedAt_idx" ON "LowStockNotification"("shop", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LowStockNotification_shop_inventoryItemId_locationId_key" ON "LowStockNotification"("shop", "inventoryItemId", "locationId");
