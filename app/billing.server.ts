import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import {
  AI_IMAGE_PLAN_MATCH_AMOUNTS,
  SEO_PLAN_MATCH_AMOUNTS,
} from "./pricing";

const ACTIVE_SUBS_QUERY = `#graphql
  query BillingActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

/** Partner Dashboard managed-pricing plan handles (Free / Basic / Pro). */
export function planFromManagedHandle(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase();
  if (h === "free" || h.startsWith("free-")) return "free";
  if (
    h === "starter" ||
    h === "basic" ||
    h === "seo" ||
    h.startsWith("starter-") ||
    h.startsWith("basic-")
  ) {
    return "seo";
  }
  if (
    h === "pro" ||
    h === "seo_image" ||
    h === "seo-image" ||
    h === "image" ||
    h.startsWith("pro-")
  ) {
    return "seo_image";
  }
  return null;
}

function planFromSubscriptionName(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/\bfree\b/.test(n)) return "free";
  if (/\b(basic|starter)\b/.test(n)) return "seo";
  if (/\b(pro|image)\b/.test(n)) return "seo_image";
  return null;
}

/** Shopify Admin → plan selection (Managed / App Pricing). Uses app handle, NOT API key. */
export function managedPricingPlansUrl(
  shop: string,
  appHandle: string,
): string {
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

const APP_HANDLE_QUERY = `#graphql
  query SeoiAppHandle {
    currentAppInstallation {
      app {
        handle
      }
    }
  }
`;

/** App handle from Admin API (matches shopify.app.toml / Partner Dashboard). */
export async function getShopifyAppHandle(
  admin: AdminApiContext,
): Promise<string> {
  const fromEnv = process.env.SHOPIFY_APP_HANDLE?.trim();
  if (fromEnv) return fromEnv;

  try {
    const response = await admin.graphql(APP_HANDLE_QUERY);
    const json = await response.json();
    const handle = (
      json.data as {
        currentAppInstallation?: { app?: { handle?: string } };
      }
    )?.currentAppInstallation?.app?.handle?.trim();
    if (handle) return handle;
  } catch {
    // fall through to default
  }

  // Last resort — set SHOPIFY_APP_HANDLE in .env if this differs on your app.
  return "ai-product-descriptions-seo";
}

function amountMatchesPlan(amountStr: string, usd: number): boolean {
  const n = parseFloat(amountStr);
  if (Number.isNaN(n)) return false;
  return Math.abs(n - usd) < 0.01;
}

function amountMatchesAny(amountStr: string, amounts: readonly number[]): boolean {
  return amounts.some((usd) => amountMatchesPlan(amountStr, usd));
}

function amountMatchesSeo(amountStr: string): boolean {
  return amountMatchesAny(amountStr, SEO_PLAN_MATCH_AMOUNTS);
}

function amountMatchesImage(amountStr: string): boolean {
  return amountMatchesAny(amountStr, AI_IMAGE_PLAN_MATCH_AMOUNTS);
}

type ActiveSub = {
  status: string;
  name?: string;
  lineItems?: Array<{
    plan?: {
      pricingDetails?: {
        __typename?: string;
        price?: { amount?: string };
      };
    };
  }>;
};

function derivePlanFromActiveSubscriptions(data: unknown): string {
  const installation = (
    data as { currentAppInstallation?: { activeSubscriptions?: ActiveSub[] } }
  )?.currentAppInstallation;
  const subs = installation?.activeSubscriptions ?? [];
  let hasSeo = false;
  let hasImage = false;

  for (const sub of subs) {
    if (sub.status !== "ACTIVE") continue;

    const fromName = planFromSubscriptionName(sub.name);
    if (fromName === "seo") hasSeo = true;
    if (fromName === "seo_image") hasImage = true;

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

function hasActivePaidSubscription(data: unknown): boolean {
  const installation = (
    data as { currentAppInstallation?: { activeSubscriptions?: ActiveSub[] } }
  )?.currentAppInstallation;
  const subs = installation?.activeSubscriptions ?? [];
  for (const sub of subs) {
    if (sub.status !== "ACTIVE") continue;
    for (const line of sub.lineItems ?? []) {
      const details = line.plan?.pricingDetails;
      if (details?.__typename !== "AppRecurringPricing") continue;
      const amount = details.price?.amount;
      if (amount != null && parseFloat(amount) > 0) return true;
    }
  }
  return false;
}

/** Prefer Shopify redirect handle; otherwise Admin API subscription state. */
function resolveStorePlan(fromGraph: string, fromHandle: string | null): string {
  if (fromHandle) return fromHandle;
  if (!fromGraph || fromGraph === "free") return "free";
  return fromGraph;
}

async function fetchActiveSubscriptions(admin: AdminApiContext) {
  const response = await admin.graphql(ACTIVE_SUBS_QUERY);
  const json = await response.json();
  return json.data;
}

export async function syncStoreUsagePlanFromShopify(
  admin: AdminApiContext,
  shop: string,
  options?: { planHandle?: string | null; retry?: boolean },
): Promise<string> {
  let data = await fetchActiveSubscriptions(admin);
  let fromGraph = derivePlanFromActiveSubscriptions(data);
  const fromHandle = planFromManagedHandle(options?.planHandle);

  let plan = resolveStorePlan(fromGraph, fromHandle);

  // Downgrade to Free: no paid subscription in Admin API.
  if (!fromHandle && !hasActivePaidSubscription(data)) {
    plan = "free";
  }

  // After managed-pricing checkout, GraphQL can lag — retry once.
  if (options?.retry && fromHandle && fromHandle !== fromGraph) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    data = await fetchActiveSubscriptions(admin);
    fromGraph = derivePlanFromActiveSubscriptions(data);
    plan = resolveStorePlan(fromGraph, fromHandle);
    if (!fromHandle && !hasActivePaidSubscription(data)) {
      plan = "free";
    }
  }

  await prisma.storeUsage.upsert({
    where: { shop },
    create: { shop, plan },
    update: { plan },
  });

  return plan;
}

/** Read plan_handle / pricing=return from Shopify App Pricing redirects. */
export function planHandleFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  return (
    url.searchParams.get("plan_handle") ||
    url.searchParams.get("plan") ||
    url.searchParams.get("planHandle") ||
    null
  );
}

export function shouldRetryBillingSync(request: Request): boolean {
  const url = new URL(request.url);
  return (
    Boolean(planHandleFromRequest(request)) ||
    url.searchParams.get("billing") === "return" ||
    url.searchParams.get("pricing") === "return"
  );
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

