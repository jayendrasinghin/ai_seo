const SHOPIFY_PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d+)$/i;

/** Numeric id from a Shopify Product GID, e.g. `7257240174672`. */
export function productNumericIdFromGid(gid: string): string | null {
  const m = SHOPIFY_PRODUCT_GID.exec(gid.trim());
  return m ? m[1] : null;
}

/**
 * Single path segment for `/app/products/:id` — must NOT contain encoded `/` (%2F)
 * or tunnels/proxies may split the URL and break routing (you end up on the list again).
 */
export function productPathSegmentFromGid(gid: string): string {
  const n = productNumericIdFromGid(gid);
  if (n) return n;
  const tail = gid.split("/").pop();
  if (tail && /^\d+$/.test(tail)) return tail;
  const endDigits = gid.trim().match(/(\d+)$/);
  if (endDigits) return endDigits[1];
  throw new Error(`Invalid Shopify product id for URL: ${gid}`);
}

/** Build Product GID from the route `:id` param (numeric or legacy encoded GID). */
export function productGidFromRouteParam(raw: string | undefined): string | null {
  if (raw == null || raw === "") return null;
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    s = raw;
  }
  if (/^\d+$/.test(s)) {
    return `gid://shopify/Product/${s}`;
  }
  if (s.startsWith("gid://")) {
    return s;
  }
  return null;
}
