import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useLocation } from "react-router";
import { withEmbeddedSearch } from "./embedded-nav";

export type EmbeddedNavLinkProps = {
  /** Path only, e.g. `/app/products` or `/app/products/gid%3A%2F%2F...` */
  hrefPathname: string;
  /**
   * Full query string including `?`, e.g. `?shop=…&host=…`.
   * If omitted, uses the current `location.search` so the embedded session is preserved.
   */
  search?: string;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
};

const buttonReset: CSSProperties = {
  cursor: "pointer",
  border: "none",
  background: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  textAlign: "inherit",
  color: "inherit",
};

/**
 * In-app navigation for the Shopify embedded admin iframe.
 * App Bridge registers capture listeners on `<a href>` clicks; handlers on anchors often
 * never run. Use a `<button>` + `location.assign()` so navigation is not intercepted.
 */
export function EmbeddedNavLink({
  hrefPathname,
  search: searchProp,
  children,
  style,
  className,
}: EmbeddedNavLinkProps) {
  const { search: locationSearch } = useLocation();
  const search = searchProp ?? locationSearch;
  const fullHref = withEmbeddedSearch(hrefPathname, search);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(fullHref);
  }

  return (
    <button
      type="button"
      className={className}
      style={{ ...buttonReset, ...style }}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
