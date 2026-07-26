-- Multi PayPal accounts + Razorpay accounts per shop

-- PayPalConnection: drop 1:1 unique, add label + isDefault
ALTER TABLE "PayPalConnection" DROP CONSTRAINT IF EXISTS "PayPalConnection_shopId_key";

ALTER TABLE "PayPalConnection" ADD COLUMN IF NOT EXISTS "label" TEXT NOT NULL DEFAULT 'PayPal';
ALTER TABLE "PayPalConnection" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows become the default account for their shop
UPDATE "PayPalConnection" SET "isDefault" = true, "label" = 'PayPal' WHERE "isDefault" = false OR "label" IS NULL OR "label" = '';

CREATE INDEX IF NOT EXISTS "PayPalConnection_shopId_idx" ON "PayPalConnection"("shopId");
CREATE INDEX IF NOT EXISTS "PayPalConnection_shopId_isDefault_idx" ON "PayPalConnection"("shopId", "isDefault");

CREATE TABLE IF NOT EXISTS "RazorpayConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Razorpay',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "encryptedKeyId" TEXT NOT NULL,
    "encryptedKeySecret" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RazorpayConnection_shopId_idx" ON "RazorpayConnection"("shopId");
CREATE INDEX IF NOT EXISTS "RazorpayConnection_shopId_isDefault_idx" ON "RazorpayConnection"("shopId", "isDefault");

DO $$ BEGIN
  ALTER TABLE "RazorpayConnection"
    ADD CONSTRAINT "RazorpayConnection_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
