-- CreateTable
CREATE TABLE "InventoryReceipt" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "locationIds" TEXT[],
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "referenceUri" TEXT,
    "previousPrice" TEXT,
    "newPrice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantPriceChange" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "oldPrice" TEXT NOT NULL,
    "newPrice" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReceipt_shop_variantId_createdAt_idx" ON "InventoryReceipt"("shop", "variantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VariantPriceChange_shop_variantId_createdAt_idx" ON "VariantPriceChange"("shop", "variantId", "createdAt" DESC);
