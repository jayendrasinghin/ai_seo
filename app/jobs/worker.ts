import {
  createWorker,
  QUEUE_NAMES,
  type HistoricalSyncJobData,
  type OrderJobData,
  type WebhookJobData,
} from "./queues";
import {
  continueHistoricalSync,
  runHistoricalSyncPage,
} from "../services/historical-sync";
import { webhookEventRepository } from "../repositories";
import { logger } from "../lib/logger";
import { ingestWebhookPayload } from "../lib/ingest-webhook";
import shopify from "../shopify.server";
import { fetchOrder } from "../clients/shopify/graphql";
import { processOrder } from "../services/order-processor";
import { processFulfillment } from "../services/fulfillment-processor";
import {
  executePayPalTrackingSync,
  type PayPalTrackingJobData,
} from "../services/paypal-sync";

async function processWebhookJob(data: WebhookJobData): Promise<void> {
  try {
    await ingestWebhookPayload({
      shopDomain: data.shopDomain,
      topic: data.topic,
      payload: data.payload,
    });
    await webhookEventRepository.markProcessed(data.webhookEventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await webhookEventRepository.markProcessed(data.webhookEventId, message);
    throw error;
  }
}

async function processOrderJob(data: OrderJobData): Promise<void> {
  const { admin } = await shopify.unauthenticated.admin(data.shopDomain);
  const order = await fetchOrder(admin, data.orderGid);
  if (!order) {
    logger.warn({ orderGid: data.orderGid }, "Order not found in Shopify");
    return;
  }

  if (data.topic.includes("fulfillments/") || data.fulfillmentGid) {
    await processFulfillment(
      admin,
      data.shopDomain,
      order,
      data.fulfillmentGid,
    );
  } else {
    await processOrder(admin, data.shopDomain, order);
    if (order.fulfillments.length > 0) {
      await processFulfillment(admin, data.shopDomain, order);
    }
  }
}

async function processHistoricalJob(data: HistoricalSyncJobData): Promise<void> {
  const result = await runHistoricalSyncPage(
    data.shopDomain,
    data.sinceIso,
    data.cursor,
  );
  if (result.hasMore && result.nextCursor) {
    await continueHistoricalSync(data.shopDomain, data.sinceIso, result.nextCursor);
  }
}

logger.info("Starting PaySync workers...");

createWorker<WebhookJobData>(QUEUE_NAMES.WEBHOOK, async (job) => {
  await processWebhookJob(job.data);
});

createWorker<OrderJobData>(QUEUE_NAMES.ORDER, async (job) => {
  await processOrderJob(job.data);
});

createWorker<PayPalTrackingJobData>(
  QUEUE_NAMES.PAYPAL_TRACKING,
  async (job) => {
    try {
      await executePayPalTrackingSync(job.data);
    } catch (error) {
      if (job.attemptsMade < 5) {
        throw error;
      }
      logger.error({ error, jobId: job.id }, "PayPal job exhausted retries");
    }
  },
);

createWorker<HistoricalSyncJobData>(QUEUE_NAMES.HISTORICAL, async (job) => {
  await processHistoricalJob(job.data);
});

logger.info("PaySync workers running");

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down workers");
  process.exit(0);
});
