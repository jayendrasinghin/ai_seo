import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { shipmentSyncRepository } from "../repositories";
import { formatSyncStatus } from "../lib/display";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await import("../repositories").then((r) =>
    r.shopRepository.upsertByDomain(session.shop),
  );
  const items = await shipmentSyncRepository.listQueue(shop.id);
  return { items };
};

function statusExplanation(status: string, lastError: string | null): string {
  switch (status) {
    case "needs_mapping":
      return lastError ?? "PayPal order mapping is required before we can send this shipment.";
    case "retrying":
      return lastError ?? "We could not sync the tracking number. PaySync will retry automatically.";
    case "failed":
    case "failed_permanent":
      return lastError ?? "Sync failed after multiple attempts.";
    case "synced":
      return "Tracking is ready to sync.";
    case "queued":
      return "Waiting in queue to sync to PayPal.";
    case "not_applicable":
      return "Not required — PayPal tracking sync is only for PayPal orders.";
    default:
      return lastError ?? "Pending processing.";
  }
}

export default function QueuePage() {
  const { items } = useLoaderData<typeof loader>();

  const grouped = {
    queued: items.filter((i) => ["queued", "pending"].includes(i.syncStatus)),
    retrying: items.filter((i) => i.syncStatus === "retrying"),
    succeeded: items.filter((i) => i.syncStatus === "synced"),
    needsMapping: items.filter((i) => i.syncStatus === "needs_mapping"),
    failed: items.filter((i) =>
      ["failed", "failed_permanent"].includes(i.syncStatus),
    ),
  };

  return (
    <s-page heading="Sync queue">
      <s-section heading="Queue summary">
        <s-stack direction="inline" gap="large">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{grouped.queued.length}</s-text>
            <s-paragraph>Queued</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{grouped.retrying.length}</s-text>
            <s-paragraph>Retrying</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{grouped.succeeded.length}</s-text>
            <s-paragraph>Succeeded</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{grouped.needsMapping.length}</s-text>
            <s-paragraph>Needs mapping</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{grouped.failed.length}</s-text>
            <s-paragraph>Permanently failed</s-paragraph>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="All shipments">
        <s-table>
          <s-table-header-row>
            <s-table-header>Order</s-table-header>
            <s-table-header>Tracking #</s-table-header>
            <s-table-header>Carrier</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Retries</s-table-header>
            <s-table-header>Explanation</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {items.map((item) => (
              <s-table-row key={item.id}>
                <s-table-cell>{item.orderSync.shopifyOrderName}</s-table-cell>
                <s-table-cell>{item.trackingNumber}</s-table-cell>
                <s-table-cell>{item.carrierRaw ?? item.carrier}</s-table-cell>
                <s-table-cell>{formatSyncStatus(item.syncStatus)}</s-table-cell>
                <s-table-cell>{item.retryCount}</s-table-cell>
                <s-table-cell>
                  {statusExplanation(item.syncStatus, item.lastError)}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {items.length === 0 && (
          <s-paragraph>No shipments in the sync queue yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
