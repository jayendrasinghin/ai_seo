import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarketingShell } from "../../marketing/MarketingShell";
import {
  loadMarketingInstall,
  marketingMeta,
} from "../../marketing/shopify-public";

export const meta: MetaFunction = () =>
  marketingMeta({
    title: "SEOi — Shopify AI SEO and PayPal tracking sync",
    description:
      "One Shopify app for AI product SEO, image ALT text, and PaySync — send fulfillment tracking to PayPal. Install once, use both workspaces.",
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
      "Shopify app for AI product SEO, image ALT text, and PayPal fulfillment tracking sync.",
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
        <p className="mkt-kicker">Shopify app</p>
        <h1>AI product SEO and PayPal tracking — one app, one install</h1>
        <p className="mkt-lead">
          SEOi is a single Shopify app with two workspaces: product SEO and ALT
          text, and PaySync for PayPal fulfillment tracking. Pick the problem
          you have. You still install SEOi once.
        </p>
        <div className="mkt-actions">
          <a className="mkt-btn mkt-btn-primary" href="#install">
            Install SEOi
          </a>
          <a className="mkt-btn mkt-btn-secondary" href="/shopify-seo">
            Product SEO &amp; ALT text
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
          <h2>Product SEO &amp; ALT text</h2>
          <p>
            AI titles, descriptions, image ALT text, and SEO scans inside
            Shopify Admin. No ranking or sales promises — it writes and updates
            the fields you apply.
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
