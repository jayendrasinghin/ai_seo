import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { EmbeddedNavLink } from "../embedded-nav-link";
import {
  getOrCreateSeoSettings,
  storefrontProxyUrl,
} from "../seo-settings.server";
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
    urls: {
      sitemap: storefrontProxyUrl(shop, "/sitemap"),
      llms: storefrontProxyUrl(shop, "/llms.txt"),
    },
  };
};

export default function SeoHubPage() {
  const { settings, urls, suiteUnlocked, plan, latestLinkScan } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="SEO Suite">
      <s-section>
        <s-text tone="neutral">
          Phase 1–3: IndexNow, redirects, JSON-LD, sitemap, llms.txt, broken links, auto-redirect,
          page speed, and image optimize.
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
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>IndexNow</s-heading>
              <s-text tone="neutral">
                Notify Bing &amp; Yandex when product URLs change.{" "}
                {settings.indexNowEnabled ? "Enabled" : "Disabled"}.
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/indexnow" variant="button">
                  Open IndexNow
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Redirects (301)</s-heading>
              <s-text tone="neutral">
                Create and manage 301 redirects to retain traffic from changed URLs.
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/redirects" variant="button">
                  Manage redirects
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Broken links &amp; 404s</s-heading>
              <s-text tone="neutral">
                Scan content for broken hrefs.
                {latestLinkScan
                  ? ` Last scan: ${latestLinkScan.status}, ${latestLinkScan.brokenCount} broken/error.`
                  : " No scan yet."}
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/links" variant="button">
                  Scan links
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Auto-redirect on delete</s-heading>
              <s-text tone="neutral">
                {settings.autoRedirectOnDelete
                  ? "Enabled — 301 when products are deleted."
                  : "Disabled."}
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/auto-redirect" variant="button">
                  Configure
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>JSON-LD schemas</s-heading>
              <s-text tone="neutral">
                Product, BreadcrumbList, Organization, WebSite — enabled in the{" "}
                <strong>theme editor App embeds</strong> (not this left nav).{" "}
                {settings.jsonLdEnabled ? "Marked enabled" : "Marked disabled"}.
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/schema" variant="button">
                  Setup schema
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Sitemap &amp; llms.txt</s-heading>
              <s-text tone="neutral">
                HTML sitemap and AI-friendly llms.txt on your storefront.
              </s-text>
              <s-text>
                Sitemap:{" "}
                {settings.sitemapEnabled ? (
                  <a href={urls.sitemap} target="_blank" rel="noreferrer">
                    {urls.sitemap}
                  </a>
                ) : (
                  "disabled"
                )}
              </s-text>
              <s-text>
                llms.txt:{" "}
                {settings.llmsTxtEnabled ? (
                  <a href={urls.llms} target="_blank" rel="noreferrer">
                    {urls.llms}
                  </a>
                ) : (
                  "disabled"
                )}
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/sitemap" variant="button">
                  Configure
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Page speed</s-heading>
              <s-text tone="neutral">
                Lazy-load images, preload hero, defer analytics scripts (theme App embed).
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/speed" variant="button">
                  Open speed tools
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Image optimize</s-heading>
              <s-text tone="neutral">
                Compress and resize product images, then replace media on Shopify.
              </s-text>
              <div style={{ marginTop: 4 }}>
                <EmbeddedNavLink hrefPathname="/app/seo/images" variant="button">
                  Optimize images
                </EmbeddedNavLink>
              </div>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Roadmap">
        <s-stack direction="block" gap="small-200">
          <s-text>
            <strong>Phase 1:</strong> IndexNow, redirects, JSON-LD, sitemap, llms.txt ✓
          </s-text>
          <s-text>
            <strong>Phase 2:</strong> Broken-link crawl, auto-redirect on delete, richer schema ✓
          </s-text>
          <s-text>
            <strong>Phase 3 (now):</strong> Image compress/resize, lazy load, script defer /
            preload ✓
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
