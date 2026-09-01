import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShopifyAppHandle,
  managedPricingPlansUrl,
} from "../billing.server";

/**
 * Fallback route when linked directly. Client assigns top window so Shopify
 * plan picker opens (SPA navigate to this route cannot use server redirect).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const appHandle = await getShopifyAppHandle(admin);
  const pricingUrl = managedPricingPlansUrl(session.shop, appHandle);
  return { pricingUrl };
};

export default function BillingChangePlanRedirect() {
  const { pricingUrl } = useLoaderData<typeof loader>();

  useEffect(() => {
    const topWindow = window.top ?? window;
    topWindow.location.assign(pricingUrl);
  }, [pricingUrl]);

  return (
    <s-page heading="Change plan">
      <s-text>Opening Shopify plan selection…</s-text>
    </s-page>
  );
}
