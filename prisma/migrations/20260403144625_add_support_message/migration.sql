-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contactEmail" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportMessage_shop_createdAt_idx" ON "SupportMessage"("shop", "createdAt" DESC);
