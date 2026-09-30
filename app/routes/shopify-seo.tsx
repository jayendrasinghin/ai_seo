import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarketingShell } from "../marketing/MarketingShell";
import { marketingMeta } from "../marketing/shopify-public";
import { loadMarketingInstall } from "../marketing/shopify-public.server";

export const meta: MetaFunction = () =>
  marketingMeta({
    title: "Shopify product SEO and image ALT text | SEOi",
    description:
      "Write AI product titles, descriptions, and image ALT text in Shopify Admin. Scan missing ALT text and apply updates. Part of the SEOi app — one install.",
    path: "/shopify-seo",
  });

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadMarketingInstall(request);

export default function ShopifySeoPage() {
  const { showForm, lastShop, appStoreUrl, origin } =
    useLoaderData<typeof loader>();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Shopify product SEO and image ALT text",
    url: `${origin}/shopify-seo`,
    isPartOf: { "@type": "WebSite", name: "SEOi", url: origin },
    description:
      "AI product titles, descriptions, and image ALT text for Shopify. One install of SEOi.",
  };

  return (
    <MarketingShell
      path="/shopify-seo"
      showForm={showForm}
      lastShop={lastShop}
      appStoreUrl={appStoreUrl}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mkt-hero">
        <p className="mkt-kicker">Product SEO workspace</p>
        <h1>Shopify product SEO and image ALT text</h1>
        <p className="mkt-lead">
          Use SEOi to generate product titles, descriptions, and ALT text, then
          apply them in Shopify. Built for stores that need clearer product
          copy and image descriptions — not a ranking guarantee.
        </p>
        <div className="mkt-actions">
          <a className="mkt-btn mkt-btn-primary" href="#install">
            Install SEOi once
          </a>
          <a className="mkt-btn mkt-btn-secondary" href="/shopify-paypal-tracking">
            Need PayPal tracking instead?
          </a>
        </div>
      </header>

      <div className="mkt-panel">
        <h2>What this workspace does</h2>
        <ul>
          <li>AI titles and descriptions for selected products</li>
          <li>Image SEO scan for missing or weak ALT text</li>
          <li>Apply generated ALT text to product images</li>
          <li>Optional SEO suite tools on paid plans</li>
          <li>Stock tools in the same app if you need them</li>
        </ul>
      </div>
      <div className="mkt-panel">
        <h2>Same app as PaySync</h2>
        <p className="mkt-lead" style={{ margin: 0 }}>
          This is not a second Shopify app. After install, open{" "}
          <strong>SEO &amp; Image Optimization</strong> in SEOi. PayPal tracking
          is a separate workspace in the same install.
        </p>
      </div>
    </MarketingShell>
  );
}
