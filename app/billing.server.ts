import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import {
  AI_IMAGE_PLAN_USD_PER_MONTH,
  LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH,
  LEGACY_SEO_PLAN_USD_PER_MONTH,
  SEO_PLAN_USD_PER_MONTH,
} from "./pricing";

const ACTIVE_SUBS_QUERY = `#graphql
  query BillingActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        status
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
`;

function amountMatchesPlan(amountStr: string, usd: number): boolean {
  const n = parseFloat(amountStr);
  if (Number.isNaN(n)) return false;
  return Math.abs(n - usd) < 0.01;
}

function amountMatchesSeo(amountStr: string): boolean {
  return (
    amountMatchesPlan(amountStr, SEO_PLAN_USD_PER_MONTH) ||
    amountMatchesPlan(amountStr, LEGACY_SEO_PLAN_USD_PER_MONTH)
  );
}

function amountMatchesImage(amountStr: string): boolean {
  return (
    amountMatchesPlan(amountStr, AI_IMAGE_PLAN_USD_PER_MONTH) ||
    amountMatchesPlan(amountStr, LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH)
  );
}

function derivePlanFromActiveSubscriptions(data: unknown): string {
  const installation = (data as { currentAppInstallation?: { activeSubscriptions?: Array<{ status: string; lineItems?: Array<{ plan?: { pricingDetails?: { __typename?: string; price?: { amount?: string } } } }> }> } })?.currentAppInstallation;
  const subs = installation?.activeSubscriptions ?? [];
  let hasSeo = false;
  let hasImage = false;

  for (const sub of subs) {
    if (sub.status !== "ACTIVE") continue;
    for (const line of sub.lineItems ?? []) {
      const details = line.plan?.pricingDetails;
      if (details?.__typename !== "AppRecurringPricing") continue;
      const amount = details.price?.amount;
      if (amount == null) continue;
      if (amountMatchesSeo(amount)) hasSeo = true;
      if (amountMatchesImage(amount)) hasImage = true;
    }
  }

  if (hasSeo && hasImage) return "seo_image";
  if (hasSeo) return "seo";
  // Combined SEO + AI Image plan is priced as the image/combined line amount.
  if (hasImage) return "seo_image";
  return "free";
}

export async function syncStoreUsagePlanFromShopify(
  admin: AdminApiContext,
  shop: string,
): Promise<string> {
  const response = await admin.graphql(ACTIVE_SUBS_QUERY);
  const json = await response.json();
  const plan = derivePlanFromActiveSubscriptions(json.data);

  await prisma.storeUsage.upsert({
    where: { shop },
    create: { shop, plan },
    update: { plan },
  });

  return plan;
}

export function billingChargesAreTest(): boolean {
  if (process.env.SHOPIFY_BILLING_TEST === "true") return true;
  if (process.env.SHOPIFY_BILLING_TEST === "false") return false;
  return process.env.NODE_ENV !== "production";
}

const SHOP_PLAN_QUERY = `#graphql
  query BillingShopPlan {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }
`;

/** True when the current shop is a Shopify Partner development store. */
export async function isPartnerDevelopmentStore(
  admin: AdminApiContext,
): Promise<boolean> {
  const response = await admin.graphql(SHOP_PLAN_QUERY);
  const json = await response.json();
  return Boolean(json.data?.shop?.plan?.partnerDevelopment);
}

