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

export function withEmbeddedSearch(pathname: string, search: string): string {
  // Defensive: some contexts pass HTML-entity-encoded query strings.
  const q = search.replaceAll("&amp;", "&");
  if (!q) return pathname;

  // Path already has its own query (e.g. /app/paysync/orders?failuresOnly=true)
  if (pathname.includes("?")) {
    const [path, pathQuery] = pathname.split("?");
    const merged = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
    const extra = new URLSearchParams(pathQuery);
    for (const [key, value] of extra.entries()) {
      merged.set(key, value);
    }
    const out = merged.toString();
    return out ? `${path}?${out}` : path;
  }

  return `${pathname}${q.startsWith("?") ? q : `?${q}`}`;
}

/** Server redirect that keeps embedded ?shop=&host= session params. */
export function embeddedRedirect(pathname: string, request: Request) {
  const url = new URL(request.url);
  return redirect(withEmbeddedSearch(pathname, url.search));
}
