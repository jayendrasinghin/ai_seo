import shopify from "../shopify.server";
import { fetchOrdersPage, type ShopifyAdminGraphQL } from "../clients/shopify/graphql";
import { createChildLogger } from "../lib/logger";
import { resolvePaymentProvider } from "./payment-provider";
import { processOrder } from "./order-processor";
import { processFulfillment } from "./fulfillment-processor";
import { enqueueHistoricalSyncJob } from "../jobs/queues";

const log = createChildLogger({ service: "historical-sync" });

export interface HistoricalSyncResult {
  processed: number;
  paypalOrders: number;
  syncedFulfillments: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export function buildHistoricalSyncQuery(sinceIso: string): string {
  const date = sinceIso.slice(0, 10);
  // Import every order in the window (COD/cash/pending + paid, fulfilled or not).
  // PayPal tracking sync still only runs for PayPal orders inside processOrder/fulfillment.
  return `created_at:>=${date}`;
}

export async function runHistoricalSyncPage(
  shopDomain: string,
  sinceIso: string,
  cursor?: string | null,
): Promise<HistoricalSyncResult> {
  const { admin } = await shopify.unauthenticated.admin(shopDomain);
  const query = buildHistoricalSyncQuery(sinceIso);

  const page = await fetchOrdersPage(admin as ShopifyAdminGraphQL, {
    query,
    first: 25,
    after: cursor,
  });

  let processed = 0;
  let paypalOrders = 0;
  let syncedFulfillments = 0;

  for (const order of page.orders) {
    const provider = resolvePaymentProvider(order);
    if (provider === "paypal") paypalOrders += 1;

    await processOrder(admin as ShopifyAdminGraphQL, shopDomain, order);
    processed += 1;

    if (order.fulfillments.length > 0) {
      await processFulfillment(admin as ShopifyAdminGraphQL, shopDomain, order);
      syncedFulfillments += order.fulfillments.length;
    }
  }

  log.info(
    { shopDomain, processed, paypalOrders, hasMore: page.hasNextPage },
    "Historical sync page complete",
  );

  return {
    processed,
    paypalOrders,
    syncedFulfillments,
    hasMore: page.hasNextPage,
    nextCursor: page.endCursor,
  };
}

export async function startHistoricalSync(
  shopDomain: string,
  sinceIso: string,
): Promise<{ processed: number; hasMore: boolean }> {
  // Run the first page immediately so Orders updates even if the worker is down.
  const first = await runHistoricalSyncPage(shopDomain, sinceIso, null);
  if (first.hasMore && first.nextCursor) {
    await enqueueHistoricalSyncJob({
      shopDomain,
      sinceIso,
      cursor: first.nextCursor,
    });
  }
  return { processed: first.processed, hasMore: first.hasMore };
}

export async function continueHistoricalSync(
  shopDomain: string,
  sinceIso: string,
  cursor: string,
): Promise<void> {
  await enqueueHistoricalSyncJob({ shopDomain, sinceIso, cursor });
}
