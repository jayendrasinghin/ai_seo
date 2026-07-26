import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { payloadHash } from "../lib/hash";
import type { PayPalTrackingJobData } from "../services/paypal-sync";

export const QUEUE_NAMES = {
  WEBHOOK: "paysync-webhooks",
  ORDER: "paysync-orders",
  PAYPAL_TRACKING: "paysync-paypal-tracking",
  HISTORICAL: "paysync-historical",
} as const;

let connection: ConnectionOptions | null = null;

export function getRedisConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  }
  return connection;
}

function createQueue(name: string): Queue {
  return new Queue(name, { connection: getRedisConnection() });
}

export const webhookQueue = createQueue(QUEUE_NAMES.WEBHOOK);
export const orderQueue = createQueue(QUEUE_NAMES.ORDER);
export const paypalTrackingQueue = createQueue(QUEUE_NAMES.PAYPAL_TRACKING);
export const historicalQueue = createQueue(QUEUE_NAMES.HISTORICAL);

export interface WebhookJobData {
  webhookEventId: string;
  shopDomain: string;
  topic: string;
  payload: Record<string, unknown>;
}

export interface OrderJobData {
  shopDomain: string;
  orderGid: string;
  topic: string;
  fulfillmentGid?: string;
}

export async function enqueueWebhookJob(data: WebhookJobData): Promise<void> {
  const jobId = data.webhookEventId;
  await webhookQueue.add("process-webhook", data, {
    jobId,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });
}

export async function enqueueOrderJob(data: OrderJobData): Promise<void> {
  const jobId = `${data.topic}:${data.orderGid}:${data.fulfillmentGid ?? "all"}`;
  await orderQueue.add("process-order", data, {
    jobId: payloadHash(jobId),
    removeOnComplete: 200,
    removeOnFail: 500,
    attempts: 5,
    backoff: { type: "exponential", delay: 10000 },
  });
}

export interface HistoricalSyncJobData {
  shopDomain: string;
  sinceIso: string;
  cursor: string | null;
}

export async function enqueueHistoricalSyncJob(
  data: HistoricalSyncJobData,
): Promise<void> {
  const jobId = `historical:${data.shopDomain}:${data.sinceIso}:${data.cursor ?? "start"}`;
  await historicalQueue.add("sync-historical", data, {
    jobId: payloadHash(jobId),
    removeOnComplete: 50,
    removeOnFail: 100,
  });
}

export async function enqueuePayPalTrackingJob(
  data: PayPalTrackingJobData,
): Promise<void> {
  const jobId = `paypal:${data.shipmentSyncId}:${data.trackingNumber}`;
  await paypalTrackingQueue.add("sync-tracking", data, {
    jobId: payloadHash(jobId),
    removeOnComplete: 200,
    removeOnFail: 500,
    attempts: 6,
    backoff: {
      type: "custom",
    },
  });
}

const RETRY_BACKOFF = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

export function getPayPalBackoff(attemptsMade: number): number {
  return RETRY_BACKOFF[Math.min(attemptsMade, RETRY_BACKOFF.length - 1)] ?? 43_200_000;
}

export type JobProcessor<T> = (job: Job<T>) => Promise<void>;

export function createWorker<T>(
  queueName: string,
  processor: JobProcessor<T>,
): Worker<T> {
  const worker = new Worker<T>(
    queueName,
    async (job) => {
      logger.info({ jobId: job.id, queue: queueName }, "Processing job");
      await processor(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        queue: queueName,
        error: err?.message ?? String(err),
        stack: err?.stack,
        attemptsMade: job?.attemptsMade,
        data: job?.data,
      },
      "Job failed",
    );
  });

  worker.on("error", (err) => {
    logger.error(
      { queue: queueName, error: err.message, stack: err.stack },
      "Worker error",
    );
  });

  return worker;
}
