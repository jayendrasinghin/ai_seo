import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarketingShell } from "../../marketing/MarketingShell";
import { marketingMeta } from "../../marketing/shopify-public";
import { loadMarketingInstall } from "../../marketing/shopify-public.server";

export const meta: MetaFunction = () =>
  marketingMeta({
    title: "SEOi — AI product SEO, images, and PayPal tracking",
    description:
      "One Shopify app for AI product SEO, AI product images, image ALT text, and PaySync tracking to PayPal. Install once; two workspaces in Admin.",
    path: "/",
  });

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadMarketingInstall(request);

export default function Home() {
  const { showForm, lastShop, showPaySync, appStoreUrl, origin } =
    useLoaderData<typeof loader>();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SEOi",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Shopify",
    url: origin,
    description:
      "Shopify app for AI product SEO, AI product images, image ALT text, and PayPal fulfillment tracking sync.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <MarketingShell
      path="/"
      showForm={showForm}
      lastShop={lastShop}
      appStoreUrl={appStoreUrl}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mkt-hero">
        <p className="mkt-kicker">One Shopify app · two workspaces</p>
        <h1>AI product SEO, AI product images, and PayPal tracking</h1>
        <p className="mkt-lead">
          Install SEOi once. Use product SEO, ALT text, and AI product images in
          one workspace; use PaySync to send Shopify fulfillment tracking to
          PayPal in the other. Same app — not two installs.
        </p>
        <div className="mkt-actions">
          <a className="mkt-btn mkt-btn-primary" href="#install">
            Install SEOi
          </a>
          <a className="mkt-btn mkt-btn-secondary" href="/shopify-seo">
            Product SEO &amp; AI images
          </a>
          {showPaySync ? (
            <a className="mkt-btn mkt-btn-secondary" href="/shopify-paypal-tracking">
              Sync tracking to PayPal
            </a>
          ) : null}
        </div>
      </header>

      <div className="mkt-grid">
        <a className="mkt-card" href="/shopify-seo">
          <p className="mkt-note">For product pages</p>
          <h2>Product SEO, ALT text &amp; AI images</h2>
          <p>
            AI titles, descriptions, image ALT text, SEO scans, and AI product
            image generation (Pro). You apply the content in Shopify Admin.
          </p>
        </a>
        {showPaySync ? (
          <a className="mkt-card" href="/shopify-paypal-tracking">
            <p className="mkt-note">For PayPal orders</p>
            <h2>Sync tracking to PayPal</h2>
            <p>
              After you fulfill in Shopify, PaySync can send the tracking number
              to PayPal. It does not process payments.
            </p>
          </a>
        ) : (
          <div className="mkt-card">
            <p className="mkt-note">SEO workspace</p>
            <h2>Image ALT and product copy</h2>
            <p>
              Scan missing ALT text, generate suggestions, and apply them to
              products from one dashboard.
            </p>
          </div>
        )}
      </div>
    </MarketingShell>
  );
}
