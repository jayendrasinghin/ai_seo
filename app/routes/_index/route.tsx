import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

function shopFromHost(host: string | null): string | null {
  if (!host) return null;
  try {
    const decoded = atob(host);
    // admin.shopify.com/store/{store} or similar
    const match = decoded.match(/\/store\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const handle = match[1];
    return handle.includes(".") ? handle : `${handle}.myshopify.com`;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  const shop = shopParam || shopFromHost(host);

  // Embedded Admin / OAuth always includes shop or host — never show the public login page.
  if (shop || host || url.searchParams.get("id_token") || url.searchParams.get("embedded") === "1") {
    if (shop && !url.searchParams.get("shop")) {
      url.searchParams.set("shop", shop);
    }
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Seoi — SEO &amp; PaySync</h1>
        <p className={styles.text}>
          AI SEO, image optimization, and PayPal / Razorpay tracking sync for
          Shopify.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
                autoComplete="on"
              />
              <span>e.g. storetest-987654354.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Open app
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>SEO &amp; images</strong> — product copy, alt text, and SEO
            suite tools.
          </li>
          <li>
            <strong>PaySync</strong> — sync PayPal / Razorpay tracking from
            Shopify fulfillments.
          </li>
          <li>
            <strong>Tip</strong> — open the app from Shopify Admin → Apps → Seoi
            (not this public URL alone).
          </li>
        </ul>
      </div>
    </div>
  );
}
