import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import {
  AI_IMAGE_PLAN_USD_PER_MONTH,
  SEO_PLAN_USD_PER_MONTH,
} from "./pricing";

export type BillingPlanChoice = "seo" | "seo_image";

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
      if (amountMatchesPlan(amount, SEO_PLAN_USD_PER_MONTH)) hasSeo = true;
      if (amountMatchesPlan(amount, AI_IMAGE_PLAN_USD_PER_MONTH)) hasImage = true;
    }
  }

  if (hasSeo && hasImage) return "seo_image";
  if (hasSeo) return "seo";
  // Current catalog uses $25 as the combined SEO Pro + AI Image plan.
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

function lineItemsForChoice(choice: BillingPlanChoice) {
  const item: {
    plan: {
      appRecurringPricingDetails: {
        price: { amount: number; currencyCode: string };
        interval: "EVERY_30_DAYS";
      };
    };
  } = {
    plan: {
      appRecurringPricingDetails: {
        price: {
          amount:
            choice === "seo"
              ? SEO_PLAN_USD_PER_MONTH
              : AI_IMAGE_PLAN_USD_PER_MONTH,
          currencyCode: "USD",
        },
        interval: "EVERY_30_DAYS",
      },
    },
  };

  return [item];
}

function subscriptionName(choice: BillingPlanChoice): string {
  if (choice === "seo_image") return "Image SEO Optimizer — SEO Pro + AI Image";
  return "Image SEO Optimizer — SEO Pro";
}

const CREATE_SUB_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: $lineItems
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
        status
      }
    }
  }
`;

export async function createAppSubscription(
  admin: AdminApiContext,
  shop: string,
  choice: BillingPlanChoice,
  returnUrl: string,
): Promise<
  | { ok: true; confirmationUrl: string }
  | { ok: false; error: string }
> {
  const response = await admin.graphql(CREATE_SUB_MUTATION, {
    variables: {
      name: subscriptionName(choice),
      returnUrl,
      test: billingChargesAreTest(),
      lineItems: lineItemsForChoice(choice),
    },
  });

  const json = await response.json();
  const payload = json.data?.appSubscriptionCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((e: { message?: string }) => e.message).join("; "),
    };
  }

  const confirmationUrl = payload?.confirmationUrl as string | undefined;
  if (!confirmationUrl) {
    return { ok: false, error: "No confirmation URL returned from Shopify." };
  }

  return { ok: true, confirmationUrl };
}

export function billingReturnUrl(shop: string): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("SHOPIFY_APP_URL is required for billing return URL");
  }
  const url = new URL(`${base}/app/billing/return`);
  url.searchParams.set("shop", shop);
  return url.toString();
}
