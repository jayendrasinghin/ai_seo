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
  /**
   * - `link` (default): text-looking control for inline use
   * - `button`: primary filled control so CTAs look clickable
   * - `secondary`: outlined control
   */
  variant?: "link" | "button" | "secondary";
};

const baseReset: CSSProperties = {
  cursor: "pointer",
  font: "inherit",
  textAlign: "inherit",
  margin: 0,
};

const variantStyles: Record<NonNullable<EmbeddedNavLinkProps["variant"]>, CSSProperties> = {
  link: {
    border: "none",
    background: "none",
    padding: 0,
    color: "#2563eb",
    textDecoration: "underline",
    fontWeight: 600,
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "fit-content",
    height: "28px",
    minHeight: "28px",
    maxHeight: "28px",
    padding: "0 10px",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: "12px",
    lineHeight: "28px",
    textDecoration: "none",
    backgroundColor: "#2563eb",
    border: "1px solid #1d4ed8",
    color: "#ffffff",
    whiteSpace: "nowrap",
  },
  secondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "fit-content",
    height: "28px",
    minHeight: "28px",
    maxHeight: "28px",
    padding: "0 10px",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: "12px",
    lineHeight: "28px",
    textDecoration: "none",
    backgroundColor: "#ffffff",
    border: "1px solid #c9cccf",
    color: "#202223",
    whiteSpace: "nowrap",
  },
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
  variant = "link",
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
      style={{ ...baseReset, ...variantStyles[variant], ...style }}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
