import prisma from "./db.server";

export async function getVariantInventoryHistory(
  shop: string,
  variantId: string,
) {
  const [receipts, priceChanges] = await Promise.all([
    prisma.inventoryReceipt.findMany({
      where: { shop, variantId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.variantPriceChange.findMany({
      where: { shop, variantId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  return { receipts, priceChanges };
}

export async function logInventoryReceipt(input: {
  shop: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;
  mode: string;
  quantity: number;
  locationIds: string[];
  invoiceNumber?: string | null;
  invoiceDate?: Date | null;
  referenceUri?: string | null;
  previousPrice?: string | null;
  newPrice?: string | null;
}) {
  return prisma.inventoryReceipt.create({
    data: {
      shop: input.shop,
      productId: input.productId,
      variantId: input.variantId,
      inventoryItemId: input.inventoryItemId,
      mode: input.mode,
      quantity: input.quantity,
      locationIds: input.locationIds,
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceDate: input.invoiceDate ?? null,
      referenceUri: input.referenceUri ?? null,
      previousPrice: input.previousPrice ?? null,
      newPrice: input.newPrice ?? null,
    },
  });
}

export async function logVariantPriceChange(input: {
  shop: string;
  productId: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
  invoiceNumber?: string | null;
}) {
  return prisma.variantPriceChange.create({
    data: {
      shop: input.shop,
      productId: input.productId,
      variantId: input.variantId,
      oldPrice: input.oldPrice,
      newPrice: input.newPrice,
      invoiceNumber: input.invoiceNumber ?? null,
    },
  });
}
