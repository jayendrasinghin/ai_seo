/**
 * Shared webhook → OrderSync ingest (used by HTTP webhook handler and BullMQ worker).
 */
import shopify from "../shopify.server";
import {
  fetchOrder,
  fulfillmentGidFromWebhook,
  orderGidFromWebhook,
} from "../clients/shopify/graphql";
import { processOrder } from "../services/order-processor";
import { processFulfillment } from "../services/fulfillment-processor";
import { logger } from "./logger";

export function normalizeWebhookTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/_/g, "/");
}

/**
 * Process an order/fulfillment/refund webhook immediately so PaySync Orders
 * updates without waiting for the background worker.
 */
export async function ingestWebhookPayload(input: {
  shopDomain: string;
  topic: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const normalizedTopic = normalizeWebhookTopic(input.topic);
  const { admin } = await shopify.unauthenticated.admin(input.shopDomain);

  if (normalizedTopic.startsWith("orders/")) {
    const orderGid = orderGidFromWebhook(
      input.payload as { admin_graphql_api_id?: string; id?: number },
    );
    const order = await fetchOrder(admin, orderGid);
    if (!order) {
      logger.warn({ orderGid }, "Webhook order not found in Shopify");
      return;
    }
    await processOrder(admin, input.shopDomain, order);
    if (order.fulfillments.length > 0) {
      await processFulfillment(admin, input.shopDomain, order);
    }
    logger.info(
      { shopDomain: input.shopDomain, orderGid, topic: normalizedTopic },
      "Order webhook ingested inline",
    );
    return;
  }

  if (normalizedTopic.startsWith("fulfillments/")) {
    const fulfillmentGid = fulfillmentGidFromWebhook(
      input.payload as { admin_graphql_api_id?: string; id?: number },
    );
    const orderId = (input.payload as { order_id?: number }).order_id;
    const orderGid = orderId
      ? `gid://shopify/Order/${orderId}`
      : (input.payload as { order?: { admin_graphql_api_id?: string } }).order
          ?.admin_graphql_api_id;
    if (!orderGid) {
      logger.warn({ topic: normalizedTopic }, "Fulfillment webhook missing order id");
      return;
    }
    const order = await fetchOrder(admin, orderGid);
    if (!order) {
      logger.warn({ orderGid }, "Fulfillment webhook order not found");
      return;
    }
    await processFulfillment(
      admin,
      input.shopDomain,
      order,
      fulfillmentGid,
    );
    return;
  }

  if (normalizedTopic === "refunds/create") {
    const orderId = (input.payload as { order_id?: number }).order_id;
    if (!orderId) return;
    const orderGid = `gid://shopify/Order/${orderId}`;
    const order = await fetchOrder(admin, orderGid);
    if (!order) return;
    await processOrder(admin, input.shopDomain, order);
    return;
  }

  logger.warn(
    { topic: input.topic, normalizedTopic, shopDomain: input.shopDomain },
    "Unhandled webhook topic",
  );
}
