import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
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
    color: "#4f46e5",
    textDecoration: "none",
    fontWeight: 600,
    cursor: "pointer",
    pointerEvents: "auto",
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "fit-content",
    height: "38px",
    minHeight: "38px",
    maxHeight: "38px",
    padding: "0 14px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: "13px",
    lineHeight: "38px",
    textDecoration: "none",
    backgroundColor: "#4f46e5",
    border: "1px solid #4338ca",
    color: "#ffffff",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)",
  },
  secondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "fit-content",
    height: "38px",
    minHeight: "38px",
    maxHeight: "38px",
    padding: "0 14px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: "13px",
    lineHeight: "38px",
    textDecoration: "none",
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#334155",
    whiteSpace: "nowrap",
  },
};

/**
 * In-app navigation for the Shopify embedded admin iframe.
 *
 * Prefer React Router client navigation (keeps App Bridge session token).
 * A full `location.assign()` reload without ?shop=/host= drops auth and shows
 * the shop-domain Log in page.
 */
export function EmbeddedNavLink({
  hrefPathname,
  search: searchProp,
  children,
  style,
  className,
  variant = "link",
}: EmbeddedNavLinkProps) {
  const navigate = useNavigate();
  const { search: locationSearch } = useLocation();
  const search = searchProp ?? locationSearch;
  const fullHref = withEmbeddedSearch(hrefPathname, search);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      window.open(fullHref, "_blank", "noopener,noreferrer");
      return;
    }
    if (e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const qIndex = fullHref.indexOf("?");
    if (qIndex === -1) {
      navigate(fullHref);
    } else {
      navigate({
        pathname: fullHref.slice(0, qIndex),
        search: fullHref.slice(qIndex),
      });
    }
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
