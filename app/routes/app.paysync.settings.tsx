import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { settingsRepository, shopRepository } from "../repositories";
import { RETRY_DELAYS_MS } from "../lib/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const settings = await shopRepository.getOrCreateSettings(shop.id);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "historical-sync") {
    const since = form.get("since") as string;
    const res = await fetch(new URL("/api/sync/historical", request.url).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ since }),
    });
    return res.json();
  }

  const settings = await settingsRepository.update(shop.id, {
    autoTaggingEnabled: form.get("autoTaggingEnabled") === "on",
    notifyBuyerDefault: form.get("notifyBuyerDefault") === "on",
    tagUnfulfilledPhysical: form.get("tagUnfulfilledPhysical") === "on",
    dataRetentionDays: parseInt(form.get("dataRetentionDays") as string, 10) || 365,
  });

  return { success: true, settings };
};

const retryLabels = ["1 min", "5 min", "30 min", "2 hr", "12 hr"];

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  if (fetcher.data?.success) {
    shopify.toast.show(
      fetcher.data.message ?? "Settings saved",
    );
  }

  return (
    <s-page heading="Settings">
      <fetcher.Form method="POST">
        <s-section heading="Tagging">
          <s-checkbox
            name="autoTaggingEnabled"
            checked={settings.autoTaggingEnabled}
            label="Auto-tagging enabled"
          />
          <s-checkbox
            name="tagUnfulfilledPhysical"
            checked={settings.tagUnfulfilledPhysical}
            label="Tag unfulfilled paid physical orders with TRACKING-MISSING"
          />
        </s-section>

        <s-section heading="Import orders">
          <s-paragraph>
            Import Shopify orders from the last period — PayPal, COD/cash,
            Razorpay, and other gateways. PayPal tracking sync still only runs
            for PayPal orders.
          </s-paragraph>
          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="historical-sync" />
            <s-text-field
              label="Import orders created since"
              name="since"
              value={new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}
            />
            <s-button type="submit" variant="secondary">
              Import orders
            </s-button>
          </fetcher.Form>
        </s-section>

        <s-section heading="PayPal auto-mapping">
          <s-paragraph>
            PaySync automatically finds PayPal order IDs from Shopify payment
            data and PayPal capture references. Manual mapping is only needed when
            auto-detection cannot find a match.
          </s-paragraph>
        </s-section>

        <s-section heading="PayPal tracking">
          <s-checkbox
            name="notifyBuyerDefault"
            checked={settings.notifyBuyerDefault}
            label="Notify buyer by default when syncing tracking to PayPal"
          />
        </s-section>

        <s-section heading="Data retention">
          <s-number-field
            label="Retain sync records (days)"
            name="dataRetentionDays"
            value={String(settings.dataRetentionDays)}
            min={30}
            max={730}
          />
        </s-section>

        <s-section heading="Retry schedule">
          <s-paragraph>
            Failed PayPal syncs retry with exponential backoff:
          </s-paragraph>
          <s-unordered-list>
            {RETRY_DELAYS_MS.map((ms, i) => (
              <s-list-item key={ms}>
                Attempt {i + 1}: {retryLabels[i]}
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>

        <s-button type="submit">
          Save settings
        </s-button>
      </fetcher.Form>

      <s-section slot="aside" heading="Carrier mapping">
        <s-paragraph>
          Unsupported carriers are sent to PayPal as OTHER with the original
          carrier name. Custom carrier mappings can be configured via the API.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
