import { enqueueOrderJob } from "../jobs/queues";
import { createChildLogger } from "../lib/logger";
import { orderSyncRepository } from "../repositories";
import { resolvePayPalOrderId } from "./mapping";

const log = createChildLogger({ service: "auto-reprocess" });

/** After auto-mapping, re-run fulfillment sync for orders stuck in needs_mapping. */
export async function autoReprocessOrderIfMapped(
  shopId: string,
  shopDomain: string,
  shopifyOrderGid: string,
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
): Promise<boolean> {
  const mapping = await resolvePayPalOrderId(shopId, shopifyOrderGid, transactions, {
    shopId,
  });

  if (!mapping.providerOrderId) return false;

  const orderSync = await orderSyncRepository.findByShopifyGid(shopId, shopifyOrderGid);
  const needsReprocess =
    orderSync?.syncStatus === "needs_mapping" ||
    orderSync?.shipments.some((s) =>
      ["needs_mapping", "pending", "failed"].includes(s.syncStatus),
    );

  if (!needsReprocess && orderSync?.fulfillmentStatus === "fulfilled") {
    await enqueueOrderJob({
      shopDomain,
      orderGid: shopifyOrderGid,
      topic: "fulfillments/create",
    });
    log.info({ shopifyOrderGid }, "Queued fulfillment reprocess after auto-map");
    return true;
  }

  if (needsReprocess) {
    await enqueueOrderJob({
      shopDomain,
      orderGid: shopifyOrderGid,
      topic: "fulfillments/create",
    });
    log.info({ shopifyOrderGid }, "Re-queued shipments after auto-map");
    return true;
  }

  return false;
}
