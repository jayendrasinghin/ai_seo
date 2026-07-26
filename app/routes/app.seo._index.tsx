import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { SeoHomeButton } from "../HomeButton";
import { getOrCreateSeoSettings } from "../seo-settings.server";
import { getEffectivePlan, planHasSeoSuite } from "../plan-helpers";
import prisma from "../db.server";
import { isPartnerDevelopmentStore } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  const settings = await getOrCreateSeoSettings(shop);
  const effectivePlan = getEffectivePlan(usage);
  const suiteUnlocked = partnerDevelopment || planHasSeoSuite(effectivePlan);

  const latestLinkScan = await prisma.linkScanRun.findFirst({
    where: { shop },
    orderBy: { startedAt: "desc" },
    select: { brokenCount: true, status: true },
  });

  return {
    plan: effectivePlan,
    suiteUnlocked,
    settings: {
      indexNowEnabled: settings.indexNowEnabled,
      sitemapEnabled: settings.sitemapEnabled,
      llmsTxtEnabled: settings.llmsTxtEnabled,
      jsonLdEnabled: settings.jsonLdEnabled,
      autoRedirectOnDelete: settings.autoRedirectOnDelete,
    },
    latestLinkScan,
  };
};

export default function SeoHubPage() {
  const { settings, suiteUnlocked, plan, latestLinkScan } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="SEO Suite">
      <SeoHomeButton />
      <div className="seoi-page-hero">
        <div className="seoi-page-hero__content">
          <span className="seoi-eyebrow">Technical SEO toolkit</span>
          <h2>Everything your storefront needs to stay discoverable.</h2>
          <p>
            Index content faster, protect valuable URLs, publish structured data,
            and keep product images lean—all from one workspace.
          </p>
        </div>
        <span className="seoi-status">
          {suiteUnlocked ? "Suite unlocked" : "Free preview"}
        </span>
      </div>

      <s-section>
        <s-text tone="neutral">
          IndexNow, redirects, JSON-LD, sitemap, llms.txt, broken links,
          auto-redirect, page speed, and image optimization.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Your plan ({plan}) is free.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">Upgrade</EmbeddedNavLink>{" "}
            to enable suite actions. Dev stores can use everything for testing.
          </s-text>
        ) : null}
      </s-section>

      <s-section heading="Tools">
        <div className="seoi-tool-grid">
          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">↗</div>
            <h3>IndexNow</h3>
            <p>Notify Bing and Yandex automatically when product URLs change.</p>
            <div className="seoi-tool-card__meta">
              Status: {settings.indexNowEnabled ? "Enabled" : "Disabled"}
            </div>
            <EmbeddedNavLink hrefPathname="/app/seo/indexnow" variant="button">
              Open IndexNow
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">301</div>
            <h3>URL redirects</h3>
            <p>Create and manage permanent redirects that preserve valuable traffic.</p>
            <EmbeddedNavLink hrefPathname="/app/seo/redirects" variant="button">
              Manage redirects
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">!</div>
            <h3>Broken links &amp; 404s</h3>
            <p>Scan product, collection, and page content for URLs that need attention.</p>
            <div className="seoi-tool-card__meta">
              {latestLinkScan
                ? `Last scan: ${latestLinkScan.status} · ${latestLinkScan.brokenCount} issues`
                : "No scan run yet"}
            </div>
            <EmbeddedNavLink hrefPathname="/app/seo/links" variant="button">
              Scan links
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">⤴</div>
            <h3>Automatic redirects</h3>
            <p>Protect deleted product URLs by sending visitors to a useful destination.</p>
            <div className="seoi-tool-card__meta">
              {settings.autoRedirectOnDelete ? "Enabled" : "Disabled"}
            </div>
            <EmbeddedNavLink hrefPathname="/app/seo/auto-redirect" variant="button">
              Configure
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">{"{}"}</div>
            <h3>JSON-LD schemas</h3>
            <p>Product, breadcrumb, organization, and website structured data.</p>
            <div className="seoi-tool-card__meta">
              {settings.jsonLdEnabled ? "Marked enabled" : "Marked disabled"}
            </div>
            <EmbeddedNavLink hrefPathname="/app/seo/schema" variant="button">
              Set up schema
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">≡</div>
            <h3>Sitemap &amp; llms.txt</h3>
            <p>Publish discovery files for shoppers, search engines, and AI agents.</p>
            <div className="seoi-tool-card__meta">
              Sitemap {settings.sitemapEnabled ? "on" : "off"} · llms.txt{" "}
              {settings.llmsTxtEnabled ? "on" : "off"}
            </div>
            <EmbeddedNavLink hrefPathname="/app/seo/sitemap" variant="button">
              Configure
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">⚡</div>
            <h3>Page speed</h3>
            <p>Lazy-load images, preload hero media, and defer analytics scripts.</p>
            <EmbeddedNavLink hrefPathname="/app/seo/speed" variant="button">
              Open speed tools
            </EmbeddedNavLink>
          </article>

          <article className="seoi-tool-card">
            <div className="seoi-tool-card__icon">◫</div>
            <h3>Image optimization</h3>
            <p>Compress and resize product media before replacing it in Shopify.</p>
            <EmbeddedNavLink hrefPathname="/app/seo/images" variant="button">
              Optimize images
            </EmbeddedNavLink>
          </article>
        </div>
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
