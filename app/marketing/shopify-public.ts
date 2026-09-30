import { redirect } from "react-router";
import { login } from "../shopify.server";
import { readLastShop } from "../last-shop.server";
import { paysyncEnabled } from "../paysync-feature.server";

export const MARKETING_ORIGIN = (
  process.env.SHOPIFY_APP_URL || "https://seoi.in"
).replace(/\/$/, "");

export const APP_STORE_URL =
  process.env.SHOPIFY_APP_STORE_URL ||
  "https://apps.shopify.com/ai-product-descriptions-seo";

function shopFromHost(host: string | null): string | null {
  if (!host) return null;
  try {
    const decoded = atob(host.replace(/-/g, "+").replace(/_/g, "/"));
    const match = decoded.match(/\/store\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const handle = match[1];
    return handle.includes(".") ? handle : `${handle}.myshopify.com`;
  } catch {
    return null;
  }
}

function shopFromReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const ref = new URL(referrer);
    if (!ref.hostname.endsWith("shopify.com")) return null;
    const match = ref.pathname.match(/\/store\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const handle = match[1];
    return handle.includes(".") ? handle : `${handle}.myshopify.com`;
  } catch {
    return null;
  }
}

/** If Shopify Admin opened this URL, send the merchant into the embedded app. */
export function redirectEmbeddedAppIfNeeded(request: Request): void {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const fromAdmin =
    Boolean(host) ||
    url.searchParams.get("id_token") != null ||
    url.searchParams.get("embedded") === "1" ||
    Boolean(shopFromReferrer(request.headers.get("referer")));

  const shopFromShopify =
    shopParam ||
    shopFromHost(host) ||
    shopFromReferrer(request.headers.get("referer"));

  if (fromAdmin || shopFromShopify) {
    if (shopFromShopify && !url.searchParams.get("shop")) {
      url.searchParams.set("shop", shopFromShopify);
    }
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
}

export async function loadMarketingInstall(request: Request) {
  redirectEmbeddedAppIfNeeded(request);
  const lastShop = await readLastShop(request);
  return {
    showForm: Boolean(login),
    lastShop: lastShop ?? "",
    showPaySync: paysyncEnabled(),
    appStoreUrl: APP_STORE_URL,
    origin: MARKETING_ORIGIN,
  };
}

export function marketingMeta(input: {
  title: string;
  description: string;
  path: string;
}) {
  const url = `${MARKETING_ORIGIN}${input.path}`;
  return [
    { title: input.title },
    { name: "description", content: input.description },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "SEOi" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
}
