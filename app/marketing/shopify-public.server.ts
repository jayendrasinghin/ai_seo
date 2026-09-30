import { redirect } from "react-router";
import { login } from "../shopify.server";
import { readLastShop } from "../last-shop.server";
import { paysyncEnabled } from "../paysync-feature.server";
import { DEFAULT_APP_STORE_URL, MARKETING_ORIGIN } from "./shopify-public";

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
  const appStoreUrl = (
    process.env.SHOPIFY_APP_STORE_URL || DEFAULT_APP_STORE_URL
  ).replace(/\/$/, "");
  return {
    showForm: Boolean(login),
    lastShop: lastShop ?? "",
    showPaySync: paysyncEnabled(),
    appStoreUrl,
    origin: MARKETING_ORIGIN,
  };
}
