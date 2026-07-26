import { payloadHash } from "./hash";
import { logger } from "./logger";
import { ingestWebhookPayload } from "./ingest-webhook";
import { enqueueWebhookJob } from "../jobs/queues";
import { shopRepository, webhookEventRepository } from "../repositories";
import shopify from "../shopify.server";

export async function handleShopifyWebhook(
  request: Request,
  topic: string,
): Promise<Response> {
  const { shop, topic: verifiedTopic, payload } =
    await shopify.authenticate.webhook(request);

  const shopRecord = await shopRepository.upsertByDomain(shop);
  const rawBody = JSON.stringify(payload);
  const hash = payloadHash(rawBody);
  const webhookId =
    request.headers.get("X-Shopify-Webhook-Id") ?? undefined;

  const event = await webhookEventRepository.createIfNotExists({
    shopId: shopRecord.id,
    topic: verifiedTopic || topic,
    webhookId,
    payloadHash: webhookId ?? hash,
  });

  if (!event) {
    logger.info({ topic, shop }, "Duplicate webhook ignored");
    return new Response("OK", { status: 200 });
  }

  const resolvedTopic = verifiedTopic || topic;

  // Process immediately so new COD/PayPal orders appear in PaySync without
  // waiting for `npm run worker`. Queue remains a retry fallback.
  try {
    await ingestWebhookPayload({
      shopDomain: shop,
      topic: resolvedTopic,
      payload: payload as Record<string, unknown>,
    });
    await webhookEventRepository.markProcessed(event.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { topic: resolvedTopic, shop, error: message },
      "Inline webhook ingest failed — enqueueing for worker retry",
    );
    try {
      await enqueueWebhookJob({
        webhookEventId: event.id,
        shopDomain: shop,
        topic: resolvedTopic,
        payload: payload as Record<string, unknown>,
      });
    } catch (queueError) {
      await webhookEventRepository.markProcessed(event.id, message);
      logger.error(
        {
          topic: resolvedTopic,
          shop,
          error:
            queueError instanceof Error ? queueError.message : String(queueError),
        },
        "Failed to enqueue webhook after inline failure",
      );
    }
  }

  return new Response("OK", { status: 200 });
}

export async function handleComplianceWebhook(
  request: Request,
): Promise<Response> {
  await shopify.authenticate.webhook(request);
  return new Response("OK", { status: 200 });
}

export function jsonResponse(
  data: unknown,
  status = 200,
): Response {
  return Response.json(data, { status });
}

export async function withAdminAuth(
  request: Request,
  handler: (ctx: {
    shopDomain: string;
    shopId: string;
    session: Awaited<
      ReturnType<typeof shopify.authenticate.admin>
    >["session"];
    admin: Awaited<
      ReturnType<typeof shopify.authenticate.admin>
    >["admin"];
  }) => Promise<Response>,
): Promise<Response> {
  const { session, admin } = await shopify.authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  return handler({ shopDomain: session.shop, shopId: shop.id, session, admin });
}
