import type { PaymentProvider } from "@prisma/client";
import {
  addTags,
  removeTags,
  resolveCustomerName,
  setOrderMetafields,
  summarizeOrderItems,
  type ShopifyAdminGraphQL,
  type ShopifyOrder,
} from "../clients/shopify/graphql";
import { createChildLogger } from "../lib/logger";
import { orderSyncRepository, shopRepository } from "../repositories";
import {
  extractProviderOrderId,
  normalizePaymentStatus,
  resolvePaymentProvider,
} from "./payment-provider";
import { resolvePayPalOrderId } from "./mapping";
import { autoReprocessOrderIfMapped } from "./auto-reprocess";
import { buildOrderTags, computeTagChanges, parseTags } from "./tags";

const log = createChildLogger({ service: "order-processor" });

export async function processOrder(
  admin: ShopifyAdminGraphQL,
  shopDomain: string,
  order: ShopifyOrder,
): Promise<void> {
  const shop = await shopRepository.upsertByDomain(shopDomain);
  const settings = await shopRepository.getOrCreateSettings(shop.id);

  const paymentProvider = resolvePaymentProvider(order);
  const paymentStatus = normalizePaymentStatus(
    order.displayFinancialStatus,
    order.transactions,
  );

  let providerOrderId: string | null = null;
  if (paymentProvider === "paypal") {
    const mapping = await resolvePayPalOrderId(shop.id, order.id, order.transactions, {
      shopId: shop.id,
    });
    providerOrderId = mapping.providerOrderId;
  } else {
    providerOrderId = extractProviderOrderId(paymentProvider, order.transactions);
  }

  const requiresPhysicalShipping = order.lineItems.edges.some(
    (e) => e.node.requiresShipping,
  );
  const isPaid = paymentStatus === "paid";
  const isUnfulfilled =
    (order.displayFulfillmentStatus ?? "").toLowerCase() !== "fulfilled";
  const trackingMissing =
    settings.tagUnfulfilledPhysical &&
    requiresPhysicalShipping &&
    isPaid &&
    isUnfulfilled;

  const itemsSummary = summarizeOrderItems(order);
  const customerName = resolveCustomerName(order);

  const orderSync = await orderSyncRepository.upsert({
    shopId: shop.id,
    shopifyOrderGid: order.id,
    shopifyOrderName: order.name,
    shopifyCreatedAt: order.createdAt ? new Date(order.createdAt) : null,
    ...(customerName ? { customerName } : {}),
    ...(itemsSummary ? { itemsSummary } : {}),
    paymentProvider,
    paymentStatus,
    providerOrderId,
    fulfillmentStatus: (
      order.displayFulfillmentStatus ?? "unfulfilled"
    ).toLowerCase(),
    trackingStatus: trackingMissing ? "missing" : "none",
    syncStatus: paymentProvider === "paypal" ? "pending" : "not_applicable",
    lastSyncedAt: new Date(),
  });

  if (settings.autoTaggingEnabled) {
    const tagsValue = Array.isArray(order.tags)
      ? order.tags.join(", ")
      : String(order.tags ?? "");
    const currentTags = parseTags(tagsValue);
    const tagPlan = buildOrderTags({
      paymentProvider,
      paymentStatus,
      trackingMissing,
      syncStatus: orderSync.syncStatus,
    });
    const { toAdd, toRemove } = computeTagChanges(currentTags, tagPlan);

    await addTags(admin, order.id, toAdd);
    await removeTags(admin, order.id, toRemove);
  }

  await setOrderMetafields(admin, order.id, {
    payment_provider: paymentProvider,
    payment_status: paymentStatus,
    provider_order_id: providerOrderId ?? "",
    provider_capture_id: "",
    tracking_status: trackingMissing ? "missing" : "none",
    sync_status: orderSync.syncStatus,
    last_synced_at: new Date().toISOString(),
    last_error: "",
  });

  log.info(
    { shopDomain, orderId: order.id, paymentProvider, paymentStatus, providerOrderId },
    "Order processed",
  );

  if (paymentProvider === "paypal") {
    if (order.fulfillments.length > 0) {
      await autoReprocessOrderIfMapped(
        shop.id,
        shopDomain,
        order.id,
        order.transactions,
      );
    }
  }
}

export function isPhysicalOrder(order: ShopifyOrder): boolean {
  return order.lineItems.edges.some((e) => e.node.requiresShipping);
}

export function getPaymentProvider(order: ShopifyOrder): PaymentProvider {
  return resolvePaymentProvider(order);
}
