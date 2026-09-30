import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarketingShell } from "../marketing/MarketingShell";
import {
  loadMarketingInstall,
  marketingMeta,
} from "../marketing/shopify-public";

export const meta: MetaFunction = () =>
  marketingMeta({
    title: "Sync Shopify fulfillment tracking to PayPal | SEOi PaySync",
    description:
      "PaySync sends Shopify fulfillment tracking numbers to PayPal. It reads order and payment-gateway data. It does not process payments. One SEOi install.",
    path: "/shopify-paypal-tracking",
  });

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadMarketingInstall(request);

export default function PaypalTrackingPage() {
  const { showForm, lastShop, appStoreUrl, origin, showPaySync } =
    useLoaderData<typeof loader>();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Sync Shopify fulfillment tracking to PayPal",
    url: `${origin}/shopify-paypal-tracking`,
    isPartOf: { "@type": "WebSite", name: "SEOi", url: origin },
    description:
      "SEOi PaySync syncs Shopify tracking to PayPal. One app install alongside product SEO tools.",
  };

  return (
    <MarketingShell
      path="/shopify-paypal-tracking"
      showForm={showForm}
      lastShop={lastShop}
      appStoreUrl={appStoreUrl}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mkt-hero">
        <p className="mkt-kicker">PaySync workspace</p>
        <h1>Sync Shopify fulfillment tracking to PayPal</h1>
        <p className="mkt-lead">
          When you add tracking in Shopify, PaySync can send that tracking
          number to PayPal. Orders can also be tagged by payment type (PayPal,
          Razorpay, COD, and others). PaySync does not take payments or move
          money.
        </p>
        <div className="mkt-actions">
          <a className="mkt-btn mkt-btn-primary" href="#install">
            Install SEOi once
          </a>
          <a className="mkt-btn mkt-btn-secondary" href="/shopify-seo">
            Need product SEO instead?
          </a>
        </div>
      </header>

      {!showPaySync ? (
        <p className="mkt-lead">
          PaySync is turned off on this server. Product SEO is still available
          in the same SEOi app.
        </p>
      ) : (
        <>
          <div className="mkt-panel">
            <h2>What PaySync does</h2>
            <ul>
              <li>Import store orders and show payment provider</li>
              <li>Sync fulfillment tracking to PayPal when connected</li>
              <li>Optional Razorpay tagging alongside PayPal</li>
              <li>Free plan includes a limited number of synced orders</li>
            </ul>
          </div>
          <div className="mkt-panel">
            <h2>Same app as product SEO</h2>
            <p className="mkt-lead" style={{ margin: 0 }}>
              You do not install a second app. After SEOi is installed, open{" "}
              <strong>PayPal and Razorpay Sync</strong> from Home. SEO and ALT
              text stay in the other workspace.
            </p>
          </div>
        </>
      )}
    </MarketingShell>
  );
}
