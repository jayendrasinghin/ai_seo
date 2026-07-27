import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch, withOrdersFilter } from "../embedded-nav";
import { orderSyncRepository } from "../repositories";
import {
  formatDateTime,
  formatPaymentStatus,
  formatProvider,
  formatSyncStatus,
} from "../lib/display";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await import("../repositories").then((r) =>
    r.shopRepository.upsertByDomain(session.shop),
  );
  const url = new URL(request.url);
  const syncStatus = url.searchParams.get("syncStatus") ?? undefined;
  const provider = url.searchParams.get("provider") ?? undefined;
  const failuresOnly = url.searchParams.get("failuresOnly") === "true";
  const needsMappingOnly = url.searchParams.get("needsMappingOnly") === "true";

  const result = await orderSyncRepository.list(shop.id, {
    syncStatus: syncStatus as never,
    provider: provider as never,
    failuresOnly,
    needsMappingOnly,
    take: 50,
  });

  let accessBlocker: string | null = null;
  if (result.total === 0) {
    const { getOrdersAccessBlocker } = await import("../services/orders-access");
    accessBlocker = await getOrdersAccessBlocker(admin);
  }

  return { orders: result.items, total: result.total, accessBlocker };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const orderId = form.get("orderId") as string;

  if (intent === "retry") {
    const res = await fetch(
      new URL(`/api/orders/${orderId}/retry`, request.url).toString(),
      { method: "POST", headers: { cookie: request.headers.get("cookie") ?? "" } },
    );
    return res.json();
  }

  if (intent === "map-paypal") {
    const paypalOrderId = form.get("paypalOrderId") as string;
    const res = await fetch(
      new URL(`/api/orders/${orderId}/map-paypal`, request.url).toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ paypalOrderId }),
      },
    );
    return res.json();
  }

  return { error: "Unknown intent" };
};

export default function OrdersPage() {
  const { search } = useLocation();
  const { orders, total, accessBlocker } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [mappingOrderId, setMappingOrderId] = useState<string | null>(null);
  const [paypalOrderId, setPaypalOrderId] = useState("");

  const submitMap = (orderId: string) => {
    fetcher.submit(
      { intent: "map-paypal", orderId, paypalOrderId },
      { method: "POST" },
    );
    setMappingOrderId(null);
    shopify.toast.show("PayPal order mapping saved");
  };

  return (
    <s-page heading="Orders">
      <s-section heading="Filters">
        <s-stack direction="inline" gap="base">
          <s-link href={withOrdersFilter(search)}>All</s-link>
          <s-link href={withOrdersFilter(search, { provider: "paypal" })}>
            PayPal
          </s-link>
          <s-link href={withOrdersFilter(search, { provider: "cod" })}>
            COD / Cash
          </s-link>
          <s-link href={withOrdersFilter(search, { provider: "razorpay" })}>
            Razorpay
          </s-link>
          <s-link
            href={withOrdersFilter(search, { needsMappingOnly: "true" })}
          >
            Needs mapping
          </s-link>
          <s-link href={withOrdersFilter(search, { failuresOnly: "true" })}>
            Failures only
          </s-link>
        </s-stack>
      </s-section>

      <s-section heading={`Order list (${total} orders)`}>
        {accessBlocker ? (
          <s-box padding="base">
            <s-banner tone="critical">{accessBlocker}</s-banner>
          </s-box>
        ) : null}
        {total === 0 && !accessBlocker ? (
          <s-box padding="base">
            <s-paragraph>
              No orders in this list yet. Open{" "}
              <s-link href={withEmbeddedSearch("/app/paysync", search)}>
                PaySync Overview
              </s-link>{" "}
              and run <strong>Process old orders</strong> (Redis +{" "}
              <code>npm run worker</code> must be running).
            </s-paragraph>
          </s-box>
        ) : null}
        {total === 0 && accessBlocker ? (
          <s-box padding="base">
            <s-paragraph>
              Order list stays empty until Shopify approves Protected Customer
              Data for this app. Worker/Redis cannot fix that.
            </s-paragraph>
          </s-box>
        ) : null}
        <s-table>
          <s-table-header-row>
            <s-table-header>Order</s-table-header>
            <s-table-header>Item name</s-table-header>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Order date</s-table-header>
            <s-table-header>Provider</s-table-header>
            <s-table-header>PayPal / Razorpay ID</s-table-header>
            <s-table-header>Payment</s-table-header>
            <s-table-header>Fulfillment</s-table-header>
            <s-table-header>Tracking</s-table-header>
            <s-table-header>Sync</s-table-header>
            <s-table-header>Sync date</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {orders.map((order) => (
              <s-table-row key={order.id}>
                <s-table-cell>{order.shopifyOrderName}</s-table-cell>
                <s-table-cell>
                  {order.itemsSummary ? order.itemsSummary : "—"}
                </s-table-cell>
                <s-table-cell>
                  {order.customerName ? order.customerName : "—"}
                </s-table-cell>
                <s-table-cell>
                  {formatDateTime(order.shopifyCreatedAt ?? order.createdAt)}
                </s-table-cell>
                <s-table-cell>
                  {formatProvider(order.paymentProvider)}
                </s-table-cell>
                <s-table-cell>
                  {order.providerOrderId ? order.providerOrderId : "—"}
                </s-table-cell>
                <s-table-cell>
                  {formatPaymentStatus(order.paymentStatus)}
                </s-table-cell>
                <s-table-cell>{order.fulfillmentStatus}</s-table-cell>
                <s-table-cell>{order.trackingStatus}</s-table-cell>
                <s-table-cell>
                  {formatSyncStatus(order.syncStatus)}
                </s-table-cell>
                <s-table-cell>
                  {formatDateTime(order.lastSyncedAt ?? order.updatedAt)}
                </s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="base">
                    {order.syncStatus === "needs_mapping" && (
                      <s-button
                        variant="tertiary"
                       
                       
                        onClick={() => setMappingOrderId(order.id)}
                      >
                        Map PayPal order
                      </s-button>
                    )}
                    {["failed", "failed_permanent", "retrying"].includes(
                      order.syncStatus,
                    ) && (
                      <fetcher.Form method="POST">
                        <input type="hidden" name="intent" value="retry" />
                        <input type="hidden" name="orderId" value={order.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                         
                         
                        >
                          Retry sync
                        </s-button>
                      </fetcher.Form>
                    )}
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {mappingOrderId && (
        <s-section heading="Map PayPal order">
          <s-paragraph>
            PayPal order mapping is required before we can send this shipment.
            Paste the PayPal Order ID from your PayPal dashboard.
          </s-paragraph>
          <s-text-field
            label="PayPal Order ID"
            value={paypalOrderId}
            onChange={(e: Event) =>
              setPaypalOrderId((e.target as HTMLInputElement).value)
            }
          />
          <s-stack direction="inline" gap="base">
            <s-button
             
             
              onClick={() => submitMap(mappingOrderId)}
            >
              Save mapping
            </s-button>
            <s-button
              variant="tertiary"
             
             
              onClick={() => setMappingOrderId(null)}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
