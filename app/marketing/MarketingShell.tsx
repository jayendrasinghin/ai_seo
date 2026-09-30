import type { ReactNode } from "react";
import { Form } from "react-router";
import "./marketing.css";

export function MarketingShell({
  path,
  showForm,
  lastShop,
  appStoreUrl,
  children,
}: {
  path: "/" | "/shopify-seo" | "/shopify-paypal-tracking";
  showForm: boolean;
  lastShop: string;
  appStoreUrl: string;
  children: ReactNode;
}) {
  return (
    <div className="mkt">
      <nav className="mkt-nav">
        <a className="mkt-brand" href="/">
          SEOi
        </a>
        <div className="mkt-links">
          <a className={path === "/shopify-seo" ? "active" : ""} href="/shopify-seo">
            Product SEO
          </a>
          <a
            className={path === "/shopify-paypal-tracking" ? "active" : ""}
            href="/shopify-paypal-tracking"
          >
            PayPal tracking
          </a>
          <a href={appStoreUrl} target="_blank" rel="noreferrer">
            Install on Shopify
          </a>
        </div>
      </nav>
      <main className="mkt-wrap">{children}</main>
      <section className="mkt-wrap" id="install">
        <div className="mkt-panel">
          <h2>One Shopify app. One install.</h2>
          <p className="mkt-lead" style={{ marginBottom: "1rem" }}>
            SEO tools and PaySync live in the same SEOi app. Install once, then
            open the workspace you need inside Shopify Admin.
          </p>
          <div className="mkt-actions" style={{ marginBottom: "1rem" }}>
            <a className="mkt-btn mkt-btn-primary" href={appStoreUrl}>
              Install from the Shopify App Store
            </a>
          </div>
          {showForm ? (
            <Form className="mkt-form" method="post" action="/auth/login">
              <label>
                <span>Or open with your shop domain</span>
                <input
                  type="text"
                  name="shop"
                  placeholder="your-store.myshopify.com"
                  defaultValue={lastShop}
                  autoComplete="on"
                />
              </label>
              <p className="mkt-hint">Example: store.myshopify.com</p>
              <button type="submit">Open app</button>
            </Form>
          ) : null}
        </div>
      </section>
      <footer className="mkt-footer">
        <span>© SEOi · one Shopify app</span>
        <a href="https://support.seoi.in/privacy-policy">Privacy</a>
        <a href="https://support.seoi.in/support">Support</a>
        <a href="https://support.seoi.in/faq">FAQ</a>
      </footer>
    </div>
  );
}
