import { useLocation } from "react-router";

/**
 * Shopify embedded admin loads the app iframe with ?shop=…&host=… (and more).
 * Plain links to `/app/...` drop the query string and force re-login.
 * Always append the current location.search to in-app routes.
 */
export function useEmbeddedSearch(): string {
  return useLocation().search;
}

export function withEmbeddedSearch(pathname: string, search: string): string {
  // Defensive: some contexts pass HTML-entity-encoded query strings.
  const q = search.replaceAll("&amp;", "&");
  return `${pathname}${q}`;
}
