import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShopifyAppHandle,
  managedPricingPlansUrl,
} from "../billing.server";

/**
 * Server redirect to Shopify App Pricing plan picker (breaks out of iframe).
 * Do not use a plain external link — that often lands on Settings → Apps first.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, redirect, session } = await authenticate.admin(request);
  const appHandle = await getShopifyAppHandle(admin);
  const pricingUrl = managedPricingPlansUrl(session.shop, appHandle);

  return redirect(pricingUrl, { target: "_top" });
};

export default function BillingChangePlanRedirect() {
  return null;
}
