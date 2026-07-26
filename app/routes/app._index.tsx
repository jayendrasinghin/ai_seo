import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { EmbeddedNavLink } from "../embedded-nav-link";
import prisma from "../db.server";
import {
  paypalConnectionRepository,
  shopRepository,
} from "../repositories";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const latestScan = await prisma.imageScanRun.findFirst({
    where: { shop, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { issuesOpen: true, imagesScanned: true },
  });

  let paypalConnected = false;
  try {
    const shopRecord = await shopRepository.findByDomain(shop);
    if (shopRecord) {
      const connection = await paypalConnectionRepository.findByShopId(
        shopRecord.id,
      );
      paypalConnected = Boolean(connection);
    }
  } catch {
    paypalConnected = false;
  }

  return {
    imageIssues: latestScan?.issuesOpen ?? null,
    imagesScanned: latestScan?.imagesScanned ?? null,
    paypalConnected,
  };
};

export default function HomeHub() {
  const { imageIssues, imagesScanned, paypalConnected } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Home">
      <s-section>
        <div className="seoi-hub-grid">
          <article className="seoi-hub-card seoi-hub-card--seo">
            <div className="seoi-hub-card__badge">SEO</div>
            <h2>SEO &amp; Image Optimization</h2>
            <p>
              Image SEO, product tools, SEO Suite, stock, and inventory — all in
              one workspace.
            </p>
            <ul className="seoi-hub-card__list">
              <li>Image SEO scan &amp; AI alt text</li>
              <li>Product descriptions &amp; SEO fields</li>
              <li>SEO Suite (IndexNow, sitemap, schema…)</li>
              <li>Stock alerts &amp; new products</li>
            </ul>
            <div className="seoi-hub-card__meta">
              {imagesScanned != null
                ? `${imagesScanned} images scanned · ${imageIssues ?? 0} open issues`
                : "No image scan yet"}
            </div>
            <div className="seoi-hub-card__actions">
              <EmbeddedNavLink
                hrefPathname="/app/seo-optimize"
                variant="button"
              >
                SEO &amp; Image Optimization
              </EmbeddedNavLink>
            </div>
          </article>

          <article className="seoi-hub-card seoi-hub-card--sync">
            <div className="seoi-hub-card__badge">Payments</div>
            <h2>PayPal and Razorpay Sync</h2>
            <p>
              Sync tracking numbers to PayPal and related payment providers,
              review the queue, and map orders that need a provider ID.
            </p>
            <ul className="seoi-hub-card__list">
              <li>PayPal tracking sync</li>
              <li>Order &amp; fulfillment queue</li>
              <li>Manual PayPal / provider mapping</li>
              <li>Historical order import</li>
            </ul>
            <div className="seoi-hub-card__meta">
              {paypalConnected
                ? "PayPal connected"
                : "PayPal not connected yet"}
            </div>
            <div className="seoi-hub-card__actions">
              <EmbeddedNavLink hrefPathname="/app/paysync" variant="button">
                PayPal and Razorpay Sync
              </EmbeddedNavLink>
            </div>
          </article>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
