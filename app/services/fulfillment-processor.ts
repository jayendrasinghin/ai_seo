import type { SyncStatus } from "@prisma/client";
import {
  addTags,
  removeTags,
  setOrderMetafields,
  type ShopifyAdminGraphQL,
  type ShopifyOrder,
} from "../clients/shopify/graphql";
import { getEnv } from "../lib/env";
import { createChildLogger } from "../lib/logger";
import {
  orderSyncRepository,
  paypalConnectionRepository,
  shipmentSyncRepository,
  shopRepository,
} from "../repositories";
import { normalizeCarrier } from "./carrier";
import { resolvePayPalOrderId } from "./mapping";
import { buildOrderTags, computeTagChanges, parseTags } from "./tags";
import { enqueuePayPalTrackingJob } from "../jobs/queues";

const log = createChildLogger({ service: "fulfillment-processor" });

export async function processFulfillment(
  admin: ShopifyAdminGraphQL,
  shopDomain: string,
  order: ShopifyOrder,
  fulfillmentGid?: string,
): Promise<void> {
  const shop = await shopRepository.upsertByDomain(shopDomain);
  const settings = await shopRepository.getOrCreateSettings(shop.id);
  const carrierMappings = (settings.carrierMappings ?? {}) as Record<
    string,
    string
  >;

  const orderSync = await orderSyncRepository.findByShopifyGid(
    shop.id,
    order.id,
  );
  if (!orderSync) {
    log.warn({ orderId: order.id }, "Order sync record not found");
    return;
  }

  const fulfillments = fulfillmentGid
    ? order.fulfillments.filter((f) => f.id === fulfillmentGid)
    : order.fulfillments;

  let overallSyncStatus: SyncStatus = orderSync.syncStatus;
  let needsMapping = false;

  for (const fulfillment of fulfillments) {
    for (const tracking of fulfillment.trackingInfo) {
      if (!tracking.number?.trim()) continue;

      const normalized = normalizeCarrier(tracking.company, carrierMappings);
      const shipment = await shipmentSyncRepository.upsert({
        orderSyncId: orderSync.id,
        shopifyFulfillmentGid: fulfillment.id,
        trackingNumber: tracking.number.trim(),
        carrier: normalized.carrier,
        carrierRaw: tracking.company,
        shipmentStatus: "pending",
        syncStatus: "pending",
      });

      if (orderSync.paymentProvider !== "paypal") {
        await shipmentSyncRepository.updateSyncState(shipment.id, {
          syncStatus: "not_applicable",
          syncedAt: new Date(),
        });
        continue;
      }

      if (!getEnv().PAYPAL_TRACKING_ENABLED) {
        await shipmentSyncRepository.updateSyncState(shipment.id, {
          syncStatus: "not_applicable",
        });
        continue;
      }

      const paypalConnection = await paypalConnectionRepository.findByShopId(
        shop.id,
      );
      if (!paypalConnection) {
        await shipmentSyncRepository.updateSyncState(shipment.id, {
          syncStatus: "needs_mapping",
          lastError: "PayPal is not connected",
        });
        needsMapping = true;
        overallSyncStatus = "needs_mapping";
        continue;
      }

      const mapping = await resolvePayPalOrderId(
        shop.id,
        order.id,
        order.transactions,
        { shopId: shop.id },
      );

      if (!mapping.providerOrderId) {
        await shipmentSyncRepository.updateSyncState(shipment.id, {
          syncStatus: "needs_mapping",
          lastError:
            "PayPal order mapping is required before we can send this shipment.",
        });
        needsMapping = true;
        overallSyncStatus = "needs_mapping";
        continue;
      }

      await shipmentSyncRepository.updateSyncState(shipment.id, {
        syncStatus: "queued",
      });

      const lineItems = fulfillment.fulfillmentLineItems.edges.map((e) => ({
        name: e.node.lineItem.name,
        sku: e.node.lineItem.sku ?? undefined,
        quantity: e.node.quantity,
      }));

      await enqueuePayPalTrackingJob({
        shipmentSyncId: shipment.id,
        shopDomain,
        shopifyOrderGid: order.id,
        paypalOrderId: mapping.providerOrderId,
        trackingNumber: tracking.number.trim(),
        carrier: normalized.carrier,
        carrierNameOther: normalized.carrierNameOther,
        notifyBuyer: settings.notifyBuyerDefault,
        lineItems,
      });
    }
  }

  const updatedFulfillmentStatus = (
    order.displayFulfillmentStatus ?? "unfulfilled"
  ).toLowerCase();

  await orderSyncRepository.upsert({
    shopId: shop.id,
    shopifyOrderGid: order.id,
    shopifyOrderName: order.name,
    paymentProvider: orderSync.paymentProvider,
    paymentStatus: orderSync.paymentStatus,
    fulfillmentStatus: updatedFulfillmentStatus,
    trackingStatus: needsMapping ? "pending" : "pending",
    syncStatus: overallSyncStatus,
    lastSyncedAt: new Date(),
  });

  if (settings.autoTaggingEnabled) {
    const tagsValue = Array.isArray(order.tags)
      ? order.tags.join(", ")
      : String(order.tags ?? "");
    const currentTags = parseTags(tagsValue);
    const tagPlan = buildOrderTags({
      paymentProvider: orderSync.paymentProvider,
      paymentStatus: orderSync.paymentStatus,
      trackingMissing: false,
      syncStatus: overallSyncStatus,
      partialShipment: updatedFulfillmentStatus === "partial",
    });
    const { toAdd, toRemove } = computeTagChanges(currentTags, tagPlan);
    await addTags(admin, order.id, toAdd);
    await removeTags(admin, order.id, toRemove);
  }

  await setOrderMetafields(admin, order.id, {
    tracking_status: "pending",
    sync_status: overallSyncStatus,
    last_synced_at: new Date().toISOString(),
    last_error: needsMapping
      ? "PayPal order mapping is required before we can send this shipment."
      : "",
  });

  log.info(
    { shopDomain, orderId: order.id, syncStatus: overallSyncStatus },
    "Fulfillment processed",
  );
}
