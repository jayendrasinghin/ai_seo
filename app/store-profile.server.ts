import prisma from "./db.server";
import { ensureFreshOfflineAccessToken } from "./shop-access.server";
import { apiVersion } from "./shopify.server";

export type StoreProfileData = {
  storeName: string | null;
  primaryDomain: string | null;
  storefrontUrl: string | null;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  timezone: string | null;
  currency: string | null;
  planDisplayName: string | null;
};

type SessionTokenRow = {
  id: string;
  shop: string;
  accessToken: string;
  refreshToken: string | null;
  expires: Date | null;
  refreshTokenExpires: Date | null;
};

type FetchResult = {
  profile: StoreProfileData | null;
  unauthorized: boolean;
};

async function fetchShopProfileGraphQL(
  shop: string,
  accessToken: string,
): Promise<FetchResult> {
  try {
    const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `#graphql
          query AdminInstalledStoreProfile {
            shop {
              name
              email
              contactEmail
              ianaTimezone
              currencyCode
              primaryDomain {
                host
                url
              }
              billingAddress {
                address1
                address2
                city
                province
                country
                zip
                phone
              }
              plan {
                displayName
                partnerDevelopment
                shopifyPlus
              }
            }
          }`,
      }),
    });

    if (response.status === 401) {
      return { profile: null, unauthorized: true };
    }
    if (!response.ok) {
      console.error("[store-profile] HTTP", shop, response.status);
      return { profile: null, unauthorized: false };
    }

    const json = (await response.json()) as {
      data?: {
        shop?: {
          name?: string | null;
          email?: string | null;
          contactEmail?: string | null;
          ianaTimezone?: string | null;
          currencyCode?: string | null;
          primaryDomain?: { host?: string | null; url?: string | null } | null;
          billingAddress?: {
            address1?: string | null;
            address2?: string | null;
            city?: string | null;
            province?: string | null;
            country?: string | null;
            zip?: string | null;
            phone?: string | null;
          } | null;
          plan?: { displayName?: string | null } | null;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (json.errors?.length) {
      console.error("[store-profile] GraphQL", shop, json.errors);
    }

    const s = json.data?.shop;
    if (!s) return { profile: null, unauthorized: false };

    const address = [
      s.billingAddress?.address1,
      s.billingAddress?.address2,
      s.billingAddress?.city,
      s.billingAddress?.province,
      s.billingAddress?.zip,
    ]
      .filter(Boolean)
      .join(", ");
    const phone = (s.billingAddress?.phone || "").trim() || null;
    const contactEmail =
      (s.contactEmail || "").trim() || (s.email || "").trim() || null;
    const host = (s.primaryDomain?.host || "").trim() || null;
    const storefrontUrl =
      (s.primaryDomain?.url || "").replace(/\/$/, "") ||
      (host ? `https://${host}` : null) ||
      `https://${shop}`;

    return {
      unauthorized: false,
      profile: {
        storeName: s.name ?? null,
        primaryDomain: host || s.primaryDomain?.url || null,
        storefrontUrl,
        contactEmail,
        phone,
        address: address || null,
        country: s.billingAddress?.country ?? null,
        timezone: s.ianaTimezone ?? null,
        currency: s.currencyCode ?? null,
        planDisplayName: s.plan?.displayName ?? null,
      },
    };
  } catch (error) {
    console.error("[store-profile] fetch error", shop, error);
    return { profile: null, unauthorized: false };
  }
}

async function saveStoreProfile(shop: string, live: StoreProfileData): Promise<void> {
  await prisma.storeProfile.upsert({
    where: { shop },
    create: {
      shop,
      storeName: live.storeName,
      primaryDomain: live.primaryDomain,
      storefrontUrl: live.storefrontUrl,
      contactEmail: live.contactEmail,
      phone: live.phone,
      address: live.address,
      country: live.country,
      timezone: live.timezone,
      currency: live.currency,
      planDisplayName: live.planDisplayName,
      syncedAt: new Date(),
    },
    update: {
      storeName: live.storeName,
      primaryDomain: live.primaryDomain,
      storefrontUrl: live.storefrontUrl,
      contactEmail: live.contactEmail,
      phone: live.phone,
      address: live.address,
      country: live.country,
      timezone: live.timezone,
      currency: live.currency,
      planDisplayName: live.planDisplayName,
      syncedAt: new Date(),
    },
  });
}

/**
 * Refresh token if needed, fetch Shopify shop profile, and persist to StoreProfile.
 * Retries once after force-refresh when Shopify returns 401.
 */
export async function syncStoreProfile(
  session: SessionTokenRow,
): Promise<StoreProfileData | null> {
  let token = await ensureFreshOfflineAccessToken(session);
  if (!token) return null;

  let result = await fetchShopProfileGraphQL(session.shop, token);
  if (result.unauthorized) {
    // Access token may look unexpired but still be revoked — force refresh once.
    token = await ensureFreshOfflineAccessToken({
      ...session,
      expires: new Date(0),
    });
    if (!token) return null;
    result = await fetchShopProfileGraphQL(session.shop, token);
  }

  if (!result.profile) return null;

  try {
    await saveStoreProfile(session.shop, result.profile);
  } catch (error) {
    console.error("[store-profile] upsert failed", session.shop, error);
  }
  return result.profile;
}

/** Shopify Partner / automated checker stores — not real merchants. */
export function isShopifyStaffOrSyntheticShop(input: {
  shop: string;
  contactEmail?: string | null;
  planDisplayName?: string | null;
}): boolean {
  const plan = (input.planDisplayName || "").toLowerCase();
  if (plan === "staff" || plan.includes("staff")) return true;

  const email = (input.contactEmail || "").toLowerCase();
  if (
    email.endsWith("@shopify.com") &&
    (email.includes("synthetics") ||
      email.includes("genghis-khan") ||
      email.includes("blocking-checker") ||
      email.includes("identity-"))
  ) {
    return true;
  }

  // Common Shopify synthetic shop domains
  if (/^number-\d+-\d+\.myshopify\.com$/i.test(input.shop)) return true;

  return false;
}
