import { useLocation } from "react-router";
import { redirect } from "react-router";

/**
 * Shopify embedded admin loads the app iframe with ?shop=…&host=… (and more).
 * Plain links to `/app/...` drop the query string and force re-login.
 * Always append the current location.search to in-app routes.
 */
export function useEmbeddedSearch(): string {
  return useLocation().search;
}

/**
 * Build an in-app href that keeps Shopify embed params from `search`.
 * Optional `replaceParams` overwrites/adds keys; keys set to `null` are removed
 * (so filter tabs like All / PayPal don't stack old filters).
 */
export function withEmbeddedSearch(
  pathname: string,
  search: string,
  replaceParams?: Record<string, string | null>,
): string {
  // Defensive: some contexts pass HTML-entity-encoded query strings.
  const q = search.replaceAll("&amp;", "&");
  const [path, pathQuery = ""] = pathname.split("?");
  const merged = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);

  if (pathQuery) {
    const extra = new URLSearchParams(pathQuery);
    for (const [key, value] of extra.entries()) {
      merged.set(key, value);
    }
  }

  if (replaceParams) {
    for (const [key, value] of Object.entries(replaceParams)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
  }

  // Drop unknown non-embed junk only when explicitly clearing filters via replaceParams
  // (call sites pass nulls for filter keys). Keep everything else as-is.
  const out = merged.toString();
  return out ? `${path}?${out}` : path;
}

/** Orders filter links: keep embed params, reset other order filters, set one filter. */
export function withOrdersFilter(
  search: string,
  filter: Record<string, string> = {},
): string {
  return withEmbeddedSearch("/app/paysync/orders", search, {
    provider: null,
    syncStatus: null,
    failuresOnly: null,
    needsMappingOnly: null,
    ...Object.fromEntries(
      Object.entries(filter).map(([k, v]) => [k, v] as const),
    ),
  });
}

/** Server redirect that keeps embedded ?shop=&host= session params. */
export function embeddedRedirect(pathname: string, request: Request) {
  const url = new URL(request.url);
  return redirect(withEmbeddedSearch(pathname, url.search));
}
