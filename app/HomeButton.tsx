import { EmbeddedNavLink } from "./embedded-nav-link";

type HomeButtonProps = {
  /** Where ← Home goes. Default: main app home. */
  hrefPathname?: string;
  label?: string;
};

/** Back-nav control for SEO / PaySync workspaces. */
export function HomeButton({
  hrefPathname = "/app",
  label = "← Home",
}: HomeButtonProps) {
  return (
    <div className="seoi-home-bar">
      <EmbeddedNavLink
        hrefPathname={hrefPathname}
        variant="secondary"
        className="seoi-home-link"
      >
        {label}
      </EmbeddedNavLink>
    </div>
  );
}

/** ← Home back to the SEO Optimization hub (tool cards). */
export function SeoHomeButton() {
  return <HomeButton hrefPathname="/app/seo-optimize" />;
}

/** ← Home back to PaySync overview (stay in PaySync, not top hub). */
export function PaySyncHomeButton() {
  return <HomeButton hrefPathname="/app/paysync" />;
}
