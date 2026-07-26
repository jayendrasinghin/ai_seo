import { PayPalClient } from "../clients/paypal/client";
import { DomainError } from "../lib/errors";
import { createChildLogger } from "../lib/logger";
import { classifyRetry } from "../lib/retry";
import { safeSummary } from "../lib/redaction";
import {
  addTags,
  removeTags,
  setOrderMetafields,
} from "../clients/shopify/graphql";
import shopify from "../shopify.server";
import {
  orderSyncRepository,
  paypalConnectionRepository,
  shipmentSyncRepository,
  syncAttemptRepository,
} from "../repositories";
import { buildOrderTags, computeTagChanges } from "./tags";
import { correlationId } from "../lib/hash";

const log = createChildLogger({ service: "paypal-sync" });

export interface PayPalTrackingJobData {
  shipmentSyncId: string;
  shopDomain: string;
  shopifyOrderGid: string;
  paypalOrderId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
  notifyBuyer: boolean;
  lineItems: Array<{ name: string; sku?: string; quantity: number }>;
}

export async function executePayPalTrackingSync(
  data: PayPalTrackingJobData,
): Promise<void> {
  const corrId = correlationId();
  const shipment = await shipmentSyncRepository.findById(data.shipmentSyncId);
  if (!shipment) {
    throw new DomainError("NOT_FOUND");
  }

  if (shipment.syncStatus === "synced") {
    log.info({ shipmentSyncId: data.shipmentSyncId }, "Already synced, skipping");
    return;
  }

  const shop = shipment.orderSync.shop;
  const connection = await paypalConnectionRepository.findByShopId(shop.id);
  if (!connection) {
    throw new DomainError("PAYPAL_NOT_CONNECTED");
  }

  if (!data.paypalOrderId) {
    throw new DomainError("PAYPAL_MAPPING_MISSING");
  }

  const client = PayPalClient.fromEncrypted(
    shop.id,
    connection.mode,
    connection.encryptedClientId,
    connection.encryptedClientSecret,
  );

  const requestSummary = safeSummary({
    paypalOrderId: data.paypalOrderId,
    trackingNumber: data.trackingNumber,
    carrier: data.carrier,
    notifyBuyer: data.notifyBuyer,
    itemCount: data.lineItems.length,
  });

  try {
    const result = await client.addTrackingToOrder(data.paypalOrderId, {
      tracking_number: data.trackingNumber,
      carrier: data.carrier,
      carrier_name_other: data.carrierNameOther,
      status: "SHIPPED",
      notify_payer: data.notifyBuyer,
      items: data.lineItems,
    });

    await syncAttemptRepository.create({
      shipmentSyncId: shipment.id,
      provider: "paypal",
      requestSummary,
      responseStatus: result.status,
      responseSummary: result.summary,
      correlationId: corrId,
    });

    await shipmentSyncRepository.updateSyncState(shipment.id, {
      syncStatus: "synced",
      syncedAt: new Date(),
      paypalTrackerId: result.trackerId ?? null,
      lastError: null,
      nextRetryAt: null,
    });

    await orderSyncRepository.upsert({
      shopId: shop.id,
      shopifyOrderGid: data.shopifyOrderGid,
      shopifyOrderName: shipment.orderSync.shopifyOrderName,
      paymentProvider: "paypal",
      paymentStatus: shipment.orderSync.paymentStatus,
      syncStatus: "synced",
      trackingStatus: "synced",
      lastSyncedAt: new Date(),
    });

    await updateShopifyOrderTags(
      data.shopDomain,
      data.shopifyOrderGid,
      "synced",
    );

    log.info(
      { shipmentSyncId: data.shipmentSyncId, correlationId: corrId },
      "PayPal tracking synced",
    );
  } catch (error) {
    const domainError =
      error instanceof DomainError
        ? error
        : new DomainError("SHOPIFY_API_ERROR", { cause: error });

    await syncAttemptRepository.create({
      shipmentSyncId: shipment.id,
      provider: "paypal",
      requestSummary,
      errorCode: domainError.code,
      errorMessage: domainError.message,
      correlationId: corrId,
    });

    const retry = classifyRetry(domainError, shipment.retryCount);

    if (retry.permanent) {
      await shipmentSyncRepository.updateSyncState(shipment.id, {
        syncStatus: "failed_permanent",
        lastError: domainError.message,
        nextRetryAt: null,
      });
      await updateShopifyOrderTags(
        data.shopDomain,
        data.shopifyOrderGid,
        "failed_permanent",
      );
    } else if (retry.shouldRetry) {
      await shipmentSyncRepository.updateSyncState(shipment.id, {
        syncStatus: "retrying",
        retryCount: shipment.retryCount + 1,
        nextRetryAt: retry.nextRetryAt,
        lastError: domainError.message,
      });
    } else {
      await shipmentSyncRepository.updateSyncState(shipment.id, {
        syncStatus: "failed",
        lastError: domainError.message,
        nextRetryAt: null,
      });
      await updateShopifyOrderTags(
        data.shopDomain,
        data.shopifyOrderGid,
        "failed",
      );
    }

    throw domainError;
  }
}

async function updateShopifyOrderTags(
  shopDomain: string,
  orderGid: string,
  syncStatus: string,
): Promise<void> {
  try {
    const { admin } = await shopify.unauthenticated.admin(shopDomain);
    const tagPlan = buildOrderTags({
      paymentProvider: "paypal",
      paymentStatus: "paid",
      trackingMissing: false,
      syncStatus,
    });
    const { toAdd, toRemove } = computeTagChanges(new Set(), tagPlan);
    await addTags(admin, orderGid, toAdd);
    await removeTags(admin, orderGid, toRemove);
    await setOrderMetafields(admin, orderGid, {
      sync_status: syncStatus,
      tracking_status: syncStatus === "synced" ? "synced" : "pending",
      last_synced_at: new Date().toISOString(),
    });
  } catch (error) {
    log.warn({ error, shopDomain, orderGid }, "Failed to update Shopify tags");
  }
}

export async function retryShipmentSync(shipmentSyncId: string): Promise<void> {
  const shipment = await shipmentSyncRepository.findById(shipmentSyncId);
  if (!shipment) throw new DomainError("NOT_FOUND");

  const mapping = shipment.orderSync.providerOrderId;
  if (!mapping) throw new DomainError("PAYPAL_MAPPING_MISSING");

  const shop = shipment.orderSync.shop;
  const settings = await import("../repositories").then((r) =>
    r.shopRepository.getOrCreateSettings(shop.id),
  );

  await shipmentSyncRepository.updateSyncState(shipment.id, {
    syncStatus: "queued",
    nextRetryAt: null,
  });

  const { enqueuePayPalTrackingJob } = await import("../jobs/queues");
  await enqueuePayPalTrackingJob({
    shipmentSyncId: shipment.id,
    shopDomain: shop.shopDomain,
    shopifyOrderGid: shipment.orderSync.shopifyOrderGid,
    paypalOrderId: mapping,
    trackingNumber: shipment.trackingNumber,
    carrier: shipment.carrier,
    carrierNameOther: shipment.carrierRaw ?? undefined,
    notifyBuyer: (await settings).notifyBuyerDefault,
    lineItems: [{ name: "Order item", quantity: 1 }],
  });
}
