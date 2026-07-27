import { createCookie } from "react-router";

/**
 * Remembers the last shop that successfully opened the embedded app.
 * Used so / and /auth/login don't ask for the domain again after login.
 *
 * SameSite=None + Secure required: Admin loads the app in a cross-site iframe.
 */
export const lastShopCookie = createCookie("seoi_last_shop", {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "none",
  maxAge: 60 * 60 * 24 * 400,
});

export function normalizeShopDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let shop = raw.trim().toLowerCase();
  if (!shop) return null;
  shop = shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!shop.includes(".")) shop = `${shop}.myshopify.com`;
  if (!shop.endsWith(".myshopify.com")) return null;
  return shop;
}

export async function readLastShop(
  request: Request,
): Promise<string | null> {
  try {
    const value = await lastShopCookie.parse(request.headers.get("Cookie"));
    return normalizeShopDomain(typeof value === "string" ? value : null);
  } catch {
    return null;
  }
}

export async function lastShopSetCookieHeader(shop: string): Promise<string> {
  const normalized = normalizeShopDomain(shop);
  if (!normalized) return "";
  return lastShopCookie.serialize(normalized);
}
